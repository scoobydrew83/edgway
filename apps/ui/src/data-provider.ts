/**
 * ra-core's DataProvider over @edgway/sdk (PRD "Admin UI"). Each resource
 * maps to the SDK's generated operations (`listServices`, `getServices`, …).
 * The admin API pages with Kong's cursor (`offset`), so pages are walked
 * forward and reported to ra-core as `pageInfo` (no totals). Credentials
 * (key-auth, basic-auth) live under their consumer.
 */
import { ADMIN_PAGE } from "@edgway/constants";
import * as sdk from "@edgway/sdk";
import {
  type DataProvider,
  type GetListResult,
  HttpError,
  type RaRecord,
} from "ra-core";
import { pascal } from "./names";

type Row = Record<string, unknown> & { id: string };
type Result = { data?: unknown; error?: unknown; response?: Response };
type Op = (options: Record<string, unknown>) => Promise<Result>;

export const client = sdk.createEdgwayClient({
  adminUrl: window.location.origin,
});

const op = (verb: string, resource: string): Op => {
  const fn = (sdk as unknown as Record<string, Op | undefined>)[
    `${verb}${pascal(resource)}`
  ];
  if (!fn) throw new Error(`${verb}${pascal(resource)}`);
  return fn;
};

/** The SDK result's data, or ra-core's HttpError with the admin's problem. */
export async function call(promise: Promise<Result>): Promise<unknown> {
  const result = await promise;
  if (result.error !== undefined || !result.response?.ok) {
    const problem = (result.error ?? {}) as {
      title?: string;
      detail?: string;
      issues?: { path: string; message: string }[];
    };
    // The admin's 400 issues as ra-core's field errors: each under
    // its form field (the path's first segment), so the form shows it there.
    const errors = Object.fromEntries(
      (problem.issues ?? [])
        .filter((issue) => issue.path)
        .map((issue) => [issue.path.split(".")[0], issue.message]),
    );
    throw new HttpError(
      problem.detail ?? problem.title ?? String(result.response?.status),
      result.response?.status ?? 0,
      Object.keys(errors).length > 0
        ? { ...(result.error as object), errors }
        : result.error,
    );
  }
  return result.data;
}

/** Credentials listed and created under a consumer. */
const NESTED: Record<string, string> = {
  "key-auth": "consumer_id",
  "basic-auth": "consumer_id",
};

/** Kong cursors per list query: offsets[n] starts page n + 1. */
const cursors = new Map<string, (string | undefined)[]>();

/** A write moves rows between pages: forget the resource's cursors. */
const forget = (resource: string) => {
  for (const key of cursors.keys()) {
    if (JSON.parse(key)[0] === resource) cursors.delete(key);
  }
};

async function page(
  resource: string,
  query: Record<string, unknown>,
): Promise<{ data: Row[]; offset?: string }> {
  return (await call(op("list", resource)({ client, query }))) as {
    data: Row[];
    offset?: string;
  };
}

/** Every row of a collection (or a consumer's credentials), up to ADMIN_PAGE.maxSize. */
async function all(resource: string, parent?: string): Promise<Row[]> {
  if (NESTED[resource]) {
    const { data } = (await call(
      op("list", resource)({ client, path: { id: parent } }),
    )) as { data: Row[] };
    return data;
  }
  return (await page(resource, { size: ADMIN_PAGE.maxSize })).data;
}

const body = (data: Record<string, unknown>) => {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = data;
  return rest;
};

/** Only the fields an edit changed (Kong's PATCH semantics). */
const changed = (
  data: Record<string, unknown>,
  previous: Record<string, unknown> = {},
) =>
  Object.fromEntries(
    Object.entries(body(data)).filter(
      ([k, v]) => JSON.stringify(v) !== JSON.stringify(previous[k]),
    ),
  );

/**
 * The list filters the admin API doesn't have, applied to the rows
 * of the page it returned: `q` matches any text or list of text in a row,
 * case-insensitively; any other filter (a route's service or method) equals
 * the field, or is in it when the field is a list. `tags` is the API's own.
 */
// ponytail: filters one page of Kong's cursor paging; a server-side search
// would cover every page.
function filtered(rows: Row[], filter: Record<string, unknown> = {}): Row[] {
  const { tags: _tags, q, ...fields } = filter;
  const needle = typeof q === "string" ? q.trim().toLowerCase() : "";
  return rows.filter(
    (row) =>
      (!needle ||
        Object.values(row).some((value) =>
          (Array.isArray(value) ? value : [value]).some(
            (v) => typeof v === "string" && v.toLowerCase().includes(needle),
          ),
        )) &&
      Object.entries(fields).every(([field, want]) => {
        if (want === undefined || want === "") return true;
        const value = row[field];
        return Array.isArray(value) ? value.includes(want) : value === want;
      }),
  );
}

const slice = <T>(rows: T[], page = 1, perPage = rows.length) =>
  rows.slice((page - 1) * perPage, page * perPage);

export const dataProvider: DataProvider = {
  async getList(resource, params): Promise<GetListResult> {
    const { page: n = 1, perPage = 25 } = params.pagination ?? {};
    const tags = params.filter?.tags as string | undefined;
    if (NESTED[resource]) {
      const parent = params.filter?.[NESTED[resource]] as string | undefined;
      const rows = parent ? await all(resource, parent) : [];
      return {
        data: slice(rows, n, perPage),
        pageInfo: {
          hasPreviousPage: n > 1,
          hasNextPage: n * perPage < rows.length,
        },
      };
    }
    const key = JSON.stringify([resource, tags, perPage]);
    const offsets = cursors.get(key) ?? [undefined];
    cursors.set(key, offsets);
    // Walk forward to this page's cursor (ra-core may jump pages).
    for (let i = offsets.length; i < n; i++) {
      const previous = await page(resource, {
        size: perPage,
        offset: offsets[i - 1],
        tags,
      });
      offsets[i] = previous.offset;
      if (!previous.offset) break;
    }
    if (n > 1 && !offsets[n - 1]) {
      return {
        data: [],
        pageInfo: { hasPreviousPage: true, hasNextPage: false },
      };
    }
    const result = await page(resource, {
      size: perPage,
      offset: offsets[n - 1],
      tags,
    });
    offsets[n] = result.offset;
    return {
      data: filtered(result.data, params.filter),
      pageInfo: { hasPreviousPage: n > 1, hasNextPage: Boolean(result.offset) },
    };
  },

  async getOne(resource, { id }) {
    const data = (await call(
      op("get", resource)({ client, path: { id: String(id) } }),
    )) as RaRecord;
    return { data } as never;
  },

  async getMany(resource, { ids }) {
    const data = await Promise.all(
      ids.map(async (id) => (await this.getOne(resource, { id })).data),
    );
    return { data };
  },

  // The admin API has no reference filters: rows are filtered here, within
  // one maximum-size page (ADMIN_PAGE.maxSize).
  async getManyReference(resource, { target, id, pagination }) {
    const rows = (await all(resource, String(id))).filter(
      (row) => NESTED[resource] || row[target] === id,
    );
    const { page: n = 1, perPage = rows.length } = pagination ?? {};
    return {
      data: slice(rows, n, perPage),
      pageInfo: {
        hasPreviousPage: n > 1,
        hasNextPage: n * perPage < rows.length,
      },
    } as never;
  },

  async create(resource, { data }) {
    forget(resource);
    const parent = NESTED[resource];
    const { [parent ?? ""]: owner, ...rest } = data as Record<string, unknown>;
    const created = (await call(
      op(
        "create",
        resource,
      )(
        parent
          ? { client, path: { id: owner }, body: body(rest) }
          : { client, body: body(data) },
      ),
    )) as Record<string, unknown>;
    // key-auth answers `{ credential, key }`; the key is shown once.
    const record = (created.credential ?? created) as RaRecord;
    return {
      data: created.key ? { ...record, key: created.key } : record,
    } as never;
  },

  async update(resource, { id, data, previousData }) {
    // Credentials have no edit page, so only top-level entities get here.
    const updated = (await call(
      op(
        "patch",
        resource,
      )({
        client,
        path: { id: String(id) },
        body: changed(data, previousData),
      }),
    )) as RaRecord;
    return { data: updated } as never;
  },

  async updateMany(resource, { ids, data }) {
    for (const id of ids) {
      await call(
        op(
          "patch",
          resource,
        )({ client, path: { id: String(id) }, body: body(data) }),
      );
    }
    return { data: ids };
  },

  async delete(resource, { id, previousData }) {
    forget(resource);
    await call(op("delete", resource)({ client, path: { id: String(id) } }));
    return { data: (previousData ?? { id }) as never };
  },

  async deleteMany(resource, { ids }) {
    forget(resource);
    for (const id of ids) {
      await call(op("delete", resource)({ client, path: { id: String(id) } }));
    }
    return { data: ids };
  },
};

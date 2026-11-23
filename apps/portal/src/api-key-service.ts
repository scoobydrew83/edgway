/**
 * Zudoku's ApiKeyService (PRD "Developer portal") over the portal Worker's
 * `/api`: each request is signed with the developer's OIDC access token
 * (`context.signRequest`). Each key is its own Zudoku entry,
 * so "Roll key" and "Edit label" act on that key alone. Edgway stores only
 * a key's hash: a key's full value is known only in this browser session,
 * after its create or roll; otherwise its secret is empty and its prefix is
 * described, never handed over as the secret.
 */
import { HEADER, MEDIA_TYPE, PORTAL } from "@edgway/constants";
import { ERR } from "@edgway/errors";
import {
  portalKeyStartsWith,
  portalKeyUnnamed,
  portalRefusalBlocked,
  portalRefusalKeyLimit,
  portalRefusalNotAllowed,
  portalRefusalUnverified,
} from "@edgway/i18n/messages";
import type { MessageDescriptor } from "react-intl";
import type { ApiConsumer, ApiKeyService } from "zudoku/plugins/api-keys";
import { intl } from "./intl";
import { setRefusal } from "./refusal";
import {
  PORTAL_API,
  type PortalKey,
  type PortalKeyInput,
  type PortalUsage,
} from "./routes";

/** Keys created or rolled in this session: id → the full key. */
const fresh = new Map<string, string>();

type Context = Parameters<ApiKeyService["getConsumers"]>[0];

/**
 * What a refusal means for the developer, and what to do. The
 * allowed domains are never named: the admin's answer doesn't carry them.
 */
function refusal(problem: { code?: string; detail?: string }) {
  if (problem.code === ERR.ADMIN_KEY_LIMIT.code) {
    return intl.formatMessage(portalRefusalKeyLimit as MessageDescriptor, {
      max: PORTAL.maxKeysPerConsumer,
    });
  }
  if (problem.code !== ERR.ADMIN_FORBIDDEN.code) return undefined;
  const message = {
    [PORTAL.blockedDetail]: portalRefusalBlocked,
    [PORTAL.notAllowedDetail]: portalRefusalNotAllowed,
    [PORTAL.unverifiedDetail]: portalRefusalUnverified,
  }[problem.detail ?? ""];
  return message ? intl.formatMessage(message) : undefined;
}

async function call(
  context: Context,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(new URL(path, window.location.origin), init);
  const res = await fetch(await context.signRequest(request));
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as {
      title?: string;
      code?: string;
      detail?: string;
    };
    const message = refusal(problem);
    setRefusal(message);
    throw new Error(message ?? problem.title ?? String(res.status));
  }
  // A key request that worked clears the refusal (the usage panel's own
  // request says nothing about the keys).
  if (path.startsWith(PORTAL_API.keys)) setRefusal(undefined);
  return res;
}

/**
 * The developer's own usage per day, for the usage panel and
 * `getUsage`. Zudoku 0.88 doesn't call `getUsage` itself.
 */
export async function fetchUsage(context: Context): Promise<PortalUsage> {
  return (await (await call(context, PORTAL_API.usage)).json()) as PortalUsage;
}

const json = (body: PortalKeyInput): RequestInit => ({
  body: JSON.stringify(body),
  headers: { [HEADER.contentType]: MEDIA_TYPE.json },
});

const remember = async (res: Response) => {
  const key = (await res.json()) as PortalKey;
  if (key.key) fresh.set(key.id, key.key);
};

const entry = (key: PortalKey): ApiConsumer => ({
  id: key.id,
  label:
    key.name ??
    intl.formatMessage(portalKeyUnnamed as MessageDescriptor, {
      prefix: key.prefix,
    }),
  createdOn: key.createdOn,
  apiKeys: [
    {
      id: key.id,
      key: fresh.get(key.id) ?? "",
      description: fresh.has(key.id)
        ? undefined
        : intl.formatMessage(portalKeyStartsWith as MessageDescriptor, {
            prefix: key.prefix,
          }),
      createdOn: key.createdOn,
    },
  ],
});

export const apiKeyService: ApiKeyService = {
  async getConsumers(context) {
    // Prerendering (no browser, no signed-in developer) lists nothing.
    if (typeof window === "undefined") return [];
    const keys = (await (
      await call(context, PORTAL_API.keys)
    ).json()) as PortalKey[];
    return keys.map(entry);
  },
  async createKey({ apiKey, context }) {
    await remember(
      await call(context, PORTAL_API.keys, {
        method: "POST",
        ...json({ name: apiKey.description }),
      }),
    );
  },
  async updateConsumer({ id, label }, context) {
    await call(context, PORTAL_API.key(id), {
      method: "PATCH",
      ...json({ name: label }),
    });
  },
  async deleteKey(_entryId, keyId, context) {
    await call(context, PORTAL_API.key(keyId), { method: "DELETE" });
    fresh.delete(keyId);
  },
  async getUsage(_keys, context) {
    await fetchUsage(context);
  },
  async rollKey(keyId, context) {
    await remember(
      await call(context, PORTAL_API.roll(keyId), { method: "POST" }),
    );
  },
};

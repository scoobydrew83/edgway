/**
 * `edgway import-deck <file>`: by default offline. The admin's local D1
 * (wrangler's own state, via getPlatformProxy) is migrated, then the decK
 * file is applied through the Kong-compatible API over admin-core, with the
 * same validation as the live admin. With `--remote` it is
 * applied to the admin at --admin-url through its Kong-compatible mount,
 * with a Kong-Admin-Token. `edgway diff` and `edgway publish` follow.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Validator } from "@cfworker/json-schema";
import { createAdminCore } from "@edgway/admin-core";
import { ADMIN, CLI, HEADER, MEDIA_TYPE } from "@edgway/constants";
import { errorHandler } from "@edgway/errors";
import {
  cliErrorNoKongToken,
  cliImportDescription,
  cliImportDone,
  cliImportFailed,
  cliImportInvalid,
  cliImportNotKong,
  cliImportOptionFile,
  cliImportOptionKongToken,
  cliImportOptionPersist,
  cliImportOptionRemote,
  cliImportPartial,
  t,
} from "@edgway/i18n";
import { kongAdminApi } from "@edgway/kong-compat";
import { deckFileSchema } from "@edgway/schema/deck";
import { defineCommand } from "citty";
import { Hono } from "hono";
import { parse } from "yaml";
import { accessHeaders, adminUrlOf } from "../admin";
import { adminOptions, cwdArg } from "../args";
import { readConfig } from "../config";
import { applyDeck, type Outcome, type Row, type Send } from "../deck";
import { wrangler } from "../wrangler";

// The vendored decK file schema is draft-04.
const deck = new Validator(deckFileSchema as object, "4");

export const importDeck = defineCommand({
  meta: { name: "import-deck", description: t(cliImportDescription) },
  args: {
    file: {
      type: "positional",
      required: true,
      description: t(cliImportOptionFile),
    },
    "persist-to": { type: "string", description: t(cliImportOptionPersist) },
    remote: { type: "boolean", description: t(cliImportOptionRemote) },
    "kong-token": { type: "string", description: t(cliImportOptionKongToken) },
    ...adminOptions,
  },
  async run({ args }) {
    const cwd = cwdArg(args);
    const file = path.resolve(cwd, args.file);
    const document = parse(readFileSync(file, "utf8")) as Row;
    const valid = deck.validate(document);
    if (!valid.valid) {
      const problems = valid.errors
        .map((e) => `  ${e.instanceLocation}: ${e.error}`)
        .join("\n");
      throw new Error(
        `${t(cliImportInvalid, { file: args.file })}\n${problems}`,
      );
    }

    const outcome = args.remote
      ? await importRemote(document, args)
      : await importLocal(document, cwd, args["persist-to"]);
    for (const failure of outcome.failures) {
      console.error(t(cliImportFailed, { ...failure }));
    }
    console.log(t(cliImportDone, { count: outcome.imported, file: args.file }));
    if (outcome.failures.length > 0) {
      throw new Error(t(cliImportPartial, { failed: outcome.failures.length }));
    }
  },
});

/** Applies a decK document through a deployed admin's Kong-compatible mount. */
async function importRemote(
  document: Row,
  args: {
    "kong-token"?: string;
    "admin-url"?: string;
    token?: string;
    cwd?: string;
  },
): Promise<Outcome> {
  const token = args["kong-token"] || process.env[CLI.env.kongToken];
  if (!token) throw new Error(t(cliErrorNoKongToken));
  const adminUrl = await adminUrlOf(args);
  const headers = {
    ...accessHeaders(adminUrl, args),
    [HEADER.kongAdminToken]: token,
    [HEADER.contentType]: MEDIA_TYPE.json,
  };
  const send: Send = async (method, url, body) => {
    const res = await fetch(new URL(url, adminUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Access answers a request it doesn't let through with a redirect to
      // its login page: report that, don't follow it.
      redirect: "manual",
    });
    const text = await res.text();
    if (text && !res.headers.get(HEADER.contentType)?.includes("json")) {
      throw new Error(t(cliImportNotKong, { status: res.status }));
    }
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  };
  return applyDeck(document, send);
}

/** Applies a decK document to the admin's local D1, offline. */
async function importLocal(
  document: Row,
  cwd: string,
  persist: string | undefined,
): Promise<Outcome> {
  const config = await readConfig(cwd);
  const persistTo = persist ? path.resolve(cwd, persist) : undefined;
  // The local D1 needs the admin's schema (idempotent).
  await wrangler(
    [
      "d1",
      "migrations",
      "apply",
      CLI.adminDatabaseBinding,
      "--local",
      "--config",
      config.adminConfig,
      ...(persistTo ? ["--persist-to", persistTo] : []),
    ],
    { cwd: path.dirname(config.adminConfig), quiet: true },
  );

  // Loaded here only: importing wrangler routes the whole process's fetch
  // through an HTTP(S)_PROXY if one is set, which the other commands avoid.
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<Record<string, unknown>>({
    configPath: config.adminConfig,
    // wrangler's --persist-to keeps its state under v3/.
    persist: persistTo ? { path: path.join(persistTo, "v3") } : true,
  });
  try {
    const core = createAdminCore(
      proxy.env[CLI.adminDatabaseBinding] as D1Database,
      {
        workspaceId:
          (proxy.env.WORKSPACE_ID as string | undefined) ||
          ADMIN.defaultWorkspaceId,
        actor: "edgway-cli:import-deck",
      },
    );
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("adminCore", core);
      await next();
    });
    app.route("/", kongAdminApi());
    app.onError(errorHandler({ format: "kong" }));

    return await applyDeck(document, async (method, url, body) => {
      const res = await app.request(url, {
        method,
        headers: { [HEADER.contentType]: MEDIA_TYPE.json },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : {} };
    });
  } finally {
    await proxy.dispose();
  }
}

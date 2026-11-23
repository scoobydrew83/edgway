/**
 * The admin API through @edgway/sdk. The admin sits behind Cloudflare
 * Access: a service token (CF_ACCESS_CLIENT_ID / _SECRET) or a user's token
 * (`--token` or CF_ACCESS_TOKEN, from `cloudflared access token`) is checked
 * at the edge, which sends the admin its own assertion. A local
 * admin has no Access in front, so it gets the token as the assertion.
 */
import { CLI, HEADER } from "@edgway/constants";
import { cliErrorNoAdminUrl, cliErrorRequest, t } from "@edgway/i18n";
import { createEdgwayClient } from "@edgway/sdk";
import { cwdArg } from "./args";
import { readConfig } from "./config";

export interface AdminArgs {
  "admin-url"?: string;
  token?: string;
  cwd?: string;
}

type Client = ReturnType<typeof createEdgwayClient>;

/** The admin's URL: the flag, then EDGWAY_ADMIN_URL, then edgway.config.ts. */
export async function adminUrlOf(
  args: AdminArgs,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const config = await readConfig(cwdArg(args));
  const adminUrl =
    args["admin-url"] || env[CLI.env.adminUrl] || config.adminUrl;
  if (!adminUrl) throw new Error(t(cliErrorNoAdminUrl));
  return adminUrl;
}

/** The Access headers for a request to `adminUrl`. */
export function accessHeaders(
  adminUrl: string,
  args: AdminArgs,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = args.token || env[CLI.env.accessToken];
  if (token) {
    const local = (CLI.localHosts as readonly string[]).includes(
      new URL(adminUrl).hostname,
    );
    headers[local ? HEADER.cfAccessJwtAssertion : HEADER.cfAccessToken] = token;
  }
  const id = env[CLI.env.accessClientId];
  const secret = env[CLI.env.accessClientSecret];
  if (id && secret) {
    headers[HEADER.cfAccessClientId] = id;
    headers[HEADER.cfAccessClientSecret] = secret;
  }
  return headers;
}

export async function adminClient(
  args: AdminArgs,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Client> {
  const adminUrl = await adminUrlOf(args, env);
  return createEdgwayClient({
    adminUrl,
    headers: accessHeaders(adminUrl, args, env),
  });
}

/** An SDK result's data, or an error naming the admin's status and message. */
export function ok<T>(result: {
  data?: T;
  error?: unknown;
  response?: Response;
}): T {
  const status = result.response?.status ?? 0;
  if (result.error !== undefined || !result.response?.ok) {
    const body = result.error as { title?: string; detail?: string } | string;
    const message =
      typeof body === "string"
        ? body
        : (body?.detail ?? body?.title ?? String(status));
    throw new Error(t(cliErrorRequest, { status, message }));
  }
  return result.data as T;
}

/** The portal Worker's API paths, shared by the Worker and the ApiKeyService. */
export const PORTAL_API = {
  base: "/api",
  keys: "/api/keys",
  key: (id: string) => `/api/keys/${encodeURIComponent(id)}`,
  /** Roll one key: same key entry and name, a new value. */
  roll: (id: string) => `/api/keys/${encodeURIComponent(id)}/roll`,
  /** The developer's own requests per day. */
  usage: "/api/usage",
} as const;

/**
 * A developer's usage: their requests and server errors per day.
 * `configured` is false when the portal has no Analytics Engine access.
 */
export interface PortalUsage {
  configured: boolean;
  days: number;
  daily: { day: string; requests: number; errors: number }[];
}

/**
 * A key as the portal API returns it. `key`, the full value, only in the
 * answer to a create or a roll; afterwards only its first characters,
 * `prefix`, which is never the secret.
 */
export interface PortalKey {
  id: string;
  name: string | null;
  prefix: string;
  createdOn?: string;
  key?: string;
}

/** The body of a create or rename. */
export interface PortalKeyInput {
  name?: string;
}

/** The portal site's pages (Zudoku routes), shared by its config and pages. */
export const PORTAL_PAGES = {
  home: "/",
  keys: "/settings/api-keys",
  /** The API reference, built from ZUDOKU_PUBLIC_PORTAL_OPENAPI when set. */
  reference: "/reference",
  /** Zudoku's protected area: signing in is required there. */
  protected: "/settings/*",
} as const;

/** The admin app's roles and mount point (used only by this Worker). */

/** Admin roles, least to most privileged (PRD: Admin identity). */
export const ROLES = ["viewer", "editor", "publisher", "owner"] as const;

export type AdminRole = (typeof ROLES)[number];

/** Where the native API is mounted. */
export const API_BASE = "/api/v1";

/** Publish on the Kong mount, for token-authenticated CI after `deck gateway sync`. */
export const KONG_PUBLISH_PATH = "/edgway/publish";

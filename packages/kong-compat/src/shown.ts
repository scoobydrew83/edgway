/**
 * What a caller may see of a row: with `kongRedactSecrets` set (the admin
 * sets it for viewer tokens), secret values are masked. Every Kong
 * read path goes through it, nested ones included.
 */
import { type Row, redactRow } from "@edgway/admin-core";
import type { Context } from "hono";
import { ENTITY_TABLES } from "./schemas.js";

/** Kong collection names whose table differs (the secret columns). */
const SECRET_TABLES: Record<string, string> = { jwts: "jwt_secrets" };

export const shown = (c: Context, name: string, row: Row): Row =>
  c.get("kongRedactSecrets")
    ? redactRow(SECRET_TABLES[name] ?? ENTITY_TABLES[name] ?? name, row)
    : row;

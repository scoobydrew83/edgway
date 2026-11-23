/**
 * Column builders shared by every table. Timestamps are Unix seconds, as in
 * Kong's Admin API; IDs are UUIDv7 because Kong, decK and Terraform expect UUIDs.
 */
import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "uuidv7";

const unixNow = () => Math.floor(Date.now() / 1000);

export const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const workspaceId = () => text().notNull();

export const createdAt = () => integer().notNull().default(sql`(unixepoch())`);

export const updatedAt = () =>
  integer().notNull().default(sql`(unixepoch())`).$onUpdateFn(unixNow);

export const bool = () => integer({ mode: "boolean" });

export const json = <T>() => text({ mode: "json" }).$type<T>();

export const tags = () => json<string[]>();

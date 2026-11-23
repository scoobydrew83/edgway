import { defineConfig } from "drizzle-kit";

// D1 migrations for the admin Worker, generated from src/db/tables.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/tables.ts",
  out: "../../apps/admin/migrations",
});

import { ADMIN_UI } from "@edgway/constants";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served by the admin Worker under ADMIN_UI.basePath: the build
// goes to dist/ui so asset paths keep that prefix (apps/admin wrangler.jsonc).
export default defineConfig({
  base: `${ADMIN_UI.basePath}/`,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist/ui", emptyOutDir: true },
});

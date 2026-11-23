/**
 * `prepack` for every public package: the repository's LICENSE and
 * NOTICE go into the tarball, copied at pack time rather than committed into
 * each package. `postpack.mjs` removes the copies.
 */
import { copyFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
for (const file of ["LICENSE", "NOTICE"]) {
  copyFileSync(path.join(root, file), path.join(process.cwd(), file));
}

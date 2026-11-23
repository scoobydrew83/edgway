/** `postpack`: removes the LICENSE and NOTICE `prepack.mjs` copied in. */
import { rmSync } from "node:fs";
import path from "node:path";

for (const file of ["LICENSE", "NOTICE"]) {
  rmSync(path.join(process.cwd(), file), { force: true });
}

/**
 * Kong vault references, `{vault://<vault>/<name>[/<field>]}`: the one home
 * of the check. Pure (constants only), so admin-core and the CLI's
 * Node bundle import it as `@edgway/adapters-cf/secrets` without Workers-only
 * modules.
 */
import { VAULT_REFERENCE } from "@edgway/constants";

export const isVaultReference = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith(VAULT_REFERENCE.prefix) &&
  value.endsWith(VAULT_REFERENCE.suffix);

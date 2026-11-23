import { errorsAuthRequired, t } from "@edgway/i18n";
import { ERR, fail } from "./registry";

export const deny = () =>
  fail(ERR.AUTH_REQUIRED, { detail: t(errorsAuthRequired), style: "unit" });

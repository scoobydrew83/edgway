import { ERR, fail } from "./registry";

export const deny = () =>
  fail(ERR.AUTH_REQUIRED, { detail: "Missing API key header" });

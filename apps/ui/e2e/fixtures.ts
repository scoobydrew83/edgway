import { HEADER } from "@edgway/constants";
import { test as base } from "@playwright/test";

/**
 * Every request carries the Access assertion global-setup minted, at the
 * admin's URL. Set as fixture values (not a top-level `test.use`, which
 * would apply only to the first spec file that imports this module).
 */
export const test = base.extend({
  baseURL: process.env.E2E_BASE_URL,
  extraHTTPHeaders: {
    [HEADER.cfAccessJwtAssertion]: process.env.E2E_TOKEN ?? "",
  },
});

export { expect } from "@playwright/test";

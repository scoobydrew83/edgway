/** The native API's OpenAPI document settings, shared by the Worker and `scripts/openapi.ts`. */
import { PRODUCT } from "@edgway/constants";
import { API_BASE } from "./roles";

export const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: { title: PRODUCT.name, version: "1" },
  // Paths are relative to the mount, so generated clients default to it.
  servers: [{ url: API_BASE }],
};

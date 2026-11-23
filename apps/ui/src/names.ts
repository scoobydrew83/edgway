/** A resource name as the SDK spells it in operation names (`ca_certificates` → `CaCertificates`). */
export const pascal = (resource: string) =>
  resource
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

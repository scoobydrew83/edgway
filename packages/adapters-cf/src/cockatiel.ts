/**
 * cockatiel, loaded on first use. Its module creates an `AbortController`
 * when it loads, which workerd forbids in global scope, so a static import
 * stops a bundled Worker from starting. A dynamic import stays lazy in the
 * bundle and runs inside the first request.
 */
let loaded: Promise<typeof import("cockatiel")> | undefined;

export const loadCockatiel = () => {
  loaded ??= import("cockatiel");
  return loaded;
};

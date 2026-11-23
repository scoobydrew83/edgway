import type { I18nProvider } from "ra-core";

/**
 * The fallback when <Admin> gets no i18nProvider: ra-core's own defaults
 * (`_`) or the key. Edgway's admin UI passes one over its FormatJS catalog
 * (apps/ui), so no English catalog ships here.
 */
export const i18nProvider: I18nProvider = {
  translate: (key, options) =>
    typeof options?._ === "string" ? options._ : key,
  changeLocale: async () => {},
  getLocale: () => "en",
  getLocales: () => [{ locale: "en", name: "en" }],
};

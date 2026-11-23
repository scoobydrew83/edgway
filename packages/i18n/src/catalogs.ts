/**
 * The compiled catalogs and the locales they cover. Browser-safe (no Hono):
 * the admin UI renders them with react-intl (`@edgway/i18n/catalogs`).
 */
import en from "./generated/en.json" with { type: "json" };
import pseudo from "./generated/x-pseudo.json" with { type: "json" };

export const locales = ["en", "x-pseudo"] as const;
export type Locale = (typeof locales)[number];
export const baseLocale: Locale = "en";

export const catalogs = { en, "x-pseudo": pseudo } as const;

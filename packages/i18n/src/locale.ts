/**
 * Per-request locale from headers only (never the body, so proxied request
 * streams are untouched): Hono's languageDetector negotiates Accept-Language,
 * and contextStorage makes the request context (and its locale) available to
 * code outside handlers, such as @edgway/errors.
 */
import { HEADER } from "@edgway/constants";
import { createIntl, createIntlCache, type IntlShape } from "@formatjs/intl";
import type { MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { contextStorage, tryGetContext } from "hono/context-storage";
import { languageDetector } from "hono/language";
import { baseLocale, catalogs, type Locale, locales } from "./catalogs.js";

export { type Locale, locales } from "./catalogs.js";

const cache = createIntlCache();
const intls = new Map<Locale, IntlShape>();

/**
 * Messages third-party plugins bring, by id: merged into every
 * locale's catalog by the registry the gateway is generated with. The
 * compiled catalogs win on a clash, so a plugin can't replace Edgway's text.
 */
const pluginMessages: Record<string, string> = {};

/** Adds plugins' messages (id → ICU message) to the catalogs. */
export function addMessages(messages: Readonly<Record<string, string>>): void {
  Object.assign(pluginMessages, messages);
  intls.clear();
}

/** The FormatJS instance for a locale (pseudo locales format like the base). */
export function intlFor(locale: Locale): IntlShape {
  let intl = intls.get(locale);
  if (!intl) {
    intl = createIntl(
      {
        locale: locale.startsWith("x-") ? baseLocale : locale,
        defaultLocale: baseLocale,
        messages: { ...pluginMessages, ...catalogs[locale] },
      },
      cache,
    );
    intls.set(locale, intl);
  }
  return intl;
}

const isLocale = (value: unknown): value is Locale =>
  locales.includes(value as Locale);

/** The current request's locale, or the base locale outside a request. */
export function getLocale(): Locale {
  const language = tryGetContext()?.get("language");
  return isLocale(language) ? language : baseLocale;
}

/** Hono middleware: detect the locale and tell caches that responses vary by it. */
export const i18nMiddleware = (): MiddlewareHandler =>
  every(
    contextStorage(),
    languageDetector({
      supportedLanguages: [...locales],
      fallbackLanguage: baseLocale,
      order: ["header"],
      caches: false,
    }),
    async (c, next) => {
      await next();
      // Responses passed through unchanged (e.g. fetch()) have immutable headers.
      c.res = new Response(c.res.body, c.res);
      c.res.headers.append(HEADER.vary, HEADER.acceptLanguage);
    },
  );

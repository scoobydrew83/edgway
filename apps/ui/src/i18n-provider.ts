/**
 * ra-core's i18nProvider over react-intl: react-admin's own
 * strings (`ra.*`) come from the @edgway/i18n catalog like every other
 * string, instead of ra-language-english. Field labels
 * (`resources.<name>.fields.<field>`) come from FIELD_LABELS. Other
 * keys the catalog lacks fall back to ra-core's own default, `_`.
 */
import type { I18nProvider } from "ra-core";
import type { IntlShape, MessageDescriptor } from "react-intl";
import { FIELD_LABELS } from "./fields";

type Values = Record<string, string | number | boolean | null | undefined>;

/** react-admin keys that aren't catalog messages (see ra-messages.mjs). */
const PLAIN: Record<string, (values: Values) => string> = {
  "ra.page.list": (values) => String(values.name ?? ""),
  "ra.boolean.null": () => "",
};

/** A catalog message by id (react-admin passes the key, not a descriptor). */
const descriptor = (id: string): MessageDescriptor => ({ id });

export function intlI18nProvider(intl: IntlShape): I18nProvider {
  return {
    translate(key, options = {}) {
      const { _: fallback, ...values } = options as Values & { _?: string };
      if (key in intl.messages)
        return intl.formatMessage(descriptor(key), values);
      const field =
        FIELD_LABELS[/^resources\.[^.]+\.fields\.(.+)$/.exec(key)?.[1] ?? ""];
      if (field) return intl.formatMessage(field);
      const plain = PLAIN[key];
      if (plain) return plain(values);
      return typeof fallback === "string" ? fallback : key;
    },
    changeLocale: async () => {},
    getLocale: () => intl.locale,
    getLocales: () => [{ locale: intl.locale, name: intl.locale }],
  };
}

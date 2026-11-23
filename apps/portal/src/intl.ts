/**
 * The catalog for the portal's own text: Zudoku renders the pages,
 * so one react-intl instance at the base locale formats @edgway/i18n's
 * messages for them.
 */
import { baseLocale, catalogs } from "@edgway/i18n/catalogs";
import { createIntl, createIntlCache } from "react-intl";

export const intl = createIntl(
  { locale: baseLocale, messages: catalogs[baseLocale] },
  createIntlCache(),
);

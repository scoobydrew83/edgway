/**
 * Formatting through FormatJS/Intl only (PRD "Internationalization"), in the
 * current request's locale. Never format numbers or dates with template strings.
 */
import type { MessageDescriptor } from "@formatjs/intl";
import { getLocale, intlFor } from "./locale.js";

type Values = Parameters<ReturnType<typeof intlFor>["formatMessage"]>[1];

/** Render a catalog message in the current locale. */
export const t = (message: MessageDescriptor, values?: Values): string =>
  String(intlFor(getLocale()).formatMessage(message, values));

export const formatNumber = (
  value: number,
  options?: Intl.NumberFormatOptions,
) => intlFor(getLocale()).formatNumber(value, options);

export const formatBytes = (bytes: number) => {
  const [value, unit] =
    bytes >= 1e6
      ? [bytes / 1e6, "megabyte"]
      : bytes >= 1e3
        ? [bytes / 1e3, "kilobyte"]
        : [bytes, "byte"];
  return formatNumber(value, { style: "unit", unit, maximumFractionDigits: 1 });
};

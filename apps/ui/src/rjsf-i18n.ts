/**
 * react-jsonschema-form's strings from the @edgway/i18n catalog:
 * its UI strings (`rjsf.*`, by TranslatableString key) and the ajv
 * validation messages, by keyword.
 */
import {
  uiValidationEnum,
  uiValidationFormat,
  uiValidationMaxItems,
  uiValidationMaximum,
  uiValidationMaxLength,
  uiValidationMinItems,
  uiValidationMinimum,
  uiValidationMinLength,
  uiValidationPattern,
  uiValidationRequired,
  uiValidationType,
  uiValidationUnknownField,
} from "@edgway/i18n/messages";
import { type RJSFValidationError, TranslatableString } from "@rjsf/utils";
import type { IntlShape, MessageDescriptor } from "react-intl";

/** TranslatableString's English text → its key (the catalog id's suffix). */
const KEYS = new Map(
  Object.entries(TranslatableString).map(([key, text]) => [text, key]),
);

/** A catalog message by id (RJSF passes its English text, mapped to the key). */
const descriptor = (id: string): MessageDescriptor => ({ id });

/** RJSF's `translateString`: `%1`, `%2` arrive as `p1`, `p2`. */
export const rjsfTranslate =
  (intl: IntlShape) =>
  (text: TranslatableString, params?: string[]): string => {
    const id = `rjsf.${KEYS.get(text) ?? ""}`;
    if (!(id in intl.messages)) return text;
    return intl.formatMessage(
      descriptor(id),
      Object.fromEntries((params ?? []).map((p, i) => [`p${i + 1}`, p])),
    );
  };

const KEYWORDS: Record<string, MessageDescriptor> = {
  required: uiValidationRequired,
  type: uiValidationType,
  enum: uiValidationEnum,
  minimum: uiValidationMinimum,
  maximum: uiValidationMaximum,
  minLength: uiValidationMinLength,
  maxLength: uiValidationMaxLength,
  minItems: uiValidationMinItems,
  maxItems: uiValidationMaxItems,
  pattern: uiValidationPattern,
  format: uiValidationFormat,
  additionalProperties: uiValidationUnknownField,
};

/** RJSF's `transformErrors`: ajv's English messages, from the catalog. */
export const rjsfErrors =
  (intl: IntlShape) =>
  (errors: RJSFValidationError[]): RJSFValidationError[] =>
    errors.map((error) => {
      const message = KEYWORDS[error.name ?? ""];
      if (!message) return error;
      const params = (error.params ?? {}) as Record<string, unknown>;
      const text = intl.formatMessage(message, {
        type: String(params.type ?? ""),
        limit: Number(params.limit ?? 0),
        pattern: String(params.pattern ?? ""),
        format: String(params.format ?? ""),
        property: String(params.additionalProperty ?? ""),
      });
      return {
        ...error,
        message: text,
        stack: `${error.property ?? ""} ${text}`.trim(),
      };
    });

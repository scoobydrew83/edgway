/**
 * A plugin's config form, laid out by its entry in `PLUGIN_LAYOUTS`:
 * RJSF over Kong's schema, with one root template that puts the layout's
 * fields first in titled cards (labels from @edgway/i18n, Kong's long
 * descriptions dropped) and every other field under a closed "Advanced".
 */
import { uiPluginsAdvanced } from "@edgway/i18n/messages";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@edgway/ui-kit/components/ui/card";
import Form from "@rjsf/shadcn";
import type {
  ObjectFieldTemplateProps,
  RJSFSchema,
  UiSchema,
} from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import type { ReactNode } from "react";
import { type IntlShape, type MessageDescriptor, useIntl } from "react-intl";
import { rjsfErrors, rjsfTranslate } from "../rjsf-i18n";
import {
  layoutOf,
  PLUGIN_FIELD_LABELS,
  type PluginLayout,
} from "./plugin-layouts";

/** Grid columns by a row's field count (static class names for Tailwind). */
const COLUMNS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

interface Context {
  layout: PluginLayout;
  intl: IntlShape;
}

/**
 * The root object's template: the layout's groups, then the rest folded.
 * Module-level, so RJSF keeps the same component (and the fields' focus)
 * across renders; the layout comes through `formContext`.
 */
function LayoutTemplate({ properties, registry }: ObjectFieldTemplateProps) {
  const { layout, intl } = registry.formContext as Context;
  const content = new Map(properties.map((p) => [p.name, p.content]));
  const placed = new Set(layout.groups.flatMap((g) => g.rows.flat()));
  const rest = properties.filter((p) => !placed.has(p.name) && !p.hidden);
  return (
    <div className="flex flex-col gap-6">
      {layout.groups.map((group) => (
        <Card
          key={group.title.id as string}
          role="region"
          aria-label={intl.formatMessage(group.title)}
        >
          <CardHeader>
            <CardTitle>{intl.formatMessage(group.title)}</CardTitle>
            {group.hint ? (
              <CardDescription>
                {intl.formatMessage(group.hint)}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="gap-4">
            {group.rows.map((row) => (
              <div
                key={row.join()}
                className={`grid items-start gap-4 ${COLUMNS[row.length] ?? ""}`}
              >
                {row.map((name) => content.get(name))}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      {rest.length > 0 ? (
        <details
          className="rounded-xl border bg-card p-5"
          data-testid="plugin-advanced"
        >
          <summary className="cursor-pointer font-semibold">
            {intl.formatMessage(uiPluginsAdvanced as MessageDescriptor, {
              count: rest.length,
            })}
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            {rest.map((p) => p.content)}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** The schema with the layout's fields' long Kong descriptions removed. */
function trimmed(schema: RJSFSchema, layout: PluginLayout): RJSFSchema {
  const placed = new Set(layout.groups.flatMap((g) => g.rows.flat()));
  const properties = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, field]) => [
      name,
      placed.has(name) && typeof field === "object"
        ? { ...field, description: undefined }
        : field,
    ]),
  );
  return { ...schema, properties };
}

export function PluginConfigForm({
  name,
  schema,
  formData,
  onChange,
  onSubmit,
  children,
}: {
  name: string;
  schema: RJSFSchema;
  formData?: unknown;
  onChange?: (config: unknown) => void;
  onSubmit: (config: unknown) => void;
  /** The form's buttons (RJSF's own submit button is replaced). */
  children: ReactNode;
}) {
  const intl = useIntl();
  const required = Array.isArray(schema.required) ? schema.required : [];
  const layout = layoutOf(name, required);
  const placed = layout.groups.flatMap((g) => g.rows.flat());
  const uiSchema: UiSchema = {
    "ui:ObjectFieldTemplate": LayoutTemplate,
    ...Object.fromEntries(
      placed.map((field) => [
        field,
        {
          ...(PLUGIN_FIELD_LABELS[field]
            ? { "ui:title": intl.formatMessage(PLUGIN_FIELD_LABELS[field]) }
            : {}),
          ...(layout.fieldHints?.[field]
            ? { "ui:description": intl.formatMessage(layout.fieldHints[field]) }
            : {}),
        },
      ]),
    ),
  };
  return (
    <Form
      schema={trimmed(schema, layout)}
      uiSchema={uiSchema}
      formData={formData}
      formContext={{ layout, intl } satisfies Context}
      validator={validator}
      translateString={rjsfTranslate(intl)}
      transformErrors={rjsfErrors(intl)}
      onChange={({ formData: data }) => onChange?.(data)}
      onSubmit={({ formData: data }) => onSubmit(data)}
    >
      {children}
    </Form>
  );
}

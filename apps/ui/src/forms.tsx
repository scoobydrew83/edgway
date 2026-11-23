/**
 * Entity form layouts (the RouteForm and Sandbox boards): fields in
 * cards by purpose, rare ones under a closed "Advanced", the decK preview as
 * a dark panel in a right-hand column, and a "Stage …" bar under the form.
 * The route form takes paths as chips and methods as checkboxes; the upload
 * form takes its code from a file and its limits from sliders. Inputs that
 * follow the API's schema come from `resources.tsx` (`field`).
 */
import { SANDBOX } from "@edgway/constants";
import {
  uiFieldCpuMs,
  uiFieldMethods,
  uiFieldSubRequests,
  uiFormAdvanced,
  uiFormBasics,
  uiFormCreateService,
  uiFormDestination,
  uiFormMatches,
  uiFormMatchesHint,
  uiFormMethodsHint,
  uiFormPathInvalid,
  uiFormRouteAdvanced,
  uiSandboxAddBinding,
  uiSandboxBindings,
  uiSandboxBindingsAllow,
  uiSandboxBindingsNone,
  uiSandboxCode,
  uiSandboxDefault,
  uiSandboxDrop,
  uiSandboxDropHint,
  uiSandboxFile,
  uiSandboxHideSource,
  uiSandboxLimitsTitle,
  uiSandboxMost,
  uiSandboxMs,
  uiSandboxNoFile,
  uiSandboxViewSource,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import {
  CancelButton,
  FormToolbar,
  SaveButton,
  SimpleForm,
  TextArrayInput,
} from "@edgway/ui-kit/components/admin";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { Button } from "@edgway/ui-kit/components/ui/button";
import { Checkbox } from "@edgway/ui-kit/components/ui/checkbox";
import { Input } from "@edgway/ui-kit/components/ui/input";
import { Upload } from "lucide-react";
import { FormDataConsumer, useInput } from "ra-core";
import { type ReactNode, useId, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { toDeck } from "./console/deck";
import { DeckPanel } from "./console/deck-panel";

/** Renders one schema-driven input by field name (`resources.tsx`). */
export type FieldOf = (name: string) => ReactNode;

/** The request methods a route can match: the admin's own list (its tester's). */
export const METHODS = sdk.zTestRouteBody.shape.method
  .unwrap()
  .unwrap().options;

const KIB = 1024;

/** A card holding a fieldset, its legend on the border (the boards' cards). */
function FormCard({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5">
      <legend className="px-1 font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Rare fields, folded (closed by default). */
function Advanced({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="rounded-xl border bg-card p-5">
      <summary className="cursor-pointer font-semibold">{summary}</summary>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </details>
  );
}

/** The entity as decK YAML (`DeckPanel`). */
function DeckPreview({ resource }: { resource: string }) {
  return (
    <FormDataConsumer>
      {({ formData }) => (
        <DeckPanel
          yaml={toDeck({ [resource]: [formData] })}
          testId="form-preview"
        />
      )}
    </FormDataConsumer>
  );
}

/** "Stage …", Cancel and the line saying it goes live on publish. */
export function StageToolbar({
  label,
  note,
}: {
  label: MessageDescriptor;
  note: MessageDescriptor;
}) {
  const intl = useIntl();
  return (
    <FormToolbar>
      <div className="flex flex-row flex-wrap items-center gap-3">
        <SaveButton label={intl.formatMessage(label)} icon={false} />
        <CancelButton />
        <span className="text-sm text-muted-foreground">
          {intl.formatMessage(note)}
        </span>
      </div>
    </FormToolbar>
  );
}

/** The form beside its right-hand column; stacked on phones. */
function TwoColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-6">{main}</div>
      <aside className="flex min-w-0 flex-col gap-4">{side}</aside>
    </div>
  );
}

/**
 * Kong's rule for a route path: "/" or "~" for a regex. A catalog id:
 * the i18nProvider formats it.
 */
const pathsValid = (paths: unknown) =>
  Array.isArray(paths) &&
  paths.some((path) => typeof path !== "string" || !/^[/~]/.test(path))
    ? uiFormPathInvalid.id
    : undefined;

/** A route's methods as checkboxes; none matches every method. */
function MethodsInput() {
  const intl = useIntl();
  const { field } = useInput({ source: "methods" });
  const methods: string[] = Array.isArray(field.value) ? field.value : [];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">
        {intl.formatMessage(uiFieldMethods)}
      </legend>
      <div className="flex flex-wrap gap-2">
        {METHODS.map((method) => {
          const checked = methods.includes(method);
          return (
            // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Checkbox renders its input inside this label.
            <label
              key={method}
              className={`flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 font-mono text-sm ${checked ? "border-primary bg-primary/5" : ""}`}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(on) =>
                  field.onChange(
                    on
                      ? METHODS.filter(
                          (m) => m === method || methods.includes(m),
                        )
                      : methods.filter((m) => m !== method),
                  )
                }
              />
              {method}
            </label>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        {intl.formatMessage(uiFormMethodsHint)}
      </p>
    </fieldset>
  );
}

/** Route fields placed by the form; the rest go under "Advanced". */
const ROUTE_PLACED = new Set([
  "id",
  "name",
  "service_id",
  "paths",
  "methods",
  "hosts",
]);

/** The route form (RouteForm board). */
export function RouteForm({
  fields,
  field,
  toolbar,
}: {
  fields: string[];
  field: FieldOf;
  toolbar: ReactNode;
}) {
  const intl = useIntl();
  return (
    <SimpleForm toolbar={toolbar} className="max-w-none">
      <TwoColumns
        main={
          <>
            <FormCard title={intl.formatMessage(uiFormBasics)}>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {field("name")}
                <div className="flex flex-col gap-1">
                  {field("service_id")}
                  <Link
                    to="/services/create"
                    className="text-sm text-primary underline"
                  >
                    {intl.formatMessage(uiFormCreateService)}
                  </Link>
                </div>
              </div>
            </FormCard>
            <FormCard title={intl.formatMessage(uiFormMatches)}>
              <p className="text-sm text-muted-foreground">
                {intl.formatMessage(uiFormMatchesHint)}
              </p>
              {/* Paths as removable chips, with the field's error. */}
              <TextArrayInput source="paths" validate={pathsValid} />
              <MethodsInput />
              {field("hosts")}
            </FormCard>
            <Advanced summary={intl.formatMessage(uiFormRouteAdvanced)}>
              {fields.filter((name) => !ROUTE_PLACED.has(name)).map(field)}
            </Advanced>
          </>
        }
        side={<DeckPreview resource="routes" />}
      />
    </SimpleForm>
  );
}

/** Service fields by card; the rest are Advanced. */
const SERVICE_BASICS = ["name", "enabled"];
const SERVICE_DESTINATION = ["protocol", "host", "port", "path"];

/**
 * The service form (the route form's pattern): Basics, "Where it
 * sends requests", the rest under a closed Advanced, and the preview.
 */
export function ServiceForm({
  fields,
  field,
  toolbar,
}: {
  fields: string[];
  field: FieldOf;
  toolbar: ReactNode;
}) {
  const intl = useIntl();
  const placed = new Set(["id", ...SERVICE_BASICS, ...SERVICE_DESTINATION]);
  return (
    <SimpleForm toolbar={toolbar} className="max-w-none">
      <TwoColumns
        main={
          <>
            <FormCard title={intl.formatMessage(uiFormBasics)}>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {SERVICE_BASICS.filter((name) => fields.includes(name)).map(
                  field,
                )}
              </div>
            </FormCard>
            <FormCard title={intl.formatMessage(uiFormDestination)}>
              <div className="grid items-start gap-4 sm:grid-cols-[8rem_minmax(0,1fr)_7rem]">
                {["protocol", "host", "port"].map(field)}
              </div>
              {field("path")}
            </FormCard>
            <Advanced summary={intl.formatMessage(uiFormAdvanced)}>
              {fields.filter((name) => !placed.has(name)).map(field)}
            </Advanced>
          </>
        }
        side={<DeckPreview resource="services" />}
      />
    </SimpleForm>
  );
}

/** The plugin's source: dropped or chosen as a file, viewed in the editor. */
function CodeDrop({ editor }: { editor: ReactNode }) {
  const intl = useIntl();
  const inputId = useId();
  const { field } = useInput({ source: "code" });
  const [file, setFile] = useState<string>();
  const [open, setOpen] = useState(false);
  const code = typeof field.value === "string" ? field.value : "";
  const read = async (chosen: File | undefined) => {
    if (!chosen) return;
    field.onChange(await chosen.text());
    setFile(chosen.name);
  };
  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        data-testid="code-drop"
        className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-6 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void read(event.dataTransfer.files[0]);
        }}
      >
        <Upload className="size-5" aria-hidden />
        <span className="font-medium">{intl.formatMessage(uiSandboxDrop)}</span>
        <span className="text-sm text-muted-foreground">
          {intl.formatMessage(uiSandboxDropHint as MessageDescriptor, {
            kib: SANDBOX.maxCodeBytes / KIB,
          })}
        </span>
        <input
          id={inputId}
          type="file"
          accept=".js,.mjs,text/javascript"
          className="sr-only"
          onChange={(event) => void read(event.target.files?.[0])}
        />
      </label>
      <div
        data-testid="code-summary"
        className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2 text-sm ${code ? "border-success-foreground/30 bg-success text-success-foreground" : "text-muted-foreground"}`}
      >
        {code ? (
          <>
            {file ? <span className="font-mono">{file}</span> : null}
            <span>
              {intl.formatMessage(uiSandboxFile as MessageDescriptor, {
                kib: Math.max(
                  1,
                  Math.round(new TextEncoder().encode(code).byteLength / KIB),
                ),
              })}
            </span>
          </>
        ) : (
          <span>{intl.formatMessage(uiSandboxNoFile)}</span>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => setOpen(!open)}
        >
          {intl.formatMessage(open ? uiSandboxHideSource : uiSandboxViewSource)}
        </Button>
      </div>
      {open ? editor : null}
    </div>
  );
}

/** A limit as a slider, from 1 to the sandbox's maximum. */
function LimitInput({
  source,
  label,
  fallback,
  max,
  unit,
}: {
  source: string;
  label: MessageDescriptor;
  fallback: number;
  max: number;
  unit: (value: number) => string;
}) {
  const intl = useIntl();
  const id = useId();
  const { field } = useInput({ source });
  const value = typeof field.value === "number" ? field.value : fallback;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {intl.formatMessage(label)}
        </label>
        <span className="font-mono text-sm">{unit(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={max}
        value={value}
        onChange={(event) => field.onChange(Number(event.target.value))}
        className="h-6 w-full accent-primary"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {intl.formatMessage(uiSandboxDefault as MessageDescriptor, {
            value: unit(fallback),
          })}
        </span>
        <span>
          {intl.formatMessage(uiSandboxMost as MessageDescriptor, {
            value: unit(max),
          })}
        </span>
      </div>
    </div>
  );
}

/**
 * The bindings it may use, as checkboxes: the gateway has no
 * list to offer, so each is named here and added checked; unchecking takes
 * it off. The gateway gives the plugin only a binding it allows.
 */
function BindingsInput() {
  const intl = useIntl();
  const inputId = useId();
  const { field } = useInput({ source: "bindings" });
  const bindings: string[] = Array.isArray(field.value) ? field.value : [];
  const [named, setNamed] = useState<string[]>(bindings);
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    if (!named.includes(name)) setNamed([...named, name]);
    if (!bindings.includes(name)) field.onChange([...bindings, name]);
  };
  return (
    <fieldset className="flex flex-col gap-2" data-testid="bindings">
      <legend className="mb-2 text-sm font-medium">
        {intl.formatMessage(uiSandboxBindings)}
      </legend>
      {named.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {named.map((name) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Checkbox renders its input inside this label.
            <label
              key={name}
              className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 font-mono text-sm"
            >
              <Checkbox
                checked={bindings.includes(name)}
                onCheckedChange={(on) =>
                  field.onChange(
                    on
                      ? [...bindings, name]
                      : bindings.filter((b) => b !== name),
                  )
                }
              />
              {name}
            </label>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          id={inputId}
          aria-label={intl.formatMessage(uiSandboxAddBinding)}
          className="h-11 max-w-xs font-mono"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" className="h-11" onClick={add}>
          {intl.formatMessage(uiSandboxAddBinding)}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {intl.formatMessage(
          bindings.length > 0 ? uiSandboxBindingsAllow : uiSandboxBindingsNone,
        )}
      </p>
    </fieldset>
  );
}

/** The upload form (Sandbox board). */
export function SandboxForm({
  field,
  banner,
  editor,
  toolbar,
}: {
  field: FieldOf;
  /** The trust and limits note (`secrets.tsx`). */
  banner: ReactNode;
  editor: ReactNode;
  toolbar: ReactNode;
}) {
  const intl = useIntl();
  const ms = (value: number) =>
    intl.formatMessage(uiSandboxMs as MessageDescriptor, { value });
  return (
    <SimpleForm toolbar={toolbar} className="max-w-none">
      {banner}
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <FormCard title={intl.formatMessage(uiSandboxCode)}>
          <CodeDrop editor={editor} />
          <div className="grid items-start gap-4 sm:grid-cols-3">
            {field("name")}
            {field("version")}
            {field("priority")}
          </div>
        </FormCard>
        <FormCard title={intl.formatMessage(uiSandboxLimitsTitle)}>
          <LimitInput
            source="cpu_ms"
            label={uiFieldCpuMs}
            fallback={SANDBOX.cpuMs}
            max={SANDBOX.maxCpuMs}
            unit={ms}
          />
          <LimitInput
            source="sub_requests"
            label={uiFieldSubRequests}
            fallback={SANDBOX.subRequests}
            max={SANDBOX.maxSubRequests}
            unit={String}
          />
          <BindingsInput />
        </FormCard>
      </div>
    </SimpleForm>
  );
}

/** Arrays as badges, mono (lists and detail pages). */
export function Badges({ values }: { values: unknown[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={String(value)} variant="secondary" className="font-mono">
          {String(value)}
        </Badge>
      ))}
    </span>
  );
}

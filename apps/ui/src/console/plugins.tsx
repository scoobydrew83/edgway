/**
 * The plugin catalog (Kong's plugins by category) and a plugin's form: a
 * scope picker and its config, rendered by react-jsonschema-form
 * (@rjsf/shadcn) from Kong's own JSON Schema (`/plugin-schemas/{name}`).
 */
import { ADMIN_PAGE } from "@edgway/constants";
import { ERR } from "@edgway/errors";
import { errorDocsUrl } from "@edgway/errors/docs";
import {
  uiCategoryAi,
  uiCategoryAuthentication,
  uiCategoryLogging,
  uiCategoryOther,
  uiCategorySecurity,
  uiCategoryTrafficControl,
  uiCategoryTransformations,
  uiFormStagePlugin,
  uiPluginsAdd,
  uiPluginsAdded,
  uiPluginsAddTitle,
  uiPluginsCallers,
  uiPluginsCallersRateLimited,
  uiPluginsCallersRefused,
  uiPluginsEditTitle,
  uiPluginsFilter,
  uiPluginsFilterAll,
  uiPluginsHintConsumer,
  uiPluginsHintGlobal,
  uiPluginsHintRoute,
  uiPluginsHintService,
  uiPluginsInUse,
  uiPluginsSaved,
  uiPluginsSchemaNote,
  uiPluginsScope,
  uiPluginsStaged,
  uiPluginsStageNote,
  uiPluginsTargetRequired,
  uiPluginsTitle,
  uiPluginsWhere,
  uiWhichLevelConsumer,
  uiWhichLevelGlobal,
  uiWhichLevelRoute,
  uiWhichLevelService,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Loading } from "@edgway/ui-kit/components/admin/loading";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { Button, buttonVariants } from "@edgway/ui-kit/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@edgway/ui-kit/components/ui/card";
import { Label } from "@edgway/ui-kit/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@edgway/ui-kit/components/ui/radio-group";
import type { RJSFSchema } from "@rjsf/utils";
import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { type ReactNode, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link, useNavigate, useParams } from "react-router";
import { call, client } from "../data-provider";
import { ErrorState, problemOf } from "../error-state";
import { useCan } from "../role";
import { toDeck } from "./deck";
import { DeckPanel } from "./deck-panel";
import { type Change, usePendingChanges } from "./pending";
import { DESCRIPTIONS } from "./plugin-descriptions";
import { PluginConfigForm } from "./plugin-form";
import { PLUGIN_LAYOUTS } from "./plugin-layouts";

const CATEGORIES: Record<string, MessageDescriptor> = {
  authentication: uiCategoryAuthentication,
  security: uiCategorySecurity,
  "traffic-control": uiCategoryTrafficControl,
  transformations: uiCategoryTransformations,
  logging: uiCategoryLogging,
  ai: uiCategoryAi,
  other: uiCategoryOther,
};

/**
 * Plugin names with unpublished changes, from the pending diff: a whole
 * plugin's value or old value names it; a field change is looked up by the
 * plugin's id in the (staged) plugins list.
 */
function stagedNames(
  changes: Change[],
  plugins: { id: unknown; name: unknown }[],
) {
  const byId = new Map(plugins.map((p) => [String(p.id), String(p.name)]));
  const names = new Set<string>();
  for (const change of changes) {
    if (change.path[0] !== "plugins") continue;
    const whole = (change.value ?? change.oldValue) as
      | { name?: unknown }
      | undefined;
    const name =
      change.path.length === 2 && typeof whole?.name === "string"
        ? whole.name
        : byId.get(String(change.path[1]));
    if (name) names.add(name);
  }
  return names;
}

export function PluginCatalogPage() {
  const intl = useIntl();
  const dataProvider = useDataProvider();
  const [category, setCategory] = useState<string>();
  const { data, error, refetch } = useQuery({
    queryKey: ["plugin-catalog"],
    retry: 1,
    queryFn: async () =>
      (
        (await call(sdk.pluginCatalog({ client }))) as {
          data: { name: string; category: string }[];
        }
      ).data,
  });
  // Which plugins are configured, and which have unpublished changes.
  const configured = useQuery({
    queryKey: ["plugin-catalog-configured"],
    queryFn: async () =>
      (
        await dataProvider.getList("plugins", {
          pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
          sort: { field: "id", order: "ASC" },
          filter: {},
        })
      ).data as { id: unknown; name: unknown }[],
  });
  const pending = usePendingChanges();
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <Loading />;
  const staged = stagedNames(
    pending.data?.changes ?? [],
    configured.data ?? [],
  );
  const inUse = new Set((configured.data ?? []).map((p) => String(p.name)));
  const present = Object.keys(CATEGORIES).filter((c) =>
    data.some((p) => p.category === c),
  );
  const shown = category ? data.filter((p) => p.category === category) : data;
  return (
    <div className="flex flex-col gap-4 py-4">
      <h1 className="text-2xl font-semibold">
        {intl.formatMessage(uiPluginsTitle)}
      </h1>
      <fieldset
        className="flex flex-wrap gap-1"
        aria-label={intl.formatMessage(uiPluginsFilter)}
      >
        {[undefined, ...present].map((key) => (
          <Button
            key={key ?? "all"}
            size="sm"
            variant={key === category ? "default" : "outline"}
            aria-pressed={key === category}
            onClick={() => setCategory(key)}
          >
            {intl.formatMessage(
              (key ? CATEGORIES[key] : uiPluginsFilterAll) as MessageDescriptor,
            )}
          </Button>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((plugin) => {
          const description = DESCRIPTIONS[plugin.name];
          const state = staged.has(plugin.name)
            ? uiPluginsStaged
            : inUse.has(plugin.name)
              ? uiPluginsInUse
              : undefined;
          return (
            <Card
              key={plugin.name}
              size="sm"
              data-testid={`plugin-card-${plugin.name}`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-mono">
                  {plugin.name}
                  {state ? (
                    <Badge
                      variant={
                        state === uiPluginsStaged ? "outline" : "secondary"
                      }
                      className={
                        state === uiPluginsStaged
                          ? "border-warning-foreground/30 bg-warning text-warning-foreground"
                          : undefined
                      }
                    >
                      {intl.formatMessage(state)}
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardAction>
                  <Link
                    to={`/plugin-catalog/${plugin.name}`}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    {intl.formatMessage(uiPluginsAdd)}
                  </Link>
                </CardAction>
                {description ? (
                  <p className="text-sm text-muted-foreground">
                    {intl.formatMessage(description)}
                  </p>
                ) : null}
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

type Scope = "global" | "service" | "route" | "consumer";

/** Each scope's plugin field and the resource it names. */
const SCOPES: Record<
  Scope,
  {
    label: MessageDescriptor;
    hint: MessageDescriptor;
    field?: string;
    resource?: string;
    title?: string;
  }
> = {
  global: { label: uiWhichLevelGlobal, hint: uiPluginsHintGlobal },
  service: {
    label: uiWhichLevelService,
    hint: uiPluginsHintService,
    field: "service_id",
    resource: "services",
    title: "name",
  },
  route: {
    label: uiWhichLevelRoute,
    hint: uiPluginsHintRoute,
    field: "route_id",
    resource: "routes",
    title: "name",
  },
  consumer: {
    label: uiWhichLevelConsumer,
    hint: uiPluginsHintConsumer,
    field: "consumer_id",
    resource: "consumers",
    title: "username",
  },
};

export function PluginFormPage() {
  const intl = useIntl();
  // Staging needs an editor; ViewerNotice says why.
  const canEdit = useCan("editor");
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const dataProvider = useDataProvider();
  const [scope, setScope] = useState<Scope>("global");
  const [target, setTarget] = useState("");
  // The config as typed, for the decK preview.
  const [config, setConfig] = useState<unknown>({});
  const { resource, field, title } = SCOPES[scope];

  const schema = useQuery({
    queryKey: ["plugin-schema", name],
    retry: 1,
    queryFn: async () =>
      (await call(sdk.pluginSchema({ client, path: { name } }))) as {
        properties: { config: RJSFSchema };
      },
  });
  const targets = useQuery({
    queryKey: ["plugin-targets", resource],
    enabled: Boolean(resource),
    queryFn: async () =>
      (
        await dataProvider.getList(resource ?? "", {
          pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
          sort: { field: "id", order: "ASC" },
          filter: {},
        })
      ).data,
  });

  if (schema.error) {
    return <ErrorState error={schema.error} onRetry={() => schema.refetch()} />;
  }
  if (!schema.data) return <Loading />;
  const save = async (config: unknown) => {
    try {
      await dataProvider.create("plugins", {
        data: { name, config, ...(field ? { [field]: target } : {}) },
      });
    } catch (error) {
      // The admin's problem (e.g. an invalid config Kong's schema rejects).
      notify((error as Error).message, { type: "error" });
      return;
    }
    notify(intl.formatMessage(uiPluginsAdded), { type: "success" });
    navigate("/plugins");
  };

  // The plugin being added, as decK would have it (`route: <id>`, …).
  const preview = toDeck({
    plugins: [
      { name, ...(field && target ? { [field]: target } : {}), config },
    ],
  });

  return (
    <div className="flex flex-col gap-6 py-4">
      <PluginHeading name={name} title={uiPluginsAddTitle} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card role="region" aria-label={intl.formatMessage(uiPluginsWhere)}>
            <CardHeader>
              <CardTitle>{intl.formatMessage(uiPluginsWhere)}</CardTitle>
            </CardHeader>
            <CardContent className="gap-4">
              <RadioGroup
                value={scope}
                aria-label={intl.formatMessage(uiPluginsScope)}
                onValueChange={(value) => {
                  setScope(value as Scope);
                  setTarget("");
                }}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                {Object.entries(SCOPES).map(([key, { label, hint }]) => (
                  <Label
                    key={key}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-data-checked:border-primary has-data-checked:bg-primary/5"
                  >
                    <RadioGroupItem value={key} className="mt-0.5" />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {intl.formatMessage(label)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {intl.formatMessage(hint)}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
              {resource ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="plugin-target">
                    {intl.formatMessage(SCOPES[scope].label)}
                  </Label>
                  <select
                    id="plugin-target"
                    className="h-11 max-w-md rounded-lg border border-input bg-transparent px-3 font-mono text-sm shadow-xs"
                    value={target}
                    required
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    <option value="" />
                    {(targets.data ?? []).map((row) => (
                      <option key={row.id} value={String(row.id)}>
                        {String(row[title ?? "id"] ?? row.id)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <PluginConfigForm
            name={name}
            schema={schema.data.properties.config}
            onChange={setConfig}
            onSubmit={(formData) => {
              // The scope pickers sit outside RJSF's form: check the target here.
              if (field && !target) {
                notify(intl.formatMessage(uiPluginsTargetRequired), {
                  type: "error",
                });
                return;
              }
              void save(formData);
            }}
          >
            <StageButtons disabled={!canEdit} />
          </PluginConfigForm>
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          <DeckPanel yaml={preview} testId="plugin-preview" />
          <WhatCallersSee name={name} />
        </aside>
      </div>
    </div>
  );
}

/** "Add rate-limiting": the name in mono, and what it does. */
function PluginHeading({
  name,
  title,
}: {
  name: string;
  title: MessageDescriptor;
}) {
  const intl = useIntl();
  const description = DESCRIPTIONS[name];
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-3xl font-semibold">
        {intl.formatMessage(title as MessageDescriptor, {
          name: <code className="font-mono">{name}</code>,
        })}
      </h1>
      <p className="flex flex-wrap gap-x-1 text-sm text-muted-foreground">
        {description ? <span>{intl.formatMessage(description)}</span> : null}
        <span>{intl.formatMessage(uiPluginsSchemaNote)}</span>
      </p>
    </div>
  );
}

/** "Stage plugin", Cancel, and when it goes live. */
function StageButtons({ disabled }: { disabled: boolean }) {
  const intl = useIntl();
  const translate = useTranslate();
  const navigate = useNavigate();
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Button type="submit" size="lg" disabled={disabled}>
        {intl.formatMessage(uiFormStagePlugin)}
      </Button>
      <Button
        type="button"
        size="lg"
        variant="outline"
        onClick={() => navigate(-1)}
      >
        {translate("ra.action.cancel")}
      </Button>
      <span className="text-sm text-muted-foreground">
        {intl.formatMessage(uiPluginsStageNote)}
      </span>
    </div>
  );
}

/** What a caller the plugin refuses gets, with the error's docs page. */
function WhatCallersSee({ name }: { name: string }) {
  const intl = useIntl();
  const refusal = PLUGIN_LAYOUTS[name]?.whatCallersSee;
  if (!refusal) return null;
  return (
    <Card role="region" aria-label={intl.formatMessage(uiPluginsCallers)}>
      <CardHeader>
        <CardTitle>{intl.formatMessage(uiPluginsCallers)}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(
            (refusal === ERR.RATE_LIMITED
              ? uiPluginsCallersRateLimited
              : uiPluginsCallersRefused) as MessageDescriptor,
            {
              status: <span className="font-mono">{refusal.status}</span>,
              code: (
                <a
                  href={errorDocsUrl(refusal.code)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-primary underline"
                >
                  {refusal.code}
                </a>
              ),
            },
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * A plugin's edit page: its config in the same schema form as when
 * it was added, instead of raw JSON. A plugin without a schema (an uploaded
 * one) keeps the generic form, `fallback`.
 */

export function PluginEditPage({
  fallback: Fallback,
}: {
  fallback: () => ReactNode;
}) {
  const intl = useIntl();
  // Staging needs an editor; ViewerNotice says why.
  const canEdit = useCan("editor");
  const notify = useNotify();
  const navigate = useNavigate();
  const dataProvider = useDataProvider();
  const { id = "" } = useParams();
  const record = useQuery({
    queryKey: ["plugin-record", id],
    retry: 1,
    queryFn: async () =>
      (await dataProvider.getOne("plugins", { id })).data as {
        id: string;
        name: string;
        config?: Record<string, unknown>;
      },
  });
  const name = record.data?.name;
  const schema = useQuery({
    queryKey: ["plugin-schema", name],
    enabled: Boolean(name),
    retry: false,
    queryFn: async () =>
      (await call(
        sdk.pluginSchema({ client, path: { name: name ?? "" } }),
      )) as {
        properties: { config: RJSFSchema };
      },
  });
  if (record.error) {
    return <ErrorState error={record.error} onRetry={() => record.refetch()} />;
  }
  if (schema.error) {
    // No schema (an uploaded plugin, the admin's not-found problem): the
    // generic form. Any other failure is the admin's error.
    if (problemOf(schema.error).code === ERR.ADMIN_NOT_FOUND.code) {
      return <Fallback />;
    }
    return <ErrorState error={schema.error} onRetry={() => schema.refetch()} />;
  }
  if (!record.data || !schema.data) return <Loading />;
  const plugin = record.data;
  return (
    <div className="flex flex-col gap-6 py-4">
      <PluginHeading name={plugin.name} title={uiPluginsEditTitle} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <PluginConfigForm
            name={plugin.name}
            schema={schema.data.properties.config}
            formData={plugin.config ?? {}}
            onSubmit={async (formData) => {
              try {
                await dataProvider.update("plugins", {
                  id: plugin.id,
                  data: { ...plugin, config: formData },
                  previousData: plugin,
                });
              } catch (error) {
                notify((error as Error).message, { type: "error" });
                return;
              }
              notify(intl.formatMessage(uiPluginsSaved), { type: "success" });
              navigate(`/plugins/${plugin.id}/show`);
            }}
          >
            <StageButtons disabled={!canEdit} />
          </PluginConfigForm>
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          <WhatCallersSee name={plugin.name} />
        </aside>
      </div>
    </div>
  );
}

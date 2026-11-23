/**
 * The admin UI's entities, laid out like Kong Manager (PRD "Admin UI"): a
 * list → detail → edit flow for each, with related entities as nested tables
 * on the detail page (service → routes and plugins, consumer → credentials
 * and plugins). Form inputs come from the SDK's generated zod body schemas,
 * so they follow the API; labels come from @edgway/i18n (`fields.ts`).
 * Lists have a search box first, with tags as a secondary filter, and show
 * arrays as badges; routes, services and uploaded plugins have their own
 * form layouts (`forms.tsx`).
 */

import { isVaultReference } from "@edgway/adapters-cf/secrets";
import { ADMIN_PAGE, VAULT_REFERENCE, VAULTS } from "@edgway/constants";
import {
  uiCertKeyHint,
  uiCertKeyInvalid,
  uiCredentialsAdd,
  uiFieldCode,
  uiFilterMethodAny,
  uiFilterServiceAny,
  uiFilterTags,
  uiFormNameHint,
  uiFormStageNote,
  uiFormStagePlugin,
  uiFormStagePluginNote,
  uiFormStageRoute,
  uiFormStageRouteNote,
  uiFormStageService,
  uiListFilter,
  uiListNext,
  uiListPrevious,
  uiListSearch,
  uiNavAcls,
  uiNavBasicAuth,
  uiNavCaCertificates,
  uiNavCertificates,
  uiNavConsumerGroups,
  uiNavConsumers,
  uiNavJwtSecrets,
  uiNavKeyAuth,
  uiNavPlugins,
  uiNavRoutes,
  uiNavSandboxPlugins,
  uiNavServices,
  uiNavSnis,
  uiNavTargets,
  uiNavUpstreams,
  uiNavVaults,
  uiPageCreate,
  uiPageEdit,
  uiPageUpload,
  uiRoutesAnyHost,
  uiRoutesAnyMethod,
  uiRoutesNoPlugins,
  uiRoutesPlugins,
  uiSandboxPriorityHint,
  uiSecretMasked,
  uiValidationJson,
  uiVaultHint,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import {
  BooleanInput,
  Create,
  DataTable,
  Edit,
  ExportButton,
  FilterButton,
  List,
  NumberInput,
  RecordField,
  ReferenceField,
  ReferenceInput,
  ReferenceManyField,
  SearchInput,
  SelectInput,
  Show,
  SimpleForm,
  SimpleShowLayout,
  TextArrayInput,
  TextInput,
} from "@edgway/ui-kit/components/admin";
import { Loading } from "@edgway/ui-kit/components/admin/loading";
import { useTheme } from "@edgway/ui-kit/components/admin/use-theme";
import { Button, buttonVariants } from "@edgway/ui-kit/components/ui/button";
import { Plus } from "lucide-react";
import {
  required,
  useCreatePath,
  useGetList,
  useInput,
  useListContext,
  useRecordContext,
  useResourceContext,
  useResourceDefinition,
} from "ra-core";
import { lazy, type ReactNode, Suspense } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { z } from "zod";
import { ConsumerActions, ConsumerPage, ConsumerTitle } from "./consumer-page";
import { ENTITY_NAMES } from "./fields";
import {
  Badges,
  type FieldOf,
  METHODS,
  RouteForm,
  SandboxForm,
  ServiceForm,
  StageToolbar,
} from "./forms";
import { pascal } from "./names";
import { useCan } from "./role";
import { CertificatesPage, VaultsPage } from "./secret-pages";
import { SandboxLimits } from "./secrets";
import { ServiceActions, ServicePage } from "./service-flow";
import { UpstreamActions, UpstreamPage } from "./upstream";

interface Related {
  /** The related resource and its reference to this one. */
  reference: string;
  target: string;
}

export interface ResourceConfig {
  name: string;
  label: MessageDescriptor;
  /** Columns shown in the list. */
  columns: string[];
  related?: Related[];
  /** Credentials: no detail or edit page of their own. */
  nested?: boolean;
  /** No edit page (key-auth keys are hashed; rotate instead). */
  noEdit?: boolean;
  /** How a record is named elsewhere; the first column when unset. */
  represent?: (record: Record<string, unknown>) => string;
}

export const RESOURCES: ResourceConfig[] = [
  {
    name: "services",
    label: uiNavServices,
    columns: ["name", "protocol", "host", "port", "path", "enabled"],
  },
  {
    name: "routes",
    label: uiNavRoutes,
    columns: ["name", "paths", "methods", "hosts", "service_id"],
    related: [{ reference: "plugins", target: "route_id" }],
  },
  {
    name: "upstreams",
    label: uiNavUpstreams,
    columns: ["name", "algorithm", "slots"],
    // Targets, with their share, are on the upstream's page (UpstreamPage).
  },
  {
    name: "targets",
    label: uiNavTargets,
    columns: ["target", "weight", "upstream_id"],
  },
  {
    name: "sandbox_plugins",
    label: uiNavSandboxPlugins,
    columns: ["name", "version", "priority"],
  },
  {
    name: "consumers",
    label: uiNavConsumers,
    columns: ["username", "display_name", "custom_id"],
    // A portal developer has no username, only a display name.
    represent: (record) =>
      String(record.username ?? record.display_name ?? record.id),
  },
  {
    name: "consumer_groups",
    label: uiNavConsumerGroups,
    columns: ["name"],
    related: [{ reference: "plugins", target: "consumer_group_id" }],
  },
  {
    name: "key-auth",
    label: uiNavKeyAuth,
    columns: ["key_prefix", "ttl", "consumer_id"],
    nested: true,
    noEdit: true,
  },
  {
    name: "basic-auth",
    label: uiNavBasicAuth,
    columns: ["username", "consumer_id"],
    nested: true,
  },
  {
    name: "jwt_secrets",
    label: uiNavJwtSecrets,
    columns: ["key", "algorithm", "consumer_id"],
  },
  { name: "acls", label: uiNavAcls, columns: ["group", "consumer_id"] },
  {
    name: "plugins",
    label: uiNavPlugins,
    columns: ["name", "enabled", "service_id", "route_id", "consumer_id"],
  },
  {
    name: "certificates",
    label: uiNavCertificates,
    columns: ["id", "tags"],
    related: [{ reference: "snis", target: "certificate_id" }],
  },
  {
    name: "ca_certificates",
    label: uiNavCaCertificates,
    columns: ["id", "tags"],
  },
  { name: "snis", label: uiNavSnis, columns: ["name", "certificate_id"] },
  { name: "vaults", label: uiNavVaults, columns: ["prefix", "name"] },
];

/** Reference columns → the resource they name. */
const REFERENCES: Record<string, string> = {
  service_id: "services",
  route_id: "routes",
  consumer_id: "consumers",
  consumer_group_id: "consumer_groups",
  upstream_id: "upstreams",
  certificate_id: "certificates",
  client_certificate_id: "certificates",
};

/** PEM blocks: multiline inputs. */
const PEM_FIELDS = new Set([
  "cert",
  "cert_alt",
  "key",
  "key_alt",
  "rsa_public_key",
]);

/** Secrets: stored as vault references, shown masked unless they are one. */
const SECRET_FIELDS = new Set(["key", "key_alt", "secret", "password"]);

/** JSON columns holding objects (the rest hold string lists). */
const OBJECT_FIELDS = new Set([
  "config",
  "headers",
  "ordering",
  "sources",
  "destinations",
  "healthchecks",
]);

/** The SDK's zod schema for a resource's create body. */
function bodyShape(resource: string): Record<string, z.ZodType> {
  const schema = (sdk as unknown as Record<string, unknown>)[
    `zCreate${pascal(resource)}Body`
  ];
  return schema instanceof z.ZodObject
    ? (schema.shape as Record<string, z.ZodType>)
    : {};
}

/** Strips optional/nullable/default wrappers; reports whether it was required. */
function unwrap(schema: z.ZodType): { base: z.ZodType; optional: boolean } {
  let base = schema;
  let optional = false;
  while (
    base instanceof z.ZodOptional ||
    base instanceof z.ZodNullable ||
    base instanceof z.ZodDefault
  ) {
    optional = true;
    base = (base as z.ZodOptional<z.ZodType>).unwrap() as z.ZodType;
  }
  return { base, optional };
}

/** A JSON object edited as text. */
function JsonInput({ source }: { source: string }) {
  const intl = useIntl();
  const invalid = intl.formatMessage(uiValidationJson);
  return (
    <TextInput
      source={source}
      multiline
      rows={6}
      format={(value: unknown) =>
        value === undefined || value === null
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value, null, 2)
      }
      parse={(text: string) => {
        if (text.trim() === "") return null;
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }}
      validate={(value: unknown) =>
        typeof value === "string" ? invalid : undefined
      }
    />
  );
}

/** Monaco, fetched only when a plugin's code is edited. */
const CodeEditor = lazy(() => import("./console/code-editor"));

/** An uploaded plugin's JavaScript source, in Monaco. */
function CodeInput({ source }: { source: string }) {
  const intl = useIntl();
  const { theme } = useTheme();
  const { field } = useInput({ source, validate: required() });
  // The kit's theme provider marks the resolved theme on <html>.
  const dark =
    theme === "dark" || document.documentElement.classList.contains("dark");
  return (
    <Suspense fallback={<Loading />}>
      <CodeEditor
        value={String(field.value ?? "")}
        onChange={field.onChange}
        dark={dark}
        label={intl.formatMessage(uiFieldCode)}
      />
    </Suspense>
  );
}

function input(
  source: string,
  schema: z.ZodType,
  scope?: string,
  /** The resource the form edits, for its own field rules. */
  resource?: string,
): ReactNode {
  const { base, optional } = unwrap(schema);
  if (source === "code") return <CodeInput key={source} source={source} />;
  const validate = optional ? undefined : required();
  const reference = REFERENCES[source];
  if (reference && source !== scope) {
    return (
      <ReferenceInput key={source} source={source} reference={reference} />
    );
  }
  if (base instanceof z.ZodBoolean) {
    return <BooleanInput key={source} source={source} />;
  }
  if (base instanceof z.ZodNumber) {
    return (
      <NumberInput
        key={source}
        source={source}
        // A catalog id: the kit translates a string hint.
        helperText={
          resource === "sandbox_plugins" && source === "priority"
            ? uiSandboxPriorityHint.id
            : undefined
        }
        validate={validate}
      />
    );
  }
  if (base instanceof z.ZodUnion || base instanceof z.ZodArray) {
    return OBJECT_FIELDS.has(source) ? (
      <JsonInput key={source} source={source} />
    ) : (
      <TextArrayInput key={source} source={source} />
    );
  }
  if (base instanceof z.ZodRecord) {
    return <JsonInput key={source} source={source} />;
  }
  // A certificate's private keys: vault references only (the admin
  // refuses anything else too).
  if (resource === "certificates" && CERT_KEY_FIELDS.has(source)) {
    return (
      <TextInput
        key={source}
        source={source}
        validate={[
          ...(validate ? [validate] : []),
          (value: unknown) =>
            value === undefined ||
            value === null ||
            value === "" ||
            isVaultReference(value)
              ? undefined
              : {
                  message: uiCertKeyInvalid.id,
                  args: { example: VAULT_EXAMPLE },
                },
        ]}
        helperText={<CertKeyHint />}
      />
    );
  }
  return (
    <TextInput
      key={source}
      source={source}
      validate={validate}
      multiline={PEM_FIELDS.has(source)}
      rows={PEM_FIELDS.has(source) ? 6 : undefined}
      helperText={
        SECRET_FIELDS.has(source) ? (
          <VaultHint key="hint" />
        ) : source === "name" && NAME_HINT.has(resource ?? "") ? (
          uiFormNameHint.id
        ) : undefined
      }
    />
  );
}

/** Forms whose name field gets Kong's naming hint. */
const NAME_HINT = new Set(["routes", "services"]);

/** The hint's example reference. */
const VAULT_EXAMPLE = `${VAULT_REFERENCE.prefix}env/name${VAULT_REFERENCE.suffix}`;

/** Under a secret's input: secrets are vault references, never values. */
function VaultHint() {
  const intl = useIntl();
  return (
    <>
      {intl.formatMessage(uiVaultHint as MessageDescriptor, {
        example: VAULT_EXAMPLE,
      })}
    </>
  );
}

/** A certificate's private key fields. */
const CERT_KEY_FIELDS = new Set(["key", "key_alt"]);

function CertKeyHint() {
  const intl = useIntl();
  return (
    <>
      {intl.formatMessage(uiCertKeyHint as MessageDescriptor, {
        example: VAULT_EXAMPLE,
        prefix: VAULTS.namePrefix,
      })}
    </>
  );
}

/** Form inputs for a resource, from its create body schema. */
function inputs(resource: string, nested: boolean): ReactNode[] {
  const shape = bodyShape(resource);
  const fields = Object.entries(shape)
    .filter(([name]) => name !== "id")
    .map(([name, schema]) => input(name, schema, undefined, resource));
  // A credential's owner is a path parameter, not part of its body.
  return nested
    ? [
        <ReferenceInput
          key="consumer_id"
          source="consumer_id"
          reference="consumers"
        />,
        ...fields,
      ]
    : fields;
}

/**
 * List filters: a search box first, then the routes list's service
 * and method; tags are secondary, behind "Add filter". The admin API filters
 * by tags; the rest filter the page here (`data-provider.ts`).
 */
function Filters(resource: string) {
  const intl = useIntl();
  return [
    <SearchInput
      key="q"
      source="q"
      alwaysOn
      placeholder={intl.formatMessage(
        resource === "routes" ? uiListSearch : uiListFilter,
      )}
      aria-label={intl.formatMessage(
        resource === "routes" ? uiListSearch : uiListFilter,
      )}
      className="min-w-64 md:min-w-[28rem]"
    />,
    ...(resource === "routes"
      ? [
          <ReferenceInput
            key="service_id"
            source="service_id"
            reference="services"
            alwaysOn
          >
            <SelectInput
              label={false}
              emptyText={intl.formatMessage(uiFilterServiceAny)}
              aria-label={intl.formatMessage(uiFilterServiceAny)}
            />
          </ReferenceInput>,
          <SelectInput
            key="methods"
            source="methods"
            label={false}
            alwaysOn
            emptyText={intl.formatMessage(uiFilterMethodAny)}
            aria-label={intl.formatMessage(uiFilterMethodAny)}
            choices={METHODS.map((m) => ({ id: m, name: m }))}
          />,
        ]
      : []),
    <TextInput
      key="tags"
      source="tags"
      label={intl.formatMessage(uiFilterTags)}
    />,
  ];
}

/** A cell: arrays as badges, empty route matches in words. */
function Cell({ column, value }: { column: string; value: unknown }) {
  const intl = useIntl();
  if (column === "methods" && (!Array.isArray(value) || value.length === 0)) {
    return <Badges values={[intl.formatMessage(uiRoutesAnyMethod)]} />;
  }
  if (column === "hosts" && (!Array.isArray(value) || value.length === 0)) {
    return (
      <span className="text-muted-foreground">
        {intl.formatMessage(uiRoutesAnyHost)}
      </span>
    );
  }
  if (Array.isArray(value)) return <Badges values={value} />;
  if (value === null || value === undefined) return null;
  return (
    <>{typeof value === "object" ? JSON.stringify(value) : String(value)}</>
  );
}

/**
 * A list column: a reference shows the referenced record's name.
 * The admin API doesn't sort, so columns aren't sortable.
 */
function column_(column: string) {
  const reference = REFERENCES[column];
  return reference ? (
    <DataTable.Col key={column} source={column} disableSort>
      <ReferenceField source={column} reference={reference} link="show" />
    </DataTable.Col>
  ) : (
    <DataTable.Col
      key={column}
      source={column}
      disableSort
      render={(record) => (
        <Cell column={column} value={(record as Row)[column]} />
      )}
    />
  );
}

type Row = Record<string, unknown>;

/**
 * The plugins that apply to a route (Routes board): set on it, on its
 * service, or everywhere. Consumer-scoped ones apply only to that caller,
 * so they aren't listed; the service page answers per caller.
 */
function RoutePlugins({ route }: { route: Row }) {
  const intl = useIntl();
  const { data = [] } = useGetList("plugins", {
    pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
  });
  const names = [
    ...new Set(
      (data as Row[])
        .filter(
          (p) =>
            p.enabled !== false &&
            !p.consumer_id &&
            !p.consumer_group_id &&
            (p.route_id
              ? p.route_id === route.id
              : !p.service_id || p.service_id === route.service_id),
        )
        .map((p) => String(p.name)),
    ),
  ];
  return names.length === 0 ? (
    <span className="text-muted-foreground">
      {intl.formatMessage(uiRoutesNoPlugins)}
    </span>
  ) : (
    <span className="font-mono text-xs">{names.join(" · ")}</span>
  );
}

/** Kong's cursor paging: Previous and Next page, no totals (ui-guidelines "Tables"). */
function Pager() {
  const intl = useIntl();
  const { page, setPage, hasPreviousPage, hasNextPage } = useListContext();
  return (
    <div className="flex justify-end gap-2 py-2">
      <Button
        variant="outline"
        disabled={!hasPreviousPage}
        onClick={() => setPage(page - 1)}
      >
        {intl.formatMessage(uiListPrevious)}
      </Button>
      <Button
        variant="outline"
        disabled={!hasNextPage}
        onClick={() => setPage(page + 1)}
      >
        {intl.formatMessage(uiListNext)}
      </Button>
    </div>
  );
}

/** "Create <entity>" as the primary action, then filters and export. */
function ListActions({ secondary }: { secondary: boolean }) {
  const intl = useIntl();
  const resource = useResourceContext() ?? "";
  const { hasCreate } = useResourceDefinition();
  const createPath = useCreatePath();
  const entity = ENTITY_NAMES[resource];
  return (
    <div className="flex items-center gap-2">
      {secondary ? <FilterButton /> : null}
      <ExportButton />
      {hasCreate && entity ? (
        <Link
          to={createPath({ resource, type: "create" })}
          className={buttonVariants({ variant: "default" })}
        >
          <Plus aria-hidden />
          {resource === "sandbox_plugins"
            ? intl.formatMessage(uiPageUpload)
            : intl.formatMessage(uiPageCreate as MessageDescriptor, {
                entity: intl.formatMessage(entity),
              })}
        </Link>
      ) : null}
    </div>
  );
}

/** Lists with their own page (the Vaults and Certificates boards). */
const LIST_PAGES: Record<string, () => ReactNode> = {
  vaults: VaultsPage,
  certificates: CertificatesPage,
};

export function makeList(config: ResourceConfig) {
  const page = LIST_PAGES[config.name];
  if (page) return page;
  return function ResourceList() {
    // A viewer can't stage a delete: no bulk actions.
    const canEdit = useCan("editor");
    const intl = useIntl();
    return (
      <List
        filters={Filters(config.name)}
        actions={<ListActions secondary />}
        pagination={<Pager />}
      >
        <DataTable
          rowClick={config.nested ? false : "show"}
          bulkActionButtons={canEdit ? undefined : false}
        >
          {config.columns.map((column) => column_(column))}
          {config.name === "routes" ? (
            <DataTable.Col
              label={intl.formatMessage(uiRoutesPlugins)}
              render={(record) => <RoutePlugins route={record as Row} />}
            />
          ) : null}
        </DataTable>
      </List>
    );
  };
}

function RelatedTables({ related }: { related: Related[] }) {
  const intl = useIntl();
  const record = useRecordContext();
  // A viewer gets no create pages and no bulk delete.
  const canEdit = useCan("editor");
  if (!record) return null;
  return related.map(({ reference, target }) => {
    const config = RESOURCES.find((r) => r.name === reference);
    return (
      <RecordField
        key={reference}
        source={reference}
        label={config ? intl.formatMessage(config.label) : undefined}
      >
        {/* Opens the create page with this record as the reference. */}
        {canEdit ? (
          <Link
            to={`/${reference}/create`}
            state={{ record: { [target]: record.id } }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {intl.formatMessage(uiCredentialsAdd as MessageDescriptor, {
              // Singular: "Add route".
              resource: intl.formatMessage(
                ENTITY_NAMES[reference] ?? config?.label ?? uiNavPlugins,
              ),
            })}
          </Link>
        ) : null}
        <ReferenceManyField reference={reference} target={target}>
          <DataTable
            rowClick={config?.nested ? false : "show"}
            bulkActionButtons={canEdit ? undefined : false}
          >
            {(config?.columns ?? ["id"])
              .filter((column) => column !== target)
              .map((column) => column_(column))}
          </DataTable>
        </ReferenceManyField>
      </RecordField>
    );
  });
}

/**
 * Entities with their own page (the Service, Upstream and Consumer
 * boards): a body and the header's actions, instead of every field.
 */
const PAGES: Record<
  string,
  { body: () => ReactNode; actions: () => ReactNode; title?: () => ReactNode }
> = {
  services: { body: ServicePage, actions: ServiceActions },
  upstreams: { body: UpstreamPage, actions: UpstreamActions },
  consumers: {
    body: ConsumerPage,
    actions: ConsumerActions,
    title: ConsumerTitle,
  },
};

export function makeShow(config: ResourceConfig) {
  const page = PAGES[config.name];
  if (page) {
    const { body: Body, actions: Actions, title: Title } = page;
    return function EntityPage() {
      return (
        <Show
          title={
            Title ? (
              <Title />
            ) : (
              <span className="font-mono">
                <RecordTitle config={config} />
              </span>
            )
          }
          actions={<Actions />}
        >
          <Body />
        </Show>
      );
    };
  }
  return function ResourceShow() {
    const intl = useIntl();
    const shape = bodyShape(config.name);
    return (
      <Show title={<RecordTitle config={config} />}>
        <SimpleShowLayout>
          <RecordField source="id" />
          {Object.keys(shape)
            .filter((name) => name !== "id")
            .map((name) => (
              <RecordField
                key={name}
                source={name}
                render={(record) => {
                  const value = record[name];
                  if (value === null || value === undefined) return "";
                  if (SECRET_FIELDS.has(name) && !isVaultReference(value)) {
                    return intl.formatMessage(uiSecretMasked);
                  }
                  if (Array.isArray(value)) return <Badges values={value} />;
                  return typeof value === "object" ? (
                    <pre className="whitespace-pre-wrap font-mono text-xs">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  ) : (
                    String(value)
                  );
                }}
              />
            ))}
          {config.related ? <RelatedTables related={config.related} /> : null}
        </SimpleShowLayout>
      </Show>
    );
  };
}

/** How a record is named: its `represent`, else its first column. */
function nameOf(config: ResourceConfig, record: Row): string {
  const column = config.columns[0] ?? "id";
  return config.represent
    ? config.represent(record)
    : String(record[column] ?? record.id ?? "");
}

/** A show or edit page's title: the entity's own name. */
function RecordTitle({
  config,
  edit = false,
}: {
  config: ResourceConfig;
  edit?: boolean;
}) {
  const intl = useIntl();
  const record = useRecordContext();
  if (!record) return null;
  const name = nameOf(config, record);
  return edit
    ? intl.formatMessage(uiPageEdit as MessageDescriptor, { name })
    : name;
}

/** A create page's title: "Create route", "Upload a plugin". */
function createTitle(intl: ReturnType<typeof useIntl>, resource: string) {
  if (resource === "sandbox_plugins") return intl.formatMessage(uiPageUpload);
  const entity = ENTITY_NAMES[resource];
  return entity
    ? intl.formatMessage(uiPageCreate as MessageDescriptor, {
        entity: intl.formatMessage(entity),
      })
    : undefined;
}

/** A form's body: the entity's own layout, or the schema's fields in order. */
function FormBody({ config }: { config: ResourceConfig }) {
  const shape = bodyShape(config.name);
  const fields = Object.keys(shape).filter((name) => name !== "id");
  const field: FieldOf = (name) =>
    name in shape
      ? input(name, shape[name] as z.ZodType, undefined, config.name)
      : null;
  if (config.name === "routes") {
    return (
      <RouteForm
        fields={fields}
        field={field}
        toolbar={
          <StageToolbar label={uiFormStageRoute} note={uiFormStageRouteNote} />
        }
      />
    );
  }
  if (config.name === "services") {
    return (
      <ServiceForm
        fields={fields}
        field={field}
        toolbar={
          <StageToolbar label={uiFormStageService} note={uiFormStageNote} />
        }
      />
    );
  }
  if (config.name === "sandbox_plugins") {
    return (
      <SandboxForm
        field={field}
        banner={<SandboxLimits />}
        editor={<CodeInput source="code" />}
        toolbar={
          <StageToolbar
            label={uiFormStagePlugin}
            note={uiFormStagePluginNote}
          />
        }
      />
    );
  }
  return <SimpleForm>{inputs(config.name, false)}</SimpleForm>;
}

export function makeEdit(config: ResourceConfig) {
  return function ResourceEdit() {
    return (
      <Edit
        mutationMode="pessimistic"
        title={<RecordTitle config={config} edit />}
      >
        <FormBody config={config} />
      </Edit>
    );
  };
}

export function makeCreate(config: ResourceConfig) {
  return function ResourceCreate() {
    const intl = useIntl();
    return (
      <Create redirect="show" title={createTitle(intl, config.name)}>
        <FormBody config={config} />
      </Create>
    );
  };
}

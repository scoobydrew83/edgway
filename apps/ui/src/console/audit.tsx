/**
 * The audit log (the Audit board): who changed what and
 * when, newest first, filtered on the server by who, action and entity, a
 * page at a time. Each event names its entity ("route public-ip", "plugin
 * rate-limiting on route httpbin-anything", from the admin) and expands
 * inline to its diff, request id and a link to the entity or version.
 */
import { AUDIT_PAGE } from "@edgway/constants";
import {
  uiAuditAction,
  uiAuditActionCreate,
  uiAuditActionDelete,
  uiAuditActionPublish,
  uiAuditActionRollback,
  uiAuditActionUpdate,
  uiAuditAll,
  uiAuditAnyEntity,
  uiAuditDetails,
  uiAuditEmpty,
  uiAuditEntity,
  uiAuditIntro,
  uiAuditMore,
  uiAuditNamed,
  uiAuditNamedOn,
  uiAuditOpen,
  uiAuditRequestId,
  uiAuditScoped,
  uiAuditTitle,
  uiAuditVersion,
  uiAuditWhat,
  uiAuditWhen,
  uiAuditWho,
  uiAuditWhoHint,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Loading } from "@edgway/ui-kit/components/admin/loading";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { Button } from "@edgway/ui-kit/components/ui/button";
import { Card, CardContent } from "@edgway/ui-kit/components/ui/card";
import { Input } from "@edgway/ui-kit/components/ui/input";
import { Label } from "@edgway/ui-kit/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@edgway/ui-kit/components/ui/table";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Fragment, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { readCertificate } from "../certificates";
import { call, client } from "../data-provider";
import { ErrorState } from "../error-state";
import { ENTITY_NAMES } from "../fields";
import { RESOURCES } from "../resources";
import { PUBLISH_PATH } from "./nav";

type Query = NonNullable<sdk.ListAuditEventsData["query"]>;
type Action = NonNullable<Query["action"]>;

type AuditPage = sdk.ListAuditEventsResponses[200];
type AuditEvent = AuditPage["data"][number];

const ACTIONS: Record<Action, MessageDescriptor> = {
  create: uiAuditActionCreate,
  update: uiAuditActionUpdate,
  delete: uiAuditActionDelete,
  publish: uiAuditActionPublish,
  rollback: uiAuditActionRollback,
};

/** An action's badge colors (ui-guidelines "Badges"). */
const ACTION_TINT: Record<Action, string> = {
  create: "bg-success text-success-foreground",
  update: "bg-warning text-warning-foreground",
  delete: "bg-destructive/10 text-destructive",
  publish: "bg-primary/10 text-primary",
  rollback: "bg-chart-5/15 text-chart-5",
};

/** Audit entity types that aren't the UI's resource names. */
const RESOURCE_OF: Record<string, string> = {
  keyauth_credentials: "key-auth",
  basicauth_credentials: "basic-auth",
};

/** The entity types an event can name, for the entity filter. */
const ENTITY_TYPES = [
  ...RESOURCES.filter((r) => !r.nested).map((r) => r.name),
  ...Object.keys(RESOURCE_OF),
  "consumer_group_consumers",
];

const SELECT =
  "h-11 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs";

/** An entity type, singular and lower case ("route"). */
function useEntityName() {
  const intl = useIntl();
  return (type: string) => {
    const entity = ENTITY_NAMES[RESOURCE_OF[type] ?? type];
    return entity ? intl.formatMessage(entity) : type;
  };
}

/** What an event changed: "route public-ip", or a version. */
function What({ event }: { event: AuditEvent }) {
  const intl = useIntl();
  const entityName = useEntityName();
  if (event.action === "publish" || event.action === "rollback") {
    return (
      <Link to={PUBLISH_PATH} className="text-primary underline">
        {intl.formatMessage(uiAuditVersion as MessageDescriptor, {
          version: event.entity_id,
        })}
      </Link>
    );
  }
  const resource = RESOURCES.find((r) => r.name === event.entity_type);
  // A certificate has no name: its subject, read from the PEM in the diff.
  const subject =
    event.entity_type === "certificates"
      ? readCertificate(certOf(event.diff))?.subject
      : undefined;
  const label = event.entity_name ?? subject ?? event.entity_id;
  // A removed entity has no page left to open.
  const name =
    resource &&
    !resource.nested &&
    event.entity_id &&
    event.action !== "delete" ? (
      <Link
        to={`/${event.entity_type}/${event.entity_id}/show`}
        className="font-mono text-primary underline"
      >
        {label}
      </Link>
    ) : (
      <span className="font-mono">{label}</span>
    );
  const named = Boolean(event.entity_name ?? subject);
  return (
    <span>
      {event.scope && !named
        ? intl.formatMessage(uiAuditScoped as MessageDescriptor, {
            type: entityName(event.entity_type),
            scopeType: entityName(event.scope.type),
            scope: <span className="font-mono">{event.scope.name}</span>,
          })
        : event.scope
          ? intl.formatMessage(uiAuditNamedOn as MessageDescriptor, {
              type: entityName(event.entity_type),
              name,
              scopeType: entityName(event.scope.type),
              scope: <span className="font-mono">{event.scope.name}</span>,
            })
          : intl.formatMessage(uiAuditNamed as MessageDescriptor, {
              type: entityName(event.entity_type),
              name,
            })}
    </span>
  );
}

/** The certificate PEM a create or delete event's diff carries. */
function certOf(diff: unknown): unknown {
  return (Array.isArray(diff) ? (diff as DiffEntry[]) : [])
    .filter((d) => d.path.length === 1 && d.path[0] === "cert")
    .map((d) => d.value ?? d.oldValue)
    .find((pem) => typeof pem === "string");
}

interface DiffEntry {
  type: "CREATE" | "REMOVE" | "CHANGE";
  path: (string | number)[];
  value?: unknown;
  oldValue?: unknown;
}

/** An event's diff as removed and added lines. */
function DiffLines({ diff }: { diff: unknown }) {
  const entries = (Array.isArray(diff) ? diff : []) as DiffEntry[];
  const line = (sign: "-" | "+", entry: DiffEntry, value: unknown) => {
    const text = `${JSON.stringify(entry.path.join("."))}: ${JSON.stringify(value)}`;
    return (
      <div
        key={`${sign}${entry.path.join(".")}`}
        className={
          sign === "-"
            ? "bg-destructive/10 text-destructive"
            : "bg-success text-success-foreground"
        }
      >
        <span className="inline-block w-6 select-none pl-2">{sign}</span>
        {text}
      </div>
    );
  };
  return (
    <pre className="overflow-auto rounded-lg border py-1 font-mono text-xs">
      {entries.flatMap((entry) => [
        ...(entry.type !== "CREATE" ? [line("-", entry, entry.oldValue)] : []),
        ...(entry.type !== "REMOVE" ? [line("+", entry, entry.value)] : []),
      ])}
    </pre>
  );
}

export function AuditPage() {
  const intl = useIntl();
  const entityName = useEntityName();
  const [action, setAction] = useState<Action | "">("");
  const [entity, setEntity] = useState("");
  // The who filter matches the whole identity: applied on Enter or leaving.
  const [who, setWho] = useState("");
  const [actor, setActor] = useState("");
  const [open, setOpen] = useState<string>();
  const events = useInfiniteQuery({
    queryKey: ["audit-events", action, entity, actor],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (await call(
        sdk.listAuditEvents({
          client,
          query: {
            ...(action ? { action } : {}),
            ...(entity ? { entity_type: entity } : {}),
            ...(actor ? { actor } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
            size: AUDIT_PAGE.defaultSize,
          },
        }),
      )) as AuditPage,
    getNextPageParam: (last) => last.next,
  });
  if (events.error) {
    return <ErrorState error={events.error} onRetry={() => events.refetch()} />;
  }
  const rows = events.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">
          {intl.formatMessage(uiAuditTitle)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(uiAuditIntro)}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-who">{intl.formatMessage(uiAuditWho)}</Label>
          <Input
            id="audit-who"
            className="h-11"
            placeholder={intl.formatMessage(uiAuditWhoHint)}
            value={who}
            onChange={(event) => setWho(event.target.value)}
            onBlur={() => setActor(who.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") setActor(who.trim());
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-action">
            {intl.formatMessage(uiAuditAction)}
          </Label>
          <select
            id="audit-action"
            className={SELECT}
            value={action}
            onChange={(event) => setAction(event.target.value as Action | "")}
          >
            <option value="">{intl.formatMessage(uiAuditAll)}</option>
            {Object.entries(ACTIONS).map(([key, label]) => (
              <option key={key} value={key}>
                {intl.formatMessage(label)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-entity">
            {intl.formatMessage(uiAuditEntity)}
          </Label>
          <select
            id="audit-entity"
            className={SELECT}
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
          >
            <option value="">{intl.formatMessage(uiAuditAnyEntity)}</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {entityName(type)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!events.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground" data-testid="audit-empty">
          {intl.formatMessage(uiAuditEmpty)}
        </p>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table data-testid="audit-log">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">
                    {intl.formatMessage(uiAuditWhen)}
                  </TableHead>
                  <TableHead>{intl.formatMessage(uiAuditWho)}</TableHead>
                  <TableHead>{intl.formatMessage(uiAuditAction)}</TableHead>
                  <TableHead>{intl.formatMessage(uiAuditWhat)}</TableHead>
                  <TableHead className="pr-5">
                    <span className="sr-only">
                      {intl.formatMessage(uiAuditDetails)}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((event) => {
                  const expanded = open === event.id;
                  const resource = RESOURCES.find(
                    (r) => r.name === event.entity_type,
                  );
                  return (
                    <Fragment key={event.id}>
                      <TableRow
                        data-testid="audit-row"
                        className={expanded ? "bg-muted/50" : undefined}
                      >
                        <TableCell className="pl-5 text-muted-foreground">
                          {/* created_at is in Unix seconds. */}
                          {intl.formatDate(event.created_at * 1000, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </TableCell>
                        <TableCell>{event.actor}</TableCell>
                        <TableCell>
                          <Badge
                            className={`font-mono ${ACTION_TINT[event.action]}`}
                          >
                            {intl.formatMessage(ACTIONS[event.action])}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <What event={event} />
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={intl.formatMessage(uiAuditDetails)}
                            aria-expanded={expanded}
                            onClick={() =>
                              setOpen(expanded ? undefined : event.id)
                            }
                          >
                            <ChevronDown
                              aria-hidden
                              className={expanded ? "rotate-180" : undefined}
                            />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow data-testid="audit-details">
                          <TableCell colSpan={5} className="px-5">
                            <div className="flex flex-col gap-2">
                              <DiffLines diff={event.diff} />
                              <p className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                {event.request_id ? (
                                  <span>
                                    {intl.formatMessage(
                                      uiAuditRequestId as MessageDescriptor,
                                      {
                                        id: (
                                          <code className="font-mono">
                                            {event.request_id}
                                          </code>
                                        ),
                                      },
                                    )}
                                  </span>
                                ) : null}
                                {resource &&
                                !resource.nested &&
                                event.entity_id &&
                                event.action !== "delete" ? (
                                  <Link
                                    to={`/${event.entity_type}/${event.entity_id}/show`}
                                    className="text-primary underline"
                                  >
                                    {intl.formatMessage(
                                      uiAuditOpen as MessageDescriptor,
                                      { entity: entityName(event.entity_type) },
                                    )}
                                  </Link>
                                ) : null}
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {events.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={events.isFetchingNextPage}
          onClick={() => events.fetchNextPage()}
        >
          {intl.formatMessage(uiAuditMore)}
        </Button>
      ) : null}
    </div>
  );
}

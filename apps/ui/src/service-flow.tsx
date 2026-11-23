/**
 * The service page (the Service board): its URL under
 * the name, "How requests reach it" (its routes, the service, then the
 * upstream its host names, or the host it calls directly), and "Which
 * plugins run" for a route and a caller, as the gateway decides, with the
 * instances a more specific one replaces struck through.
 */
import { ADMIN_PAGE } from "@edgway/constants";
import {
  uiCredentialsAdd,
  uiEntityRoutes,
  uiEntityServices,
  uiPageEditEntity,
  uiServiceAlgorithm,
  uiServiceBox,
  uiServiceDirect,
  uiServiceFlow,
  uiServicePlugins,
  uiServiceRoutes,
  uiServiceSettings,
  uiServiceTargetWeight,
  uiServiceUpstream,
  uiWhichCaller,
  uiWhichConsumer,
  uiWhichEffect,
  uiWhichGroup,
  uiWhichIntro,
  uiWhichLevelConsumer,
  uiWhichLevelGlobal,
  uiWhichLevelGroup,
  uiWhichLevelRoute,
  uiWhichLevelService,
  uiWhichNobody,
  uiWhichNone,
  uiWhichNoRoutes,
  uiWhichNumber,
  uiWhichOrder,
  uiWhichPlugin,
  uiWhichReplaced,
  uiWhichRoute,
  uiWhichSetOn,
  uiWhichTest,
  uiWhichTitle,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { buttonVariants } from "@edgway/ui-kit/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@edgway/ui-kit/components/ui/card";
import { Label } from "@edgway/ui-kit/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@edgway/ui-kit/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
  useDataProvider,
  useGetManyReference,
  useRecordContext,
} from "ra-core";
import { type ReactNode, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { DESCRIPTIONS } from "./console/plugin-descriptions";
import { call, client } from "./data-provider";
import { ErrorState } from "./error-state";
import { useCan } from "./role";

type Which = sdk.WhichPluginsResponses[200]["data"][number];
type Level = Which["level"][number];
type Row = Record<string, unknown>;

const LEVELS: Record<Level, MessageDescriptor> = {
  route: uiWhichLevelRoute,
  service: uiWhichLevelService,
  consumer: uiWhichLevelConsumer,
  consumer_group: uiWhichLevelGroup,
};

/** A plugin scope's badge colors (ui-guidelines "Badges"). */
const LEVEL_TINT: Record<Level | "global", string> = {
  global: "bg-muted text-muted-foreground",
  service: "bg-primary/10 text-primary",
  route: "bg-warning text-warning-foreground",
  consumer: "bg-chart-5/15 text-chart-5",
  consumer_group: "bg-chart-5/15 text-chart-5",
};

const SELECT =
  "h-11 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs";

const MS_PER_S = 1000;

/**
 * A card on the entity pages: the kit's Card with a title, an optional
 * action, and a region named by its title (the boards' cards).
 */
export function PageCard({
  title,
  aside,
  children,
  testId,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card role="region" aria-label={title} data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside ? <CardAction>{aside}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A small uppercase heading inside a card's box. */
function BoxLabel({ children }: { children: ReactNode }) {
  return (
    <span className="flex flex-wrap gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

/** Rows of a resource, up to a page (pickers). */
function useRows(resource: string, filter?: { target: string; id: string }) {
  const dataProvider = useDataProvider();
  return useQuery({
    queryKey: ["service-flow-rows", resource, filter?.target, filter?.id],
    queryFn: async () => {
      const params = {
        pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
        sort: { field: "id", order: "ASC" as const },
        filter: {},
      };
      const result = filter
        ? await dataProvider.getManyReference(resource, {
            ...filter,
            ...params,
          })
        : await dataProvider.getList(resource, params);
      return result.data as Row[];
    },
  });
}

/** Which plugins run for a route and a caller, as the gateway decides. */
function WhichPlugins({ serviceId }: { serviceId: string }) {
  const intl = useIntl();
  const routes = useRows("routes", { target: "service_id", id: serviceId });
  const consumers = useRows("consumers");
  const groups = useRows("consumer_groups");
  const [route, setRoute] = useState("");
  // "", "consumer:<id>" or "group:<id>".
  const [caller, setCaller] = useState("");
  const routeId = route || String(routes.data?.[0]?.id ?? "");
  const [kind, id] = caller.split(":");
  const answer = useQuery({
    queryKey: ["which-plugins", routeId, caller],
    enabled: Boolean(routeId),
    queryFn: async () =>
      (
        (await call(
          sdk.whichPlugins({
            client,
            query: {
              route: routeId,
              ...(kind === "consumer" ? { consumer: id } : {}),
              ...(kind === "group" ? { consumer_group: id } : {}),
            },
          }),
        )) as sdk.WhichPluginsResponses[200]
      ).data,
  });
  const scope = (levels: Level[]) =>
    (levels.length === 0 ? (["global"] as const) : levels).map((level) => (
      <Badge key={level} className={LEVEL_TINT[level]}>
        {intl.formatMessage(
          level === "global"
            ? (uiWhichLevelGlobal as MessageDescriptor)
            : LEVELS[level],
        )}
      </Badge>
    ));
  return (
    <PageCard title={intl.formatMessage(uiWhichTitle)} testId="which-plugins">
      <p className="text-sm text-muted-foreground">
        {intl.formatMessage(uiWhichIntro)}
      </p>
      {routes.data && routes.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(uiWhichNoRoutes)}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="which-route">
                {intl.formatMessage(uiWhichRoute)}
              </Label>
              <select
                id="which-route"
                className={`${SELECT} font-mono`}
                value={routeId}
                onChange={(event) => setRoute(event.target.value)}
              >
                {(routes.data ?? []).map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {String(r.name ?? r.id)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="which-caller">
                {intl.formatMessage(uiWhichCaller)}
              </Label>
              <select
                id="which-caller"
                className={SELECT}
                value={caller}
                onChange={(event) => setCaller(event.target.value)}
              >
                <option value="">{intl.formatMessage(uiWhichNobody)}</option>
                {(consumers.data ?? []).map((c) => (
                  <option key={`c${c.id}`} value={`consumer:${c.id}`}>
                    {intl.formatMessage(uiWhichConsumer as MessageDescriptor, {
                      name: String(c.username ?? c.display_name ?? c.id),
                    })}
                  </option>
                ))}
                {(groups.data ?? []).map((g) => (
                  <option key={`g${g.id}`} value={`group:${g.id}`}>
                    {intl.formatMessage(uiWhichGroup as MessageDescriptor, {
                      name: String(g.name ?? g.id),
                    })}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {answer.data && answer.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(uiWhichNone)}
            </p>
          ) : (
            <Table data-testid="which-list">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    {intl.formatMessage(uiWhichNumber)}
                  </TableHead>
                  <TableHead>{intl.formatMessage(uiWhichPlugin)}</TableHead>
                  <TableHead>{intl.formatMessage(uiWhichSetOn)}</TableHead>
                  <TableHead>{intl.formatMessage(uiWhichEffect)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(answer.data ?? []).map((p, i) => {
                  const description = DESCRIPTIONS[p.name];
                  return (
                    <TableRow
                      key={p.id}
                      data-runs={p.runs}
                      className={
                        p.runs
                          ? undefined
                          : "text-muted-foreground line-through"
                      }
                    >
                      <TableCell className="font-mono">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">
                        {p.name}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {scope(p.level)}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {p.runs
                          ? description
                            ? intl.formatMessage(description)
                            : null
                          : intl.formatMessage(uiWhichReplaced)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            {intl.formatMessage(uiWhichOrder)}
            <Link to="/tester" className="text-primary underline">
              {intl.formatMessage(uiWhichTest)}
            </Link>
          </p>
        </>
      )}
    </PageCard>
  );
}

/** The routes box: each route's name and first path. */
function RoutesBox({ serviceId }: { serviceId: string }) {
  const intl = useIntl();
  const routes = useRows("routes", { target: "service_id", id: serviceId });
  const rows = routes.data ?? [];
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <BoxLabel>
        {intl.formatMessage(uiServiceRoutes as MessageDescriptor, {
          count: rows.length,
        })}
      </BoxLabel>
      {rows.map((r) => (
        <Link
          key={String(r.id)}
          to={`/routes/${r.id}/show`}
          className="flex gap-2 font-mono text-sm text-primary underline"
        >
          <span>{String(r.name ?? r.id)}</span>
          <span>{Array.isArray(r.paths) ? String(r.paths[0] ?? "") : ""}</span>
        </Link>
      ))}
    </div>
  );
}

/** The service box: its settings in brief, and its own plugins. */
function ServiceBox({ service }: { service: Row }) {
  const intl = useIntl();
  const plugins = useRows("plugins", {
    target: "service_id",
    id: String(service.id),
  });
  const timeouts = ["connect_timeout", "read_timeout", "write_timeout"]
    .map((field) => Number(service[field] ?? 0))
    .filter((ms) => ms > 0);
  return (
    <div className="flex flex-col gap-1 rounded-lg border-2 border-primary bg-primary/5 p-4">
      <BoxLabel>{intl.formatMessage(uiServiceBox)}</BoxLabel>
      <span className="font-mono">{String(service.name ?? service.id)}</span>
      <span className="text-sm text-muted-foreground">
        {intl.formatMessage(uiServiceSettings as MessageDescriptor, {
          seconds: Math.max(0, ...timeouts) / MS_PER_S,
          retries: Number(service.retries ?? 0),
        })}
      </span>
      <span className="text-sm text-muted-foreground">
        {intl.formatMessage(uiServicePlugins as MessageDescriptor, {
          count: plugins.data?.length ?? 0,
        })}
      </span>
    </div>
  );
}

/** The upstream box: the upstream the host names, or the host itself. */
function UpstreamBox({ host }: { host: string }) {
  const intl = useIntl();
  const dataProvider = useDataProvider();
  // A Kong upstream is named by the service's host (Kong's own lookup).
  const upstream = useQuery({
    queryKey: ["service-upstream", host],
    enabled: Boolean(host),
    retry: false,
    queryFn: async () => {
      try {
        return (await dataProvider.getOne("upstreams", { id: host })).data;
      } catch (error) {
        // Only a 404 means the host is called directly.
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      }
    },
  });
  const targets = useGetManyReference(
    "targets",
    {
      target: "upstream_id",
      id: upstream.data?.id,
      pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: Boolean(upstream.data) },
  );
  if (upstream.isPending) return <div className="rounded-lg border p-4" />;
  if (upstream.isError) {
    return (
      <ErrorState error={upstream.error} onRetry={() => upstream.refetch()} />
    );
  }
  if (!upstream.data) {
    return (
      <div
        className="rounded-lg border p-4 text-sm text-muted-foreground"
        data-testid="service-direct"
      >
        {intl.formatMessage(uiServiceDirect as MessageDescriptor, {
          host: <code className="font-mono">{host}</code>,
        })}
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border p-4"
      data-testid="service-upstream"
    >
      <BoxLabel>
        <Link
          to={`/upstreams/${upstream.data.id}/show`}
          className="font-mono normal-case text-primary underline"
        >
          {intl.formatMessage(uiServiceUpstream as MessageDescriptor, {
            name: host,
          })}
        </Link>
        <span className="font-mono normal-case">
          {intl.formatMessage(uiServiceAlgorithm as MessageDescriptor, {
            algorithm: String(upstream.data.algorithm ?? ""),
          })}
        </span>
      </BoxLabel>
      {(targets.data ?? []).map((t) => (
        <span
          key={String(t.id)}
          className="flex justify-between gap-4 font-mono text-sm"
        >
          <span>{String(t.target)}</span>
          <span className="text-muted-foreground">
            {intl.formatMessage(uiServiceTargetWeight as MessageDescriptor, {
              weight: Number(t.weight ?? 0),
            })}
          </span>
        </span>
      ))}
    </div>
  );
}

const Arrow = () => (
  <ArrowRight
    className="hidden size-5 self-center text-muted-foreground md:block"
    aria-hidden
  />
);

/** "Add route" and "Edit service", for editors. */
export function ServiceActions() {
  const intl = useIntl();
  const service = useRecordContext();
  const canEdit = useCan("editor");
  if (!service || !canEdit) return null;
  return (
    <div className="flex items-center gap-2">
      <Link
        to="/routes/create"
        state={{ record: { service_id: service.id } }}
        className={buttonVariants({ variant: "outline" })}
      >
        {intl.formatMessage(uiCredentialsAdd as MessageDescriptor, {
          resource: intl.formatMessage(uiEntityRoutes),
        })}
      </Link>
      <Link
        to={`/services/${service.id}`}
        className={buttonVariants({ variant: "default" })}
      >
        {intl.formatMessage(uiPageEditEntity as MessageDescriptor, {
          entity: intl.formatMessage(uiEntityServices),
        })}
      </Link>
    </div>
  );
}

/** The service page's body. */
export function ServicePage() {
  const intl = useIntl();
  const service = useRecordContext();
  if (!service) return null;
  const host = String(service.host ?? "");
  const port = service.port ? `:${String(service.port)}` : "";
  const url = `${String(service.protocol ?? "http")}://${host}${port}${String(service.path ?? "/")}`;
  return (
    <div className="flex w-full flex-col gap-6">
      <p className="-mt-2 font-mono text-sm text-muted-foreground">{url}</p>
      <PageCard title={intl.formatMessage(uiServiceFlow)} testId="service-flow">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <RoutesBox serviceId={String(service.id)} />
          <Arrow />
          <ServiceBox service={service} />
          <Arrow />
          <UpstreamBox host={host} />
        </div>
      </PageCard>
      <WhichPlugins serviceId={String(service.id)} />
    </div>
  );
}

/**
 * The upstream page (the Upstream board): the services that
 * use it, the note when its algorithm runs as another on Workers
 * (`UPSTREAM`), its settings in brief, its targets with each one's share of
 * the traffic and an inline row to stage one, and its health-check settings
 * in words (never a live state: each gateway checks on its own,
 * ui-guidelines "Health").
 */
import { ADMIN_PAGE, UPSTREAM } from "@edgway/constants";
import {
  uiConfigActions,
  uiEntityUpstreams,
  uiFieldAlgorithm,
  uiFieldClientCertificateId,
  uiFieldHostHeader,
  uiFieldSlots,
  uiPageEditEntity,
  uiServiceShare,
  uiServiceTarget,
  uiServiceWeight,
  uiUpstreamActive,
  uiUpstreamActiveOff,
  uiUpstreamActiveOn,
  uiUpstreamFallback,
  uiUpstreamFromTarget,
  uiUpstreamHealth,
  uiUpstreamHealthNote,
  uiUpstreamNewTarget,
  uiUpstreamNone,
  uiUpstreamOff,
  uiUpstreamOn,
  uiUpstreamOut,
  uiUpstreamPassive,
  uiUpstreamPassiveOff,
  uiUpstreamPassiveOn,
  uiUpstreamRunsAs,
  uiUpstreamStageTarget,
  uiUpstreamTargetHint,
  uiUpstreamTargets,
  uiUpstreamTargetsNote,
  uiUpstreamUnused,
  uiUpstreamUsedBy,
} from "@edgway/i18n/messages";
import { DeleteButton } from "@edgway/ui-kit/components/admin";
import { Alert, AlertDescription } from "@edgway/ui-kit/components/ui/alert";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { Button, buttonVariants } from "@edgway/ui-kit/components/ui/button";
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
import { TriangleAlert } from "lucide-react";
import {
  RecordContextProvider,
  useCreate,
  useGetList,
  useGetManyReference,
  useNotify,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { type ReactNode, useId, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { useCan } from "./role";
import { PageCard } from "./service-flow";

interface Target {
  id: string;
  target: string;
  weight: number;
}

const PERCENT = 100;

/** Stage a target on this upstream: host:port and weight, inline. */
function NewTarget({ upstreamId }: { upstreamId: string }) {
  const intl = useIntl();
  const notify = useNotify();
  const id = useId();
  const [target, setTarget] = useState("");
  // Empty: the admin's own default weight (Kong's).
  const [weight, setWeight] = useState("");
  const [create, { isPending }] = useCreate();
  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t bg-muted/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create(
          "targets",
          {
            data: {
              upstream_id: upstreamId,
              target: target.trim(),
              ...(weight === "" ? {} : { weight: Number(weight) }),
            },
          },
          {
            onSuccess: () => setTarget(""),
            onError: (error) =>
              notify((error as Error).message, { type: "error" }),
          },
        );
      }}
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label htmlFor={`${id}-target`}>
          {intl.formatMessage(uiUpstreamNewTarget)}
        </Label>
        <Input
          id={`${id}-target`}
          required
          className="h-11 font-mono"
          placeholder={intl.formatMessage(uiUpstreamTargetHint)}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </div>
      <div className="flex w-28 flex-col gap-1.5">
        <Label htmlFor={`${id}-weight`}>
          {intl.formatMessage(uiServiceWeight)}
        </Label>
        <Input
          id={`${id}-weight`}
          type="number"
          min={0}
          className="h-11 font-mono"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
        />
      </div>
      <Button type="submit" className="h-11" disabled={isPending}>
        {intl.formatMessage(uiUpstreamStageTarget)}
      </Button>
    </form>
  );
}

/**
 * The upstream's targets, each with its weight's share of the total as a
 * bar; weight 0 is out of rotation. A target opens its own page; editors
 * edit, delete or stage one here.
 */
function UpstreamTargets({ upstreamId }: { upstreamId: string }) {
  const intl = useIntl();
  const translate = useTranslate();
  const canEdit = useCan("editor");
  // ra-core's own query, so a delete's optimistic update (with undo) shows
  // here at once.
  const targets = useGetManyReference<Target & { id: string }>("targets", {
    target: "upstream_id",
    id: upstreamId,
    pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
    sort: { field: "id", order: "ASC" },
  });
  const rows = targets.data ?? [];
  const total = rows.reduce((sum, t) => sum + (t.weight ?? 0), 0);
  return (
    <div className="-mx-5 -mb-5 flex flex-col">
      <Table data-testid="upstream-targets">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">
              {intl.formatMessage(uiServiceTarget)}
            </TableHead>
            <TableHead className="text-right">
              {intl.formatMessage(uiServiceWeight)}
            </TableHead>
            <TableHead>{intl.formatMessage(uiServiceShare)}</TableHead>
            {canEdit ? (
              <TableHead className="pr-5 text-right">
                {intl.formatMessage(uiConfigActions)}
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => {
            const share = total ? (t.weight ?? 0) / total : 0;
            return (
              <TableRow key={t.id}>
                <TableCell className="pl-5 font-mono">
                  <Link to={`/targets/${t.id}/show`} className="underline">
                    {t.target}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {t.weight}
                </TableCell>
                <TableCell>
                  {t.weight ? (
                    <span className="flex items-center gap-3">
                      <span className="h-2 w-40 rounded-full bg-muted">
                        <span
                          className="block h-2 rounded-full bg-primary"
                          style={{ width: `${share * PERCENT}%` }}
                        />
                      </span>
                      <span className="font-mono text-xs">
                        {intl.formatNumber(share, {
                          style: "percent",
                          maximumFractionDigits: 1,
                        })}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {intl.formatMessage(uiUpstreamOut)}
                    </span>
                  )}
                </TableCell>
                {canEdit ? (
                  <TableCell className="pr-5">
                    <span className="flex justify-end gap-2">
                      <Link
                        to={`/targets/${t.id}`}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        {translate("ra.action.edit")}
                      </Link>
                      <RecordContextProvider value={t}>
                        <DeleteButton
                          resource="targets"
                          size="sm"
                          variant="outline"
                          redirect={false}
                        />
                      </RecordContextProvider>
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {canEdit ? <NewTarget upstreamId={upstreamId} /> : null}
    </div>
  );
}

/** One setting in the summary: an uppercase label over its value. */
function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

interface Health {
  active?: {
    http_path?: string;
    healthy?: { interval?: number };
    unhealthy?: { interval?: number };
  };
  passive?: {
    unhealthy?: {
      http_failures?: number;
      tcp_failures?: number;
      timeouts?: number;
    };
  };
}

/** A health check's box: its name, on or off, and what it does, in words. */
function Check({
  title,
  on,
  children,
}: {
  title: MessageDescriptor;
  on: boolean;
  children: ReactNode;
}) {
  const intl = useIntl();
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <span className="flex items-center justify-between">
        <h3 className="font-medium">{intl.formatMessage(title)}</h3>
        <Badge
          className={
            on
              ? "bg-success text-success-foreground"
              : "bg-muted text-muted-foreground"
          }
        >
          {intl.formatMessage(on ? uiUpstreamOn : uiUpstreamOff)}
        </Badge>
      </span>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** "Edit upstream", for editors. */
export function UpstreamActions() {
  const intl = useIntl();
  const upstream = useRecordContext();
  const canEdit = useCan("editor");
  if (!upstream || !canEdit) return null;
  return (
    <Link
      to={`/upstreams/${upstream.id}`}
      className={buttonVariants({ variant: "default" })}
    >
      {intl.formatMessage(uiPageEditEntity as MessageDescriptor, {
        entity: intl.formatMessage(uiEntityUpstreams),
      })}
    </Link>
  );
}

/** The upstream page's body. */
export function UpstreamPage() {
  const intl = useIntl();
  const upstream = useRecordContext();
  // A service uses an upstream by naming it as its host (Kong's lookup).
  const { data: services = [] } = useGetList(
    "services",
    {
      pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
      filter: {},
    },
    { enabled: Boolean(upstream) },
  );
  if (!upstream) return null;
  const algorithm = String(upstream.algorithm ?? "");
  const fallback = algorithm && !UPSTREAM.algorithms.includes(algorithm);
  const health = (upstream.healthchecks ?? {}) as Health;
  const failures =
    health.passive?.unhealthy?.http_failures ||
    health.passive?.unhealthy?.tcp_failures ||
    health.passive?.unhealthy?.timeouts ||
    0;
  const interval =
    health.active?.healthy?.interval || health.active?.unhealthy?.interval || 0;
  const users = services.filter((s) => s.host === upstream.name);
  return (
    <div className="flex w-full flex-col gap-6">
      <p className="-mt-2 text-sm text-muted-foreground">
        {users.length > 0
          ? intl.formatMessage(uiUpstreamUsedBy as MessageDescriptor, {
              services: intl.formatList(
                users.map((s) => (
                  <Link
                    key={String(s.id)}
                    to={`/services/${s.id}/show`}
                    className="font-mono text-primary underline"
                  >
                    {String(s.name ?? s.id)}
                  </Link>
                )),
                { type: "conjunction" },
              ),
            })
          : intl.formatMessage(uiUpstreamUnused)}
      </p>
      {fallback ? (
        <Alert
          data-testid="upstream-fallback"
          className="border-warning-foreground/30 bg-warning text-warning-foreground"
        >
          <TriangleAlert aria-hidden />
          <AlertDescription className="text-warning-foreground">
            {intl.formatMessage(uiUpstreamFallback as MessageDescriptor, {
              algorithm,
              fallback: UPSTREAM.fallbackAlgorithm,
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      <section
        className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="upstream-settings"
      >
        <Setting label={intl.formatMessage(uiFieldAlgorithm)}>
          <span className="font-mono">{algorithm}</span>
          {fallback ? (
            <span className="ml-2 text-xs text-warning-foreground">
              {intl.formatMessage(uiUpstreamRunsAs as MessageDescriptor, {
                fallback: UPSTREAM.fallbackAlgorithm,
              })}
            </span>
          ) : null}
        </Setting>
        <Setting label={intl.formatMessage(uiFieldSlots)}>
          <span className="font-mono">{String(upstream.slots ?? "")}</span>
        </Setting>
        <Setting label={intl.formatMessage(uiFieldHostHeader)}>
          {upstream.host_header ? (
            <span className="font-mono">{String(upstream.host_header)}</span>
          ) : (
            intl.formatMessage(uiUpstreamFromTarget)
          )}
        </Setting>
        <Setting label={intl.formatMessage(uiFieldClientCertificateId)}>
          {upstream.client_certificate_id ? (
            <Link
              to={`/certificates/${upstream.client_certificate_id}/show`}
              className="font-mono text-primary underline"
            >
              {String(upstream.client_certificate_id)}
            </Link>
          ) : (
            intl.formatMessage(uiUpstreamNone)
          )}
        </Setting>
      </section>
      <PageCard
        title={intl.formatMessage(uiUpstreamTargets)}
        aside={
          <span className="text-sm text-muted-foreground">
            {intl.formatMessage(uiUpstreamTargetsNote)}
          </span>
        }
      >
        <UpstreamTargets upstreamId={String(upstream.id)} />
      </PageCard>
      <PageCard
        title={intl.formatMessage(uiUpstreamHealth)}
        testId="upstream-health"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Check title={uiUpstreamPassive} on={failures > 0}>
            {failures > 0
              ? intl.formatMessage(uiUpstreamPassiveOn as MessageDescriptor, {
                  failures,
                })
              : intl.formatMessage(uiUpstreamPassiveOff)}
          </Check>
          <Check title={uiUpstreamActive} on={interval > 0}>
            {interval > 0
              ? intl.formatMessage(uiUpstreamActiveOn as MessageDescriptor, {
                  path: (
                    <code className="font-mono">
                      {health.active?.http_path}
                    </code>
                  ),
                  interval,
                })
              : intl.formatMessage(uiUpstreamActiveOff)}
          </Check>
        </div>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(uiUpstreamHealthNote)}
        </p>
      </PageCard>
    </div>
  );
}

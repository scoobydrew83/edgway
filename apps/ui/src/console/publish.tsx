/**
 * Staged changes → publish → history → rollback (the Publish board):
 * the staged changes first, grouped by entity in a card; beside them a card
 * with the note, the warnings publishing would give, and "Publish version
 * N"; the side-by-side diff (Monaco, JSON or decK YAML) folded and limited to
 * the changed entities; then the published versions in a card.
 */

import { PUBLISH_WARNING } from "@edgway/constants";
import {
  uiConfigActions,
  uiConfigByAuthor,
  uiConfigChangeAdded,
  uiConfigChangeChanged,
  uiConfigChangeRemoved,
  uiConfigCurrent,
  uiConfigGroupCounts,
  uiConfigHistory,
  uiConfigNoChanges,
  uiConfigNoMatch,
  uiConfigNote,
  uiConfigNothingPublished,
  uiConfigPublish,
  uiConfigPublishConfirm,
  uiConfigPublishConfirmBody,
  uiConfigPublishCount,
  uiConfigPublishDone,
  uiConfigPublished,
  uiConfigPublishedAt,
  uiConfigPublishedBy,
  uiConfigPublishVersion,
  uiConfigRollback,
  uiConfigRollbackConfirm,
  uiConfigRollbackConfirmBody,
  uiConfigRollbackPreviewFailed,
  uiConfigRollbackRevived,
  uiConfigRollbackRevivedDone,
  uiConfigRollbackRevivedItem,
  uiConfigRolledBack,
  uiConfigSearch,
  uiConfigShowDiff,
  uiConfigStaged,
  uiConfigStagedAgainst,
  uiConfigStagedFirst,
  uiConfigTakesAll,
  uiConfigTitle,
  uiConfigUnknownAuthor,
  uiConfigVersion,
  uiConfigViewDeck,
  uiConfigViewJson,
  uiConfigWarningsAhead,
  uiPublishWarningAlgorithm,
  uiPublishWarningRawSecret,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Confirm } from "@edgway/ui-kit/components/admin/confirm";
import { Loading } from "@edgway/ui-kit/components/admin/loading";
import { useTheme } from "@edgway/ui-kit/components/admin/use-theme";
import { Alert, AlertDescription } from "@edgway/ui-kit/components/ui/alert";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { Button } from "@edgway/ui-kit/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@edgway/ui-kit/components/ui/card";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useNotify } from "ra-core";
import { lazy, Suspense, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { call, client } from "../data-provider";
import { ErrorState } from "../error-state";
import { RESOURCES } from "../resources";
import { PublisherReason, useCan } from "../role";
import { toDeck } from "./deck";
import { type Change, PENDING_KEY, usePendingChanges } from "./pending";

const SnapshotDiff = lazy(() => import("./editor"));

type Snapshots = sdk.ConfigSnapshotsResponses[200];
type Warning = NonNullable<sdk.PublishResponses[201]["warnings"]>[number];
interface Version {
  version: number;
  note?: string | null;
  created_by: string;
  /** Unix seconds. */
  created_at: number;
}

export function PublishPage() {
  const intl = useIntl();
  const notify = useNotify();
  const queries = useQueryClient();
  const { theme } = useTheme();
  const [view, setView] = useState<"json" | "yaml">("json");
  const [note, setNote] = useState("");
  // Monaco loads only once the diff is opened.
  const [diffOpen, setDiffOpen] = useState(false);
  const snapshots = useQuery({
    queryKey: ["config-snapshots"],
    retry: 1,
    queryFn: async () =>
      (await call(sdk.configSnapshots({ client }))) as Snapshots,
  });
  const pending = usePendingChanges();
  // Below publisher, Publish and Roll back are disabled with the reason.
  const canPublish = useCan("publisher");
  const changes = pending.data?.changes ?? [];
  const versions = useQuery({
    queryKey: ["config-versions"],
    retry: 1,
    queryFn: async () =>
      (await call(sdk.listVersions({ client }))) as {
        current?: number;
        data: Version[];
      },
  });
  const refresh = () =>
    Promise.all([
      queries.invalidateQueries({ queryKey: ["config-snapshots"] }),
      queries.invalidateQueries({ queryKey: ["config-versions"] }),
      queries.invalidateQueries({ queryKey: PENDING_KEY }),
    ]);
  // One action at a time, after confirmation: a double click can't
  // publish twice.
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<
    { kind: "publish" } | { kind: "rollback"; version: number } | undefined
  >();
  const act = async (
    run: () => Promise<{ version: number }>,
    done: MessageDescriptor,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      const { version } = await run();
      notify(intl.formatMessage(done as MessageDescriptor, { version }), {
        type: "success",
      });
    } catch (error) {
      notify((error as Error).message, { type: "error" });
    } finally {
      setBusy(false);
      setConfirming(undefined);
    }
    await refresh();
  };
  /** A publish warning in words. */
  const warningText = (warning: Warning) =>
    warning.code === PUBLISH_WARNING.upstreamAlgorithm
      ? intl.formatMessage(uiPublishWarningAlgorithm as MessageDescriptor, {
          name: warning.name ?? warning.upstream,
          algorithm: warning.algorithm,
          runsAs: warning.runs_as,
        })
      : intl.formatMessage(uiPublishWarningRawSecret as MessageDescriptor, {
          name: warning.name,
          fields: warning.fields.join(", "),
        });
  // What publishing now would warn about, shown before it's done.
  const warnings = useQuery({
    queryKey: [...PENDING_KEY, "warnings"],
    queryFn: async () =>
      (await call(
        sdk.pendingChanges({ client, query: { warnings: "true" } }),
      )) as sdk.PendingChangesResponses[200],
  });
  const publishNow = () =>
    act(async () => {
      const result = (await call(
        sdk.publish({ client, body: note ? { note } : {} }),
      )) as sdk.PublishResponses[201];
      setNote("");
      // What the publish went ahead with but says: kept on screen.
      for (const warning of result.warnings ?? []) {
        notify(warningText(warning), {
          type: "warning",
          autoHideDuration: null,
        });
      }
      return result;
    }, uiConfigPublishDone);
  const rollbackTo = (target: number, previewed: boolean) =>
    act(async () => {
      const result = (await call(
        sdk.rollback({ client, body: { version: target } }),
      )) as { version: number; revived?: Revived[] };
      // The preview failed, so the warning comes now.
      const count = result.revived?.length ?? 0;
      if (!previewed && count > 0) {
        notify(
          intl.formatMessage(uiConfigRollbackRevivedDone as MessageDescriptor, {
            count,
            version: target,
          }),
          { type: "warning", autoHideDuration: null },
        );
      }
      return result;
    }, uiConfigRolledBack);
  // What a rollback would revive, asked before it's confirmed.
  const rollbackTarget =
    confirming?.kind === "rollback" ? confirming.version : undefined;
  const preview = useQuery({
    queryKey: ["rollback-preview", rollbackTarget],
    enabled: rollbackTarget !== undefined,
    retry: 1,
    queryFn: async () =>
      (await call(
        sdk.rollback({
          client,
          body: { version: rollbackTarget as number, dry_run: true },
        }),
      )) as { revived: Revived[] },
  });
  const revived =
    rollbackTarget === undefined ? [] : (preview.data?.revived ?? []);

  const failed = snapshots.error ?? versions.error ?? pending.error;
  if (failed) return <ErrorState error={failed} onRetry={() => refresh()} />;
  if (!snapshots.data) return <Loading />;
  const { version, published, staged } = snapshots.data;
  const render = (s: Record<string, unknown[]>) =>
    view === "json" ? JSON.stringify(s, null, 2) : toDeck(s);
  // The kit's theme provider marks the resolved theme on <html>.
  const dark =
    theme === "dark" || document.documentElement.classList.contains("dark");

  const entities = entitiesOf(changes);
  const next =
    Math.max(0, ...(versions.data?.data ?? []).map((v) => v.version)) + 1;

  return (
    <div className="flex flex-col gap-6 py-4">
      <h1 className="text-3xl font-semibold">
        {intl.formatMessage(uiConfigTitle)}
      </h1>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card
          role="region"
          aria-label={intl.formatMessage(uiConfigStaged)}
          className="min-w-0"
        >
          <CardHeader>
            <CardTitle>
              {version === null
                ? intl.formatMessage(uiConfigStagedFirst)
                : intl.formatMessage(
                    uiConfigStagedAgainst as MessageDescriptor,
                    {
                      version,
                    },
                  )}
            </CardTitle>
            <CardAction className="flex gap-1">
              <Button
                variant={view === "json" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("json")}
              >
                {intl.formatMessage(uiConfigViewJson)}
              </Button>
              <Button
                variant={view === "yaml" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("yaml")}
              >
                {intl.formatMessage(uiConfigViewDeck)}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="gap-4">
            <ChangeList changes={changes} />
            {changes.length > 0 ? (
              <details
                className="rounded-lg border"
                data-testid="publish-diff"
                onToggle={(event) =>
                  setDiffOpen((event.target as HTMLDetailsElement).open)
                }
              >
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  {intl.formatMessage(uiConfigShowDiff)}
                </summary>
                {diffOpen ? (
                  <div className="flex flex-col gap-1 border-t pt-2">
                    <div className="grid grid-cols-2 px-4 text-xs font-medium text-muted-foreground">
                      <span>
                        {version === null
                          ? intl.formatMessage(uiConfigNothingPublished)
                          : intl.formatMessage(
                              uiConfigPublished as MessageDescriptor,
                              { version },
                            )}
                      </span>
                      <span>{intl.formatMessage(uiConfigStaged)}</span>
                    </div>
                    <Suspense fallback={<Loading />}>
                      <SnapshotDiff
                        original={render(onlyChanged(published, entities))}
                        modified={render(onlyChanged(staged, entities))}
                        language={view}
                        dark={dark}
                      />
                    </Suspense>
                  </div>
                ) : null}
              </details>
            ) : null}
          </CardContent>
        </Card>
        <Card
          role="region"
          aria-label={intl.formatMessage(uiConfigPublish)}
          className="self-start"
        >
          <CardHeader>
            <CardTitle>
              {intl.formatMessage(uiConfigPublishCount as MessageDescriptor, {
                count: entities.length,
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="gap-4">
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(uiConfigPublishConfirmBody)}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="publish-note">
                {intl.formatMessage(uiConfigNote)}
              </Label>
              <Input
                id="publish-note"
                className="h-11"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <PublishWarnings
              warnings={warnings.data?.warnings ?? []}
              render={warningText}
            />
            <Button
              data-testid="publish-button"
              size="lg"
              className="w-full"
              disabled={!canPublish || busy || changes.length === 0}
              onClick={() => setConfirming({ kind: "publish" })}
            >
              {intl.formatMessage(uiConfigPublishVersion as MessageDescriptor, {
                version: next,
              })}
            </Button>
            <PublisherReason />
          </CardContent>
        </Card>
      </div>
      <Card role="region" aria-label={intl.formatMessage(uiConfigHistory)}>
        <CardHeader>
          <CardTitle>{intl.formatMessage(uiConfigHistory)}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{intl.formatMessage(uiConfigVersion)}</TableHead>
                <TableHead>{intl.formatMessage(uiConfigNote)}</TableHead>
                <TableHead>{intl.formatMessage(uiConfigPublishedBy)}</TableHead>
                <TableHead>{intl.formatMessage(uiConfigPublishedAt)}</TableHead>
                <TableHead className="text-right">
                  {intl.formatMessage(uiConfigActions)}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(versions.data?.data ?? []).map((row) => (
                <TableRow key={row.version}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-mono">
                      {row.version}
                      {row.version === versions.data?.current ? (
                        <Badge className="bg-success text-success-foreground">
                          {intl.formatMessage(uiConfigCurrent)}
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{row.note}</TableCell>
                  <TableCell>{row.created_by}</TableCell>
                  <TableCell>
                    {/* created_at is in Unix seconds. */}
                    {intl.formatDate(row.created_at * 1000, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.version === versions.data?.current ? null : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canPublish || busy}
                        onClick={() =>
                          setConfirming({
                            kind: "rollback",
                            version: row.version,
                          })
                        }
                      >
                        {intl.formatMessage(uiConfigRollback)}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Confirm
        isOpen={confirming !== undefined}
        // A rollback waits for its preview, so its warning is seen,
        // and for a refetch: a cached preview may be stale.
        loading={
          busy ||
          (rollbackTarget !== undefined &&
            (preview.isPending || preview.isFetching))
        }
        title={intl.formatMessage(
          confirming?.kind === "rollback"
            ? (uiConfigRollbackConfirm as MessageDescriptor)
            : (uiConfigPublishConfirm as MessageDescriptor),
          {
            count: entitiesOf(changes).length,
            version: confirming?.kind === "rollback" ? confirming.version : 0,
          },
        )}
        content={
          confirming?.kind === "rollback" ? (
            <RollbackWarning
              version={confirming.version}
              revived={revived}
              failed={preview.isError}
            />
          ) : (
            intl.formatMessage(uiConfigPublishConfirmBody)
          )
        }
        confirm={intl.formatMessage(
          confirming?.kind === "rollback" ? uiConfigRollback : uiConfigPublish,
        )}
        onClose={() => setConfirming(undefined)}
        onConfirm={() =>
          confirming?.kind === "rollback"
            ? rollbackTo(confirming.version, preview.isSuccess)
            : publishNow()
        }
      />
    </div>
  );
}

/** A credential a rollback would make live again. */
interface Revived {
  entity: string;
  id: string;
  consumer_id: string;
}

/** The rollback confirmation: what it does, and what it revives. */
function RollbackWarning({
  version,
  revived,
  failed,
}: {
  version: number;
  revived: Revived[];
  /** The preview couldn't be had: say so. */
  failed: boolean;
}) {
  const intl = useIntl();
  return (
    <div className="flex flex-col gap-2">
      <p>{intl.formatMessage(uiConfigRollbackConfirmBody)}</p>
      {failed ? (
        <p role="alert" data-testid="rollback-preview-failed">
          {intl.formatMessage(uiConfigRollbackPreviewFailed)}
        </p>
      ) : null}
      {revived.length > 0 ? (
        <div role="alert" data-testid="rollback-revived">
          <p className="font-medium">
            {intl.formatMessage(uiConfigRollbackRevived as MessageDescriptor, {
              count: revived.length,
              version,
            })}
          </p>
          <ul className="list-disc pl-5">
            {revived.map((r) => (
              <li key={`${r.entity}:${r.id}`}>
                {intl.formatMessage(
                  uiConfigRollbackRevivedItem as MessageDescriptor,
                  {
                    entity: r.entity,
                    id: r.id,
                    consumer: r.consumer_id,
                  },
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type Kind = "added" | "changed" | "removed";

interface Entity {
  type: string;
  id: string;
  kind: Kind;
  name?: string;
  paths?: string[];
  actor?: string;
}

/** One entry per staged entity: added, removed, or changed (field edits). */
function entitiesOf(changes: Change[]): Entity[] {
  const byKey = new Map<string, Entity>();
  for (const change of changes) {
    const type = String(change.path[0]);
    const id = String(change.path[1]);
    const key = `${type}:${id}`;
    const whole = change.path.length === 2;
    const kind: Kind =
      whole && change.type === "CREATE"
        ? "added"
        : whole && change.type === "REMOVE"
          ? "removed"
          : "changed";
    const known = byKey.get(key);
    byKey.set(key, {
      type,
      id,
      kind: known && known.kind !== "changed" ? known.kind : kind,
      name: change.entity?.name ?? known?.name,
      paths: change.entity?.paths ?? known?.paths,
      actor: change.actor ?? known?.actor,
    });
  }
  return [...byKey.values()];
}

// Removals first: they're the changes that take something away.
const ORDER: Record<Kind, number> = { removed: 0, added: 1, changed: 2 };

/**
 * What a publish would change: grouped by entity with added,
 * changed and removed counts, removals first, searchable by name, route
 * path or id, and saying that publishing takes every staged change, whose.
 */
function ChangeList({ changes }: { changes: Change[] }) {
  const intl = useIntl();
  const [search, setSearch] = useState("");
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="no-changes">
        {intl.formatMessage(uiConfigNoChanges)}
      </p>
    );
  }
  const KIND = {
    added: uiConfigChangeAdded,
    removed: uiConfigChangeRemoved,
    changed: uiConfigChangeChanged,
  } as const;
  const entities = entitiesOf(changes);
  const authors = new Map<string, number>();
  for (const e of entities) {
    const who = e.actor ?? intl.formatMessage(uiConfigUnknownAuthor);
    authors.set(who, (authors.get(who) ?? 0) + 1);
  }
  const q = search.trim().toLowerCase();
  const shown = entities.filter(
    (e) =>
      !q ||
      [e.name, e.id, e.type, ...(e.paths ?? [])].some((v) =>
        v?.toLowerCase().includes(q),
      ),
  );
  const groups = [...new Set(shown.map((e) => e.type))]
    .map((type) => {
      const rows = shown
        .filter((e) => e.type === type)
        .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
      const count = (kind: Kind) => rows.filter((e) => e.kind === kind).length;
      return { type, rows, count };
    })
    .sort((a, b) => b.count("removed") - a.count("removed"));
  const label = (type: string) => {
    const resource = RESOURCES.find((r) => r.name === type);
    return resource ? intl.formatMessage(resource.label) : type;
  };
  return (
    <section className="flex flex-col gap-3" data-testid="change-list">
      <p className="text-sm" data-testid="change-authors">
        {intl.formatMessage(uiConfigTakesAll as MessageDescriptor, {
          authors: intl.formatList(
            [...authors].map(([actor, count]) =>
              intl.formatMessage(uiConfigByAuthor as MessageDescriptor, {
                count,
                actor,
              }),
            ),
          ),
        })}
      </p>
      <Input
        aria-label={intl.formatMessage(uiConfigSearch)}
        placeholder={intl.formatMessage(uiConfigSearch)}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(uiConfigNoMatch)}
        </p>
      ) : (
        groups.map(({ type, rows, count }) => (
          <div key={type} data-testid={`change-group-${type}`}>
            <h3 className="flex flex-wrap items-baseline gap-2 font-medium">
              {label(type)}
              <span
                className="text-sm font-normal text-muted-foreground"
                data-testid="change-counts"
              >
                {intl.formatMessage(uiConfigGroupCounts as MessageDescriptor, {
                  added: count("added"),
                  changed: count("changed"),
                  removed: count("removed"),
                })}
              </span>
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {rows.map((e) => (
                <li
                  key={e.id}
                  data-kind={e.kind}
                  className="flex flex-wrap items-center gap-2"
                >
                  <Badge
                    variant={e.kind === "removed" ? "destructive" : "secondary"}
                    className={
                      e.kind === "added"
                        ? "bg-success text-success-foreground"
                        : e.kind === "changed"
                          ? "bg-warning text-warning-foreground"
                          : undefined
                    }
                  >
                    {intl.formatMessage(KIND[e.kind])}
                  </Badge>
                  <span className="font-mono">{e.name ?? e.id}</span>
                  {e.paths?.length ? (
                    <span className="font-mono text-muted-foreground">
                      {e.paths.join(" ")}
                    </span>
                  ) : null}
                  {e.actor ? (
                    <span className="text-muted-foreground">{e.actor}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/**
 * A snapshot with only the staged entities' rows, so the diff shows what
 * changed. A type whose rows have no id of their own (memberships,
 * keyed by consumer and group) is kept whole.
 */
function onlyChanged(
  snapshot: Record<string, unknown[]>,
  entities: Entity[],
): Record<string, unknown[]> {
  const changed = new Set(entities.map((e) => `${e.type}:${e.id}`));
  const types = new Set(entities.map((e) => e.type));
  return Object.fromEntries(
    Object.entries(snapshot)
      .filter(([type]) => types.has(type))
      .map(([type, rows]) => {
        const ids = rows.some((row) => (row as { id?: unknown }).id);
        return [
          type,
          ids
            ? rows.filter((row) =>
                changed.has(`${type}:${(row as { id?: unknown }).id}`),
              )
            : rows,
        ];
      }),
  );
}

/** What publishing now would warn about, in the warning colors. */
function PublishWarnings({
  warnings,
  render,
}: {
  warnings: Warning[];
  render: (warning: Warning) => string;
}) {
  const intl = useIntl();
  if (warnings.length === 0) return null;
  return (
    <Alert
      data-testid="publish-warnings"
      className="border-warning-foreground/30 bg-warning text-warning-foreground"
    >
      <TriangleAlert aria-hidden />
      <AlertDescription className="flex flex-col gap-1 text-warning-foreground">
        <span>{intl.formatMessage(uiConfigWarningsAhead)}</span>
        <ul className="list-disc pl-4">
          {warnings.map((warning) => (
            <li key={JSON.stringify(warning)}>{render(warning)}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

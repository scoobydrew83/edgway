/**
 * The route tester: a request sent through the live gateway with a trace
 * token (the admin's `/tester`), showing the matched route, the response, and
 * each plugin's decision as a waterfall with the upstream's share (
 * the upstream's own timing since an earlier release).
 */
import { HEADER, TRACE } from "@edgway/constants";
import {
  uiTesterBody,
  uiTesterDuration,
  uiTesterHeaders,
  uiTesterMethod,
  uiTesterNoPlugins,
  uiTesterOrder,
  uiTesterOutcome,
  uiTesterPath,
  uiTesterPhase,
  uiTesterPlugin,
  uiTesterPublishedOnly,
  uiTesterResponseBody,
  uiTesterResponseHeaders,
  uiTesterRoute,
  uiTesterSend,
  uiTesterStatus,
  uiTesterTitle,
  uiTesterTruncated,
  uiTesterUpstream,
  uiValidationJson,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Alert, AlertDescription } from "@edgway/ui-kit/components/ui/alert";
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
import { Textarea } from "@edgway/ui-kit/components/ui/textarea";
import { ArrowRight, Info } from "lucide-react";
import { useGetOne, useNotify } from "ra-core";
import { type FormEvent, Fragment, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { call, client } from "../data-provider";
import { useCan } from "../role";
import { spanOf, UPSTREAM, waterfall } from "./waterfall";

type Result = sdk.TestRouteResponses[200];

type Method = NonNullable<sdk.TestRouteData["body"]>["method"];
const METHODS: NonNullable<Method>[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
const KIB = 1024;

export function TesterPage() {
  const intl = useIntl();
  // Testing a route needs an editor; ViewerNotice says why.
  const canEdit = useCan("editor");
  const notify = useNotify();
  const [method, setMethod] = useState<NonNullable<Method>>("GET");
  const [path, setPath] = useState("/");
  const [headers, setHeaders] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<Result>();

  const send = async (event: FormEvent) => {
    event.preventDefault();
    let parsed: Record<string, string> | undefined;
    try {
      parsed = headers.trim() ? JSON.parse(headers) : undefined;
    } catch {
      notify(intl.formatMessage(uiValidationJson), { type: "error" });
      return;
    }
    try {
      setResult(
        (await call(
          sdk.testRoute({
            client,
            body: {
              method,
              path,
              headers: parsed,
              body: body || undefined,
            },
          }),
        )) as Result,
      );
    } catch (error) {
      notify((error as Error).message, { type: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <h1 className="text-3xl font-semibold">
        {intl.formatMessage(uiTesterTitle)}
      </h1>
      <Alert
        data-testid="tester-published-only"
        className="border-primary/20 bg-primary/5"
      >
        <Info aria-hidden />
        <AlertDescription>
          {intl.formatMessage(uiTesterPublishedOnly)}
        </AlertDescription>
      </Alert>
      <Card>
        <CardContent>
          <form onSubmit={send} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tester-method">
                  {intl.formatMessage(uiTesterMethod)}
                </Label>
                <select
                  id="tester-method"
                  className="h-11 rounded-lg border border-input bg-transparent px-3 font-mono text-sm shadow-xs"
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as NonNullable<Method>)
                  }
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <Label htmlFor="tester-path">
                  {intl.formatMessage(uiTesterPath)}
                </Label>
                <Input
                  id="tester-path"
                  className="h-11 font-mono"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="h-11"
                disabled={!canEdit}
              >
                <ArrowRight aria-hidden />
                {intl.formatMessage(uiTesterSend)}
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tester-headers">
                  {intl.formatMessage(uiTesterHeaders)}
                </Label>
                <Textarea
                  id="tester-headers"
                  rows={3}
                  className="font-mono"
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tester-body">
                  {intl.formatMessage(uiTesterBody)}
                </Label>
                <Textarea
                  id="tester-body"
                  rows={3}
                  className="font-mono"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      {result ? <TesterResult result={result} /> : null}
    </div>
  );
}

/** A status's badge colors: 2xx, then 3xx and 4xx, then 5xx. */
const STATUS_TINTS = [
  "bg-success text-success-foreground",
  "bg-warning text-warning-foreground",
  "bg-destructive/10 text-destructive",
];
const HTTP_REDIRECT = 300;
const HTTP_SERVER_ERROR = 500;
const statusTint = (status: number) =>
  STATUS_TINTS[
    Number(status >= HTTP_REDIRECT) + Number(status >= HTTP_SERVER_ERROR)
  ];

/** The matched route, by name when it can be looked up (else its id). */
function MatchedRoute({ id }: { id: string }) {
  const intl = useIntl();
  const { data } = useGetOne(
    "routes",
    { id },
    { retry: false, throwOnError: false },
  );
  return (
    <span data-testid="tester-route" className="text-sm text-muted-foreground">
      {intl.formatMessage(uiTesterRoute as MessageDescriptor, {
        route: (
          <Link
            to={`/routes/${id}/show`}
            className="font-mono text-primary underline"
          >
            {String(data?.name ?? id)}
          </Link>
        ),
      })}
    </span>
  );
}

/** One send's result: status, route, the plugins' waterfall, the response. */
function TesterResult({ result }: { result: Result }) {
  const intl = useIntl();
  const route = result.headers[HEADER.route];
  const segments = waterfall(result.trace);
  const span = spanOf(segments, result.durationMs);
  return (
    <Card className="gap-0 py-0" data-testid="tester-result">
      <div className="flex flex-wrap items-center gap-4 border-b px-6 py-4">
        <Badge
          data-testid="tester-status"
          className={`font-mono text-sm ${statusTint(result.status)}`}
        >
          {result.status}
        </Badge>
        <span className="font-semibold">
          {intl.formatMessage(uiTesterStatus as MessageDescriptor, {
            status: result.status,
            ms: Math.round(result.durationMs),
          })}
        </span>
        {/* The gateway names the matched route on every traced response,
            a plugin's short-circuit too. */}
        {route ? <MatchedRoute id={route} /> : null}
      </div>
      {result.trace.every((entry) => entry.phase === UPSTREAM) ? (
        <p className="px-6 py-4 text-muted-foreground">
          {intl.formatMessage(uiTesterNoPlugins)}
        </p>
      ) : null}
      {segments.length > 0 ? (
        <div className="flex flex-col gap-2 py-4">
          <h2 className="px-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {intl.formatMessage(uiTesterOrder)}
          </h2>
          <Table data-testid="tester-trace">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">
                  {intl.formatMessage(uiTesterPlugin)}
                </TableHead>
                <TableHead>{intl.formatMessage(uiTesterPhase)}</TableHead>
                <TableHead>{intl.formatMessage(uiTesterOutcome)}</TableHead>
                <TableHead className="w-2/5 pr-6">
                  {intl.formatMessage(uiTesterDuration)}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {segments.map((segment) => {
                const upstream = segment.phase === UPSTREAM;
                return (
                  <TableRow
                    key={`${segment.label}:${segment.phase}:${segment.start}`}
                    data-testid={upstream ? "tester-upstream" : undefined}
                    className={upstream ? "bg-muted/40" : undefined}
                  >
                    <TableCell
                      className={`pl-6 font-mono ${upstream ? "italic text-muted-foreground" : ""}`}
                    >
                      {upstream
                        ? intl.formatMessage(uiTesterUpstream)
                        : segment.label}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {upstream ? null : segment.phase}
                    </TableCell>
                    <TableCell>
                      {segment.outcome ? (
                        <Badge
                          className={
                            segment.outcome === "ok"
                              ? "bg-muted text-muted-foreground"
                              : "bg-destructive/10 text-destructive"
                          }
                        >
                          {segment.outcome}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="pr-6">
                      <span className="flex items-center gap-3">
                        {/* The waterfall: each bar starts where it ran. */}
                        <span className="relative h-2 flex-1 rounded-full bg-muted">
                          <span
                            className={`absolute h-2 rounded-full ${upstream ? "bg-muted-foreground" : "bg-primary"}`}
                            style={{
                              left: `${(segment.start / span) * 100}%`,
                              width: `max(4px, ${(segment.duration / span) * 100}%)`,
                            }}
                          />
                        </span>
                        <span className="w-12 text-right font-mono text-sm">
                          {Math.round(segment.duration * 100) / 100}
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <div className="grid border-t md:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-2 p-6 md:border-r">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {intl.formatMessage(uiTesterResponseHeaders)}
          </h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 font-mono text-xs">
            {Object.entries(result.headers).map(([name, value]) => (
              <Fragment key={name}>
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="break-all">{value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
        <section className="flex min-w-0 flex-col gap-2 p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {intl.formatMessage(uiTesterResponseBody)}
          </h2>
          <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sidebar p-4 font-mono text-xs text-sidebar-foreground">
            {result.body}
          </pre>
          {result.truncated ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(uiTesterTruncated as MessageDescriptor, {
                kib: TRACE.maxBodyBytes / KIB,
              })}
            </p>
          ) : null}
        </section>
      </div>
    </Card>
  );
}

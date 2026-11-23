/**
 * The overview dashboard: the gateway's traffic from Analytics Engine, over
 * a chosen range: requests, error rate, p50 and p99 beside the live
 * config, and the hourly chart in the chart tokens.
 */

import { ANALYTICS } from "@edgway/constants";
import {
  uiOverviewConsumer,
  uiOverviewEmpty,
  uiOverviewErrorRate,
  uiOverviewErrors,
  uiOverviewLastPublish,
  uiOverviewLatency,
  uiOverviewLiveConfig,
  uiOverviewMs,
  uiOverviewNoTraffic,
  uiOverviewNothingLive,
  uiOverviewNoValue,
  uiOverviewP50,
  uiOverviewP99,
  uiOverviewRange,
  uiOverviewRangeDay,
  uiOverviewRangeHour,
  uiOverviewRangeWeek,
  uiOverviewRequests,
  uiOverviewRoute,
  uiOverviewTitle,
  uiOverviewTopConsumers,
  uiOverviewTopRoutes,
  uiOverviewVersion,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { cssVar } from "@edgway/tokens";
import { Loading } from "@edgway/ui-kit/components/admin/loading";
import { Button } from "@edgway/ui-kit/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@edgway/ui-kit/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@edgway/ui-kit/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@edgway/ui-kit/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { type IntlShape, type MessageDescriptor, useIntl } from "react-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { call, client } from "../data-provider";
import { ErrorState } from "../error-state";

type Overview = sdk.AnalyticsOverviewResponses[200];

type Range = (typeof ANALYTICS.overviewRanges)[number];

/** Latency's dash, so it differs from the counts by more than hue. */
const DASHED = "4 4";
type Hours = NonNullable<sdk.AnalyticsOverviewData["query"]>["hours"];

const RANGE_LABELS: Record<Range, MessageDescriptor> = {
  1: uiOverviewRangeHour,
  24: uiOverviewRangeDay,
  168: uiOverviewRangeWeek,
};

/** The range buttons. */
function RangePicker(props: { value: Range; onChange: (r: Range) => void }) {
  const intl = useIntl();
  return (
    <fieldset
      className="flex gap-1"
      aria-label={intl.formatMessage(uiOverviewRange)}
    >
      {ANALYTICS.overviewRanges.map((hours) => (
        <Button
          key={hours}
          size="sm"
          variant={hours === props.value ? "default" : "outline"}
          aria-pressed={hours === props.value}
          onClick={() => props.onChange(hours)}
        >
          {intl.formatMessage(RANGE_LABELS[hours])}
        </Button>
      ))}
    </fieldset>
  );
}

/** One figure with its label. */
function Tile(props: {
  label: string;
  testId: string;
  children: ReactNode;
  detail?: string;
}) {
  return (
    <Card className="flex-1" data-testid={props.testId}>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{props.children}</div>
        {props.detail ? (
          <p className="text-sm text-muted-foreground">{props.detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

const ms = (intl: IntlShape, value: number | null) =>
  value === null
    ? intl.formatMessage(uiOverviewNoValue)
    : intl.formatMessage(uiOverviewMs as MessageDescriptor, { ms: value });

/** The live config version and the last publish; shown with or without analytics. */
function ConfigTile({ config }: { config: Overview["config"] }) {
  const intl = useIntl();
  const last = config.last_publish;
  return (
    <Tile
      label={intl.formatMessage(uiOverviewLiveConfig)}
      testId="overview-config"
      detail={
        last
          ? intl.formatMessage(uiOverviewLastPublish as MessageDescriptor, {
              version: last.version,
              when: intl.formatDate(last.created_at * 1000, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
              who: last.created_by,
            })
          : undefined
      }
    >
      {config.live === null
        ? intl.formatMessage(uiOverviewNothingLive)
        : intl.formatMessage(uiOverviewVersion as MessageDescriptor, {
            version: config.live,
          })}
    </Tile>
  );
}

/** A table of ids by request count (routes, consumers). */
function TopTable(props: {
  title: string;
  column: string;
  testId: string;
  rows: { id: string; requests: number; errors: number }[];
}) {
  const intl = useIntl();
  return (
    <Card data-testid={props.testId}>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{props.column}</TableHead>
              <TableHead>{intl.formatMessage(uiOverviewRequests)}</TableHead>
              <TableHead>{intl.formatMessage(uiOverviewErrors)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.id}</TableCell>
                <TableCell>{row.requests}</TableCell>
                <TableCell>{row.errors}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const intl = useIntl();
  const [range, setRange] = useState<Range>(ANALYTICS.overviewHours as Range);
  const { data, error, refetch } = useQuery({
    queryKey: ["analytics-overview", range],
    retry: 1,
    queryFn: async () =>
      (await call(
        sdk.analyticsOverview({
          client,
          query: { hours: String(range) as Hours },
        }),
      )) as Overview,
  });
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <Loading />;
  const empty = !data.configured || data.series.length === 0;
  const requests = data.series.reduce((sum, row) => sum + row.requests, 0);
  const errors = data.series.reduce((sum, row) => sum + row.errors, 0);
  // Requests, server errors and latency (dashed): chart-1, -2 and -3, so the
  // series differ by lightness and dash as well as hue (ui-guidelines).
  const chart = {
    requests: {
      label: intl.formatMessage(uiOverviewRequests),
      color: cssVar("chart-1"),
    },
    errors: {
      label: intl.formatMessage(uiOverviewErrors),
      color: cssVar("chart-2"),
    },
    mean_ms: {
      label: intl.formatMessage(uiOverviewLatency),
      color: cssVar("chart-3"),
    },
  } satisfies ChartConfig;
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">
          {intl.formatMessage(uiOverviewTitle as MessageDescriptor, {
            hours: data.hours,
          })}
        </h1>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <ConfigTile config={data.config} />
        {empty ? null : (
          <>
            <Tile
              label={intl.formatMessage(uiOverviewRequests)}
              testId="overview-requests"
            >
              {intl.formatNumber(requests)}
            </Tile>
            <Tile
              label={intl.formatMessage(uiOverviewErrorRate)}
              testId="overview-error-rate"
            >
              {intl.formatNumber(requests ? errors / requests : 0, {
                style: "percent",
                maximumFractionDigits: 2,
              })}
            </Tile>
            <Tile
              label={intl.formatMessage(uiOverviewP50)}
              testId="overview-p50"
            >
              {ms(intl, data.latency.p50_ms)}
            </Tile>
            <Tile
              label={intl.formatMessage(uiOverviewP99)}
              testId="overview-p99"
            >
              {ms(intl, data.latency.p99_ms)}
            </Tile>
          </>
        )}
      </div>
      {empty ? (
        <p className="text-muted-foreground" data-testid="overview-empty">
          {data.configured
            ? intl.formatMessage(uiOverviewNoTraffic as MessageDescriptor, {
                hours: data.hours,
              })
            : intl.formatMessage(uiOverviewEmpty)}
        </p>
      ) : (
        <>
          <Card>
            <CardContent>
              <ChartContainer
                config={chart}
                className="h-72 w-full"
                data-testid="overview-chart"
              >
                <LineChart data={data.series}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="hour" tickLine={false} />
                  <YAxis yAxisId="count" tickLine={false} />
                  <YAxis yAxisId="ms" orientation="right" tickLine={false} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        // The UI's locale, not the browser's.
                        formatter={(value, name, item) => (
                          <div className="flex w-full items-center gap-2 leading-none">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                              style={{ background: item.color }}
                            />
                            <span className="flex-1 text-muted-foreground">
                              {chart[name as keyof typeof chart]?.label ?? name}
                            </span>
                            <span className="font-mono font-medium text-foreground tabular-nums">
                              {intl.formatNumber(Number(value))}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line
                    yAxisId="count"
                    dataKey="requests"
                    stroke="var(--color-requests)"
                    dot={false}
                  />
                  <Line
                    yAxisId="count"
                    dataKey="errors"
                    stroke="var(--color-errors)"
                    dot={false}
                  />
                  <Line
                    yAxisId="ms"
                    dataKey="mean_ms"
                    stroke="var(--color-mean_ms)"
                    strokeDasharray={DASHED}
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <TopTable
            title={intl.formatMessage(uiOverviewTopRoutes)}
            column={intl.formatMessage(uiOverviewRoute)}
            testId="overview-routes"
            rows={data.routes.map((row) => ({ ...row, id: row.route }))}
          />
          <TopTable
            title={intl.formatMessage(uiOverviewTopConsumers)}
            column={intl.formatMessage(uiOverviewConsumer)}
            testId="overview-consumers"
            rows={data.consumers.map((row) => ({ ...row, id: row.consumer }))}
          />
        </>
      )}
    </div>
  );
}

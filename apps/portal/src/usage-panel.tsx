/**
 * The developer's usage (Drew): their requests and server errors per
 * day, under the key help on the API keys page (Zudoku's
 * `api-keys-list-page-before-keys` slot). Hidden when the portal has no
 * Analytics Engine access or the request fails: it never blocks the keys.
 * A bar chart in the chart tokens (requests chart-1, server errors chart-2),
 * with the numbers as a table behind a disclosure.
 */
import {
  portalUsageChart,
  portalUsageDay,
  portalUsageErrors,
  portalUsageNone,
  portalUsageRequests,
  portalUsageShowTable,
  portalUsageTitle,
} from "@edgway/i18n/messages";
import { cssVar } from "@edgway/tokens";
import { useEffect, useState } from "react";
import type { MessageDescriptor } from "react-intl";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useZudoku } from "zudoku/hooks";
import { fetchUsage } from "./api-key-service";
import { intl } from "./intl";
import type { PortalUsage } from "./routes";

export function UsagePanel() {
  const context = useZudoku();
  const [usage, setUsage] = useState<PortalUsage>();
  useEffect(() => {
    let live = true;
    fetchUsage(context)
      .then((answer) => {
        if (live) setUsage(answer);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [context]);
  if (!usage?.configured) return null;
  const days = { days: usage.days };
  const rows = usage.daily.map((row) => ({
    ...row,
    label: intl.formatDate(row.day.replace(" ", "T"), { dateStyle: "medium" }),
  }));
  return (
    <section className="mt-4" data-testid="usage-panel">
      <h2 className="mb-2 text-lg font-semibold">
        {intl.formatMessage(portalUsageTitle as MessageDescriptor, days)}
      </h2>
      {usage.daily.length === 0 ? (
        <p className="text-muted-foreground">
          {intl.formatMessage(portalUsageNone as MessageDescriptor, days)}
        </p>
      ) : (
        <>
          <figure
            className="h-64 w-full"
            data-testid="usage-chart"
            aria-label={intl.formatMessage(portalUsageChart)}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <XAxis dataKey="label" tickLine={false} />
                <YAxis tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(value) => intl.formatNumber(Number(value))}
                />
                <Legend />
                <Bar
                  dataKey="requests"
                  name={intl.formatMessage(portalUsageRequests)}
                  fill={cssVar("chart-1")}
                />
                <Bar
                  dataKey="errors"
                  name={intl.formatMessage(portalUsageErrors)}
                  fill={cssVar("chart-2")}
                />
              </BarChart>
            </ResponsiveContainer>
          </figure>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">
              {intl.formatMessage(portalUsageShowTable)}
            </summary>
            <table className="mt-2 w-full text-sm" data-testid="usage-table">
              <thead>
                <tr className="text-left">
                  <th>{intl.formatMessage(portalUsageDay)}</th>
                  <th>{intl.formatMessage(portalUsageRequests)}</th>
                  <th>{intl.formatMessage(portalUsageErrors)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.day}>
                    <td>{row.label}</td>
                    <td>{intl.formatNumber(row.requests)}</td>
                    <td>{intl.formatNumber(row.errors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

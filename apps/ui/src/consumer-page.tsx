/**
 * The consumer page (the Consumer board): its name with an avatar and
 * its developer-portal badges, Edit and Block or Unblock portal access, the
 * details that are set, then its credentials as cards in two columns (API
 * keys, basic auth, JWT, ACL groups as removable chips) and the plugins set
 * on it. The portal status is the admin's read-only `portal`.
 */
import { ADMIN_PAGE } from "@edgway/constants";
import {
  uiConsumerAddToGroup,
  uiConsumerAllowed,
  uiConsumerBlock,
  uiConsumerBlockConfirm,
  uiConsumerBlocked,
  uiConsumerDeveloper,
  uiConsumerJwtKey,
  uiConsumerLeaveGroup,
  uiConsumerNoGroups,
  uiConsumerNoPlugins,
  uiConsumerPlugins,
  uiConsumerUnblock,
  uiConsumerUnblockConfirm,
  uiCredentialsAdd,
  uiCredentialsNone,
  uiEntityJwtSecrets,
  uiEntityPlugins,
  uiFieldAlgorithm,
  uiNavAcls,
  uiNavJwtSecrets,
  uiPluginDisabled,
  uiPluginEnabled,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Confirm } from "@edgway/ui-kit/components/admin/confirm";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { Button, buttonVariants } from "@edgway/ui-kit/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@edgway/ui-kit/components/ui/table";
import { X } from "lucide-react";
import {
  useDelete,
  useGetManyReference,
  useNotify,
  useRecordContext,
  useRefresh,
  useTranslate,
} from "ra-core";
import { type ReactNode, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { ConsumerCredentials } from "./credentials";
import { call, client } from "./data-provider";
import { FIELD_LABELS } from "./fields";
import { useCan } from "./role";
import { PageCard } from "./service-flow";

type Row = Record<string, unknown> & { id: string };

interface Portal {
  developer: boolean;
  blocked: boolean;
}

/** How a consumer is named: its username, else its display name. */
const nameOf = (record: Record<string, unknown>) =>
  String(record.username ?? record.display_name ?? record.id);

/** A link to create a related entity with this consumer filled in. */
function AddLink({
  to,
  consumer,
  label,
}: {
  to: string;
  consumer: string;
  label: string;
}) {
  const canEdit = useCan("editor");
  if (!canEdit) return null;
  return (
    <Link
      to={to}
      state={{ record: { consumer_id: consumer } }}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      {label}
    </Link>
  );
}

const useRelated = (resource: string, consumer: string) =>
  useGetManyReference<Row>(resource, {
    target: "consumer_id",
    id: consumer,
    pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
    sort: { field: "id", order: "ASC" },
  });

/** The title: an avatar and the consumer's name. */
export function ConsumerTitle() {
  const record = useRecordContext();
  if (!record) return null;
  const name = nameOf(record);
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-lg font-semibold uppercase text-primary"
      >
        {name.slice(0, 1)}
      </span>
      {name}
    </span>
  );
}

/** Edit, and Block or Unblock portal access for a portal developer. */
export function ConsumerActions() {
  const intl = useIntl();
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const record = useRecordContext();
  const canEdit = useCan("editor");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!record || !canEdit) return null;
  const portal = record.portal as Portal | undefined;
  const blocked = portal?.blocked === true;
  const name = nameOf(record);
  return (
    <div className="flex items-center gap-2">
      <Link
        to={`/consumers/${record.id}`}
        className={buttonVariants({ variant: "outline" })}
      >
        {translate("ra.action.edit")}
      </Link>
      {portal?.developer ? (
        <>
          <Button
            variant="outline"
            className={
              blocked ? undefined : "border-destructive text-destructive"
            }
            onClick={() => setOpen(true)}
          >
            {intl.formatMessage(blocked ? uiConsumerUnblock : uiConsumerBlock)}
          </Button>
          <Confirm
            isOpen={open}
            loading={pending}
            title={intl.formatMessage(
              blocked ? uiConsumerUnblock : uiConsumerBlock,
            )}
            content={intl.formatMessage(
              (blocked
                ? uiConsumerUnblockConfirm
                : uiConsumerBlockConfirm) as MessageDescriptor,
              { name },
            )}
            confirm={intl.formatMessage(
              blocked ? uiConsumerUnblock : uiConsumerBlock,
            )}
            onClose={() => setOpen(false)}
            onConfirm={async () => {
              setPending(true);
              try {
                const path = { id: String(record.id) };
                await call(
                  blocked
                    ? sdk.unblockPortalDeveloper({ client, path })
                    : sdk.blockPortalDeveloper({ client, path }),
                );
                setOpen(false);
                refresh();
              } catch (error) {
                notify((error as Error).message, { type: "error" });
              } finally {
                setPending(false);
              }
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/** The JWT credentials card: each key (its iss) and algorithm. */
function JwtCard({ consumer }: { consumer: string }) {
  const intl = useIntl();
  const { data = [] } = useRelated("jwt_secrets", consumer);
  return (
    <PageCard
      title={intl.formatMessage(uiNavJwtSecrets)}
      aside={
        <AddLink
          to="/jwt_secrets/create"
          consumer={consumer}
          label={intl.formatMessage(uiCredentialsAdd as MessageDescriptor, {
            resource: intl.formatMessage(uiEntityJwtSecrets),
          })}
        />
      }
    >
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(uiCredentialsNone)}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{intl.formatMessage(uiConsumerJwtKey)}</TableHead>
              <TableHead>{intl.formatMessage(uiFieldAlgorithm)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((jwt) => (
              <TableRow key={jwt.id}>
                <TableCell className="font-mono">
                  <Link
                    to={`/jwt_secrets/${jwt.id}/show`}
                    className="underline"
                  >
                    {String(jwt.key ?? jwt.id)}
                  </Link>
                </TableCell>
                <TableCell className="font-mono">
                  {String(jwt.algorithm ?? "")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PageCard>
  );
}

/** The ACL groups card: each group a chip; removing one stages its delete. */
function AclCard({ consumer }: { consumer: string }) {
  const intl = useIntl();
  const canEdit = useCan("editor");
  const notify = useNotify();
  const { data = [] } = useRelated("acls", consumer);
  const [remove] = useDelete();
  return (
    <PageCard
      title={intl.formatMessage(uiNavAcls)}
      aside={
        <AddLink
          to="/acls/create"
          consumer={consumer}
          label={intl.formatMessage(uiConsumerAddToGroup)}
        />
      }
    >
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(uiConsumerNoGroups)}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" data-testid="acl-groups">
          {data.map((acl) => (
            <li
              key={acl.id}
              className="flex items-center gap-1 rounded-2xl border py-1 pr-1 pl-3 font-mono text-sm"
            >
              {String(acl.group)}
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label={intl.formatMessage(
                    uiConsumerLeaveGroup as MessageDescriptor,
                    { group: String(acl.group) },
                  )}
                  onClick={() =>
                    void remove(
                      "acls",
                      { id: acl.id, previousData: acl },
                      {
                        mutationMode: "pessimistic",
                        onError: (error) =>
                          notify((error as Error).message, { type: "error" }),
                      },
                    )
                  }
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PageCard>
  );
}

/** The plugins set on this consumer. */
function PluginsCard({ consumer }: { consumer: string }) {
  const intl = useIntl();
  const { data = [] } = useRelated("plugins", consumer);
  return (
    <PageCard
      title={intl.formatMessage(uiConsumerPlugins)}
      aside={
        <AddLink
          to="/plugin-catalog"
          consumer={consumer}
          label={intl.formatMessage(uiCredentialsAdd as MessageDescriptor, {
            resource: intl.formatMessage(uiEntityPlugins),
          })}
        />
      }
    >
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(uiConsumerNoPlugins)}
        </p>
      ) : (
        <ul className="flex flex-col divide-y" data-testid="consumer-plugins">
          {data.map((plugin) => (
            <li
              key={plugin.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <Link
                to={`/plugins/${plugin.id}`}
                className="font-mono underline"
              >
                {String(plugin.name)}
              </Link>
              <Badge
                className={
                  plugin.enabled === false
                    ? "bg-muted text-muted-foreground"
                    : "bg-success text-success-foreground"
                }
              >
                {intl.formatMessage(
                  plugin.enabled === false ? uiPluginDisabled : uiPluginEnabled,
                )}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </PageCard>
  );
}

/** The fields shown in the details card, when set. */
const DETAILS = ["display_name", "username", "custom_id", "id"];

/** The consumer page's body. */
export function ConsumerPage() {
  const intl = useIntl();
  const record = useRecordContext();
  if (!record) return null;
  const consumer = String(record.id);
  const portal = record.portal as Portal | undefined;
  const details = DETAILS.filter(
    (field) =>
      record[field] !== null &&
      record[field] !== undefined &&
      record[field] !== "",
  );
  return (
    <div className="flex w-full flex-col gap-6">
      {portal?.developer ? (
        <span
          className="-mt-2 flex flex-wrap gap-2"
          data-testid="portal-badges"
        >
          <Badge className="bg-primary/10 text-primary">
            {intl.formatMessage(uiConsumerDeveloper)}
          </Badge>
          <Badge
            className={
              portal.blocked
                ? "bg-destructive/10 text-destructive"
                : "bg-success text-success-foreground"
            }
          >
            {intl.formatMessage(
              portal.blocked ? uiConsumerBlocked : uiConsumerAllowed,
            )}
          </Badge>
        </span>
      ) : null}
      <dl
        className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="consumer-details"
      >
        {details.map((field) => (
          <div key={field} className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {intl.formatMessage(FIELD_LABELS[field] as MessageDescriptor)}
            </dt>
            <dd className="break-all font-mono">{String(record[field])}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-6 lg:grid-cols-2">
        <ConsumerCredentials />
        <JwtCard consumer={consumer} />
        <AclCard consumer={consumer} />
      </div>
      <PluginsCard consumer={consumer} />
    </div>
  );
}

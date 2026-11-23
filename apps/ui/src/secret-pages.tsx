/**
 * The vaults and certificates pages (the Vaults and Certificates boards).
 * Vaults: the two built-in vaults and their reference forms, a
 * reference builder, the vault entities, and the plugin secrets kept as
 * plain text. Certificates: an expiry banner, the list with subject and
 * issuer, SNIs, key type and an expiry badge, and an add form that takes the
 * private key as a vault reference only.
 */
import { isVaultReference } from "@edgway/adapters-cf/secrets";
import {
  ADMIN_PAGE,
  CERTIFICATES,
  PUBLISH_WARNING,
  VAULT_REFERENCE,
  VAULTS,
} from "@edgway/constants";
import {
  uiCertBanner,
  uiCertExpired,
  uiCertExpires,
  uiCertIssuer,
  uiCertKeyHint,
  uiCertKeyInvalid,
  uiCertKeyType,
  uiCertPrivateKey,
  uiCertRead,
  uiCertReplace,
  uiCertSoon,
  uiCertStage,
  uiCertSubject,
  uiCertUnreadable,
  uiCertView,
  uiConfigActions,
  uiCredentialsAdd,
  uiEntityCertificates,
  uiEntityPlugins,
  uiEntityVaults,
  uiFieldCert,
  uiFieldSnis,
  uiFormCopy,
  uiNavCertificates,
  uiNavVaults,
  uiPageEditEntity,
  uiVaultsBuiltIn,
  uiVaultsEntities,
  uiVaultsEntitiesHint,
  uiVaultsEntityPrefix,
  uiVaultsEnvCard,
  uiVaultsIntro,
  uiVaultsMake,
  uiVaultsName,
  uiVaultsNeedsPrefix,
  uiVaultsNone,
  uiVaultsNoRaw,
  uiVaultsPrefix,
  uiVaultsRawFields,
  uiVaultsRawHint,
  uiVaultsRawTitle,
  uiVaultsStoreCard,
  uiVaultsUnchecked,
  uiVaultsVault,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Alert, AlertDescription } from "@edgway/ui-kit/components/ui/alert";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { Button, buttonVariants } from "@edgway/ui-kit/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
import { Textarea } from "@edgway/ui-kit/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useCreate, useGetList, useNotify } from "ra-core";
import { type ReactNode, useId, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { expiryOf, readCertificate } from "./certificates";
import { call, client } from "./data-provider";
import { ErrorState } from "./error-state";
import { useCan } from "./role";

type Row = Record<string, unknown> & { id: string };

/** A reference to `name` in `vault`, as the gateway reads it. */
function referenceTo(vault: string, name: string) {
  // Kong's env vault: lower case, underscores as dashes (VAULT_X → vault-x).
  const path =
    vault === VAULTS.env ? name.toLowerCase().replaceAll("_", "-") : name;
  return `${VAULT_REFERENCE.prefix}${vault}${VAULTS.separator}${path}${VAULT_REFERENCE.suffix}`;
}

/** A vault entity's references: its prefix over any secret path. */
const patternOf = (prefix: string) =>
  `${VAULT_REFERENCE.prefix}${prefix}${VAULTS.separator}…${VAULT_REFERENCE.suffix}`;

/** A page's title and the line under it. */
function Heading({
  title,
  intro,
  action,
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex max-w-3xl flex-col gap-1">
        <h1 className="text-3xl font-semibold">{title}</h1>
        {intro ? (
          <p className="text-sm text-muted-foreground">{intro}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** A built-in vault: what it reads, and its reference form. */
function BuiltIn({
  name,
  description,
  example,
}: {
  name: string;
  description: MessageDescriptor;
  example: ReactNode;
}) {
  const intl = useIntl();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono">{name}</CardTitle>
        <CardAction>
          <Badge variant="secondary">
            {intl.formatMessage(uiVaultsBuiltIn)}
          </Badge>
        </CardAction>
        <CardDescription>{intl.formatMessage(description)}</CardDescription>
      </CardHeader>
      <CardContent>
        <code className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm">
          {example}
        </code>
      </CardContent>
    </Card>
  );
}

/** The vaults page (replaces the generic vault list). */
export function VaultsPage() {
  const intl = useIntl();
  const canEdit = useCan("editor");
  const [vault, setVault] = useState<string>(VAULTS.env);
  const [name, setName] = useState(`${VAULTS.namePrefix}JWT_KEY`);
  const example = `${VAULTS.namePrefix}MY_SECRET`;
  const pending = useQuery({
    queryKey: ["pending-warnings"],
    queryFn: async () =>
      (await call(
        sdk.pendingChanges({ client, query: { warnings: "true" } }),
      )) as sdk.PendingChangesResponses[200],
  });
  const raw = (pending.data?.warnings ?? []).filter(
    (w) => w.code === PUBLISH_WARNING.rawSecret,
  );
  const vaults = useGetList<Row>("vaults", {
    pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
  });
  const reference = referenceTo(vault, name);
  return (
    <div className="flex flex-col gap-6 py-4" data-testid="vault-guide">
      <Heading
        title={intl.formatMessage(uiNavVaults)}
        intro={intl.formatMessage(uiVaultsIntro)}
      />
      <div className="flex flex-col gap-2">
        <div className="grid gap-4 md:grid-cols-2">
          <BuiltIn
            name={VAULTS.env}
            description={uiVaultsEnvCard}
            example={`${referenceTo(VAULTS.env, example)} → ${example}`}
          />
          <BuiltIn
            name={VAULTS.secretsStore}
            description={uiVaultsStoreCard}
            example={referenceTo(
              VAULTS.secretsStore,
              `${VAULTS.namePrefix}NAME`,
            )}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(uiVaultsPrefix as MessageDescriptor, {
            prefix: <code className="font-mono">{VAULTS.namePrefix}</code>,
          })}
        </p>
      </div>
      <Card role="region" aria-label={intl.formatMessage(uiVaultsMake)}>
        <CardHeader>
          <CardTitle>{intl.formatMessage(uiVaultsMake)}</CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vault-kind">
                {intl.formatMessage(uiVaultsVault)}
              </Label>
              <select
                id="vault-kind"
                className="h-11 rounded-lg border border-input bg-transparent px-3 font-mono text-sm shadow-xs"
                value={vault}
                onChange={(event) => setVault(event.target.value)}
              >
                <option value={VAULTS.env}>{VAULTS.env}</option>
                <option value={VAULTS.secretsStore}>
                  {VAULTS.secretsStore}
                </option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vault-name">
                {intl.formatMessage(uiVaultsName)}
              </Label>
              <Input
                id="vault-name"
                className="h-11 font-mono"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>
          {name.startsWith(VAULTS.namePrefix) ? null : (
            <p className="text-sm text-destructive">
              {intl.formatMessage(uiVaultsNeedsPrefix as MessageDescriptor, {
                prefix: VAULTS.namePrefix,
              })}
            </p>
          )}
          <div className="flex gap-2">
            <code
              className="flex flex-1 items-center rounded-lg bg-sidebar px-4 py-3 font-mono text-sm text-sidebar-foreground"
              data-testid="vault-reference"
            >
              {reference}
            </code>
            <Button
              type="button"
              variant="outline"
              className="h-auto"
              onClick={() => void navigator.clipboard.writeText(reference)}
            >
              {intl.formatMessage(uiFormCopy)}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {intl.formatMessage(uiVaultsUnchecked)}
          </p>
        </CardContent>
      </Card>
      <Card role="region" aria-label={intl.formatMessage(uiVaultsEntities)}>
        <CardHeader>
          <CardTitle>{intl.formatMessage(uiVaultsEntities)}</CardTitle>
          <CardDescription>
            {intl.formatMessage(uiVaultsEntitiesHint)}
          </CardDescription>
          {canEdit ? (
            <CardAction>
              <Link
                to="/vaults/create"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {intl.formatMessage(uiCredentialsAdd as MessageDescriptor, {
                  resource: intl.formatMessage(uiEntityVaults),
                })}
              </Link>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {(vaults.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(uiVaultsNone)}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {(vaults.data ?? []).map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-baseline gap-3 py-2 text-sm"
                >
                  <Link
                    to={`/vaults/${v.id}/show`}
                    className="font-mono text-primary underline"
                  >
                    {String(v.prefix)}
                  </Link>
                  <span className="text-muted-foreground">
                    {intl.formatMessage(
                      uiVaultsEntityPrefix as MessageDescriptor,
                      {
                        reference: (
                          <code className="font-mono">
                            {patternOf(String(v.prefix))}
                          </code>
                        ),
                      },
                    )}
                  </span>
                  {v.description ? (
                    <span className="text-muted-foreground">
                      {String(v.description)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card
        className="border-warning-foreground/30 bg-warning/40"
        data-testid="vault-raw"
      >
        <CardHeader>
          <CardTitle className="text-warning-foreground">
            {intl.formatMessage(uiVaultsRawTitle)}
          </CardTitle>
          <CardDescription className="text-warning-foreground">
            {intl.formatMessage(uiVaultsRawHint)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending.error ? (
            <ErrorState
              error={pending.error}
              onRetry={() => pending.refetch()}
            />
          ) : raw.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage(uiVaultsNoRaw)}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {raw.map((w) => (
                <li
                  key={w.plugin ?? w.name}
                  className="flex flex-wrap items-center gap-3 py-2 text-sm"
                >
                  <span className="font-mono">{w.name}</span>
                  <span className="text-muted-foreground">
                    {intl.formatMessage(
                      uiVaultsRawFields as MessageDescriptor,
                      {
                        count: (w.fields ?? []).length,
                        fields: (
                          <code className="font-mono">
                            {(w.fields ?? []).join(", ")}
                          </code>
                        ),
                      },
                    )}
                  </span>
                  {w.plugin && canEdit ? (
                    <Link
                      to={`/plugins/${w.plugin}`}
                      className={`${buttonVariants({ variant: "outline", size: "sm" })} ml-auto`}
                    >
                      {intl.formatMessage(
                        uiPageEditEntity as MessageDescriptor,
                        { entity: intl.formatMessage(uiEntityPlugins) },
                      )}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** A certificate's expiry as a badge in words, flagged when past or near. */
function ExpiryBadge({ notAfter }: { notAfter: Date }) {
  const intl = useIntl();
  const state = expiryOf(notAfter);
  const date = intl.formatDate(notAfter, { dateStyle: "medium" });
  return (
    <span className="flex items-center gap-2" data-expiry={state}>
      {state === "ok" ? (
        <span className="font-mono text-xs">{date}</span>
      ) : (
        <Badge
          className={
            state === "expired"
              ? "bg-destructive/10 text-destructive"
              : "bg-warning text-warning-foreground"
          }
        >
          {intl.formatMessage(state === "expired" ? uiCertExpired : uiCertSoon)}
        </Badge>
      )}
      {state === "ok" ? null : (
        <span className="font-mono text-xs">{date}</span>
      )}
    </span>
  );
}

/** Stage a certificate: the PEM, read as it's pasted, and a key reference. */
function AddCertificate() {
  const intl = useIntl();
  const notify = useNotify();
  const id = useId();
  const [cert, setCert] = useState("");
  const [key, setKey] = useState("");
  const [create, { isPending }] = useCreate();
  const info = readCertificate(cert);
  const keyInvalid = key !== "" && !isVaultReference(key);
  const example = `${VAULT_REFERENCE.prefix}${VAULTS.secretsStore}${VAULTS.separator}${VAULTS.namePrefix}API_TLS_KEY${VAULT_REFERENCE.suffix}`;
  return (
    <Card
      id="add-certificate"
      role="region"
      aria-label={intl.formatMessage(uiCredentialsAdd as MessageDescriptor, {
        resource: intl.formatMessage(uiEntityCertificates),
      })}
    >
      <CardHeader>
        <CardTitle>
          {intl.formatMessage(uiCredentialsAdd as MessageDescriptor, {
            resource: intl.formatMessage(uiEntityCertificates),
          })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (keyInvalid) return;
            void create(
              "certificates",
              { data: { cert, key } },
              {
                onSuccess: () => {
                  setCert("");
                  setKey("");
                },
                onError: (error) =>
                  notify((error as Error).message, { type: "error" }),
              },
            );
          }}
        >
          <div className="grid items-start gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-cert`}>
                {intl.formatMessage(uiFieldCert)}
              </Label>
              <Textarea
                id={`${id}-cert`}
                rows={6}
                required
                className="font-mono text-xs"
                value={cert}
                onChange={(event) => setCert(event.target.value)}
              />
              {cert ? (
                <p
                  className={`text-xs ${info ? "text-success-foreground" : "text-destructive"}`}
                  data-testid="cert-read"
                >
                  {info
                    ? intl.formatMessage(uiCertRead as MessageDescriptor, {
                        subject: info.subject,
                        date: intl.formatDate(info.notAfter, {
                          dateStyle: "medium",
                        }),
                        keyType: info.keyType,
                      })
                    : intl.formatMessage(uiCertUnreadable)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-key`}>
                {intl.formatMessage(uiCertPrivateKey)}
              </Label>
              <Input
                id={`${id}-key`}
                required
                className="h-11 font-mono"
                placeholder={example}
                aria-invalid={keyInvalid}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <p
                className={`text-xs ${keyInvalid ? "text-destructive" : "text-muted-foreground"}`}
              >
                {intl.formatMessage(
                  (keyInvalid
                    ? uiCertKeyInvalid
                    : uiCertKeyHint) as MessageDescriptor,
                  { example, prefix: VAULTS.namePrefix },
                )}
              </p>
            </div>
          </div>
          <Button
            type="submit"
            size="lg"
            className="self-start"
            disabled={isPending || keyInvalid}
          >
            {intl.formatMessage(uiCertStage)}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** The certificates page (replaces the generic certificate list). */
export function CertificatesPage() {
  const intl = useIntl();
  const canEdit = useCan("editor");
  const certificates = useGetList<Row>("certificates", {
    pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
  });
  const snis = useGetList<Row>("snis", {
    pagination: { page: 1, perPage: ADMIN_PAGE.maxSize },
  });
  if (certificates.error) {
    return (
      <ErrorState
        error={certificates.error}
        onRetry={() => certificates.refetch()}
      />
    );
  }
  const rows = (certificates.data ?? []).map((row) => ({
    row,
    info: readCertificate(row.cert),
    alt: readCertificate(row.cert_alt),
    snis: (snis.data ?? [])
      .filter((s) => s.certificate_id === row.id)
      .map((s) => String(s.name)),
  }));
  const flagged = rows.filter(
    ({ info }) => info && expiryOf(info.notAfter) !== "ok",
  ).length;
  return (
    <div className="flex flex-col gap-6 py-4">
      <Heading
        title={intl.formatMessage(uiNavCertificates)}
        action={
          canEdit ? (
            <a
              href="#add-certificate"
              className={buttonVariants({ variant: "default", size: "lg" })}
            >
              {intl.formatMessage(uiCredentialsAdd as MessageDescriptor, {
                resource: intl.formatMessage(uiEntityCertificates),
              })}
            </a>
          ) : null
        }
      />
      {flagged > 0 ? (
        <Alert variant="destructive" data-testid="cert-banner">
          <TriangleAlert aria-hidden />
          <AlertDescription>
            {intl.formatMessage(uiCertBanner as MessageDescriptor, {
              count: flagged,
              days: CERTIFICATES.expiryWarningDays,
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card className="py-0">
        <CardContent className="px-0">
          <Table data-testid="certificate-list">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">
                  {intl.formatMessage(uiCertSubject)}
                </TableHead>
                <TableHead>{intl.formatMessage(uiFieldSnis)}</TableHead>
                <TableHead>{intl.formatMessage(uiCertKeyType)}</TableHead>
                <TableHead>{intl.formatMessage(uiCertExpires)}</TableHead>
                <TableHead className="pr-5 text-right">
                  {intl.formatMessage(uiConfigActions)}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ row, info, alt, snis: names }) => {
                const state = info ? expiryOf(info.notAfter) : "ok";
                return (
                  <TableRow
                    key={row.id}
                    className={
                      state === "expired"
                        ? "bg-destructive/5"
                        : state === "soon"
                          ? "bg-warning/40"
                          : undefined
                    }
                  >
                    <TableCell className="pl-5">
                      {info ? (
                        <span className="flex flex-col">
                          <span className="font-mono text-sm">
                            {info.subject}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {intl.formatMessage(
                              uiCertIssuer as MessageDescriptor,
                              { issuer: info.issuer },
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {intl.formatMessage(uiCertUnreadable)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {names.join(", ")}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {[info?.keyType, alt?.keyType]
                        .filter(Boolean)
                        .join(" + ")}
                    </TableCell>
                    <TableCell>
                      {info ? <ExpiryBadge notAfter={info.notAfter} /> : null}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <Link
                        to={
                          state === "ok" || !canEdit
                            ? `/certificates/${row.id}/show`
                            : `/certificates/${row.id}`
                        }
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        {intl.formatMessage(
                          state === "ok" || !canEdit
                            ? uiCertView
                            : uiCertReplace,
                        )}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {canEdit ? <AddCertificate /> : null}
    </div>
  );
}

/**
 * A consumer's credentials, managed on its page: key-auth keys are
 * added, rotated and deleted there, and a new key is shown once in a dialog
 * with a copy button; basic-auth users are added, get a new password, or
 * are deleted. (The admin API lists both only under a consumer.)
 */
import {
  uiConfigActions,
  uiCredentialsAddBasic,
  uiCredentialsAddKey,
  uiCredentialsChangePassword,
  uiCredentialsDelete,
  uiCredentialsDeleteConfirm,
  uiCredentialsKeyPrefix,
  uiCredentialsNone,
  uiCredentialsPassword,
  uiCredentialsRotate,
  uiCredentialsRotateConfirm,
  uiCredentialsSave,
  uiCredentialsTtl,
  uiCredentialsUsername,
  uiKeyCopied,
  uiKeyCopy,
  uiKeyCopyFailed,
  uiKeyDialogTitle,
  uiKeyDone,
  uiKeyShownOnce,
  uiNavBasicAuth,
  uiNavKeyAuth,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Confirm } from "@edgway/ui-kit/components/admin/confirm";
import { Button } from "@edgway/ui-kit/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@edgway/ui-kit/components/ui/dialog";
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
import { useNotify, useRecordContext } from "ra-core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { call, client } from "./data-provider";
import { ErrorState } from "./error-state";
import { useCan } from "./role";
import { PageCard } from "./service-flow";

const ShowKey = createContext<(key: string) => void>(() => {});

/** Shows a new API key once, with a copy button. */
const useShowKey = () => useContext(ShowKey);

export function KeyDialogProvider({ children }: { children: ReactNode }) {
  const intl = useIntl();
  const notify = useNotify();
  const [key, setKey] = useState<string | undefined>();
  const show = useCallback((value: string) => setKey(value), []);
  const copy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      notify(intl.formatMessage(uiKeyCopied), { type: "info" });
    } catch {
      notify(intl.formatMessage(uiKeyCopyFailed), { type: "warning" });
    }
  };
  return (
    <ShowKey.Provider value={show}>
      {children}
      <Dialog
        open={key !== undefined}
        onOpenChange={(open) => (open ? undefined : setKey(undefined))}
      >
        <DialogContent data-testid="key-dialog">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage(uiKeyDialogTitle)}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage(uiKeyShownOnce)}
            </DialogDescription>
          </DialogHeader>
          <code
            className="break-all rounded-md border bg-muted p-3 font-mono text-sm"
            data-testid="new-key"
          >
            {key}
          </code>
          <DialogFooter>
            <Button variant="outline" onClick={copy}>
              {intl.formatMessage(uiKeyCopy)}
            </Button>
            <Button onClick={() => setKey(undefined)}>
              {intl.formatMessage(uiKeyDone)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ShowKey.Provider>
  );
}

type Row = { id: string } & Record<string, unknown>;

/** A consumer's credentials of one kind, refreshed after every change. */
function useCredentials(kind: "key-auth" | "basic-auth", consumer: string) {
  const list = kind === "key-auth" ? sdk.listKeyAuth : sdk.listBasicAuth;
  return useQuery({
    queryKey: ["credentials", kind, consumer],
    queryFn: async () =>
      (
        (await call(list({ client, path: { id: consumer } }))) as {
          data: Row[];
        }
      ).data,
  });
}

/** Runs an action once at a time; the confirm dialog shows it pending. */
function useAction() {
  const notify = useNotify();
  const [pending, setPending] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    try {
      await action();
    } catch (error) {
      notify((error as Error).message, { type: "error" });
    } finally {
      setPending(false);
    }
  };
  return { pending, run };
}

/** A confirmed action on one credential row. */
function ConfirmedButton({
  label,
  question,
  onConfirm,
  destructive,
}: {
  label: string;
  question: string;
  onConfirm: () => Promise<void>;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  // Editors and up; ViewerNotice says why.
  const canEdit = useCan("editor");
  return (
    <>
      <Button
        size="sm"
        variant={destructive ? "destructive" : "outline"}
        disabled={!canEdit}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Confirm
        isOpen={open}
        loading={pending}
        title={label}
        content={question}
        confirm={label}
        onClose={() => setOpen(false)}
        onConfirm={() =>
          run(async () => {
            await onConfirm();
            setOpen(false);
          })
        }
      />
    </>
  );
}

/** A credentials card (the kit's card, as on the other entity pages). */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageCard title={title} aside={action}>
      {children}
    </PageCard>
  );
}

function KeyAuthSection({ consumer }: { consumer: string }) {
  const intl = useIntl();
  const showKey = useShowKey();
  const queries = useQueryClient();
  const keys = useCredentials("key-auth", consumer);
  const { pending, run } = useAction();
  const canEdit = useCan("editor");
  const refresh = () =>
    queries.invalidateQueries({
      queryKey: ["credentials", "key-auth", consumer],
    });
  const issued = async (promise: ReturnType<typeof sdk.createKeyAuth>) => {
    const { key } = (await call(promise)) as { key: string };
    showKey(key);
    await refresh();
  };
  return (
    <Section
      title={intl.formatMessage(uiNavKeyAuth)}
      action={
        <Button
          size="sm"
          disabled={!canEdit || pending}
          onClick={() =>
            run(() =>
              issued(
                sdk.createKeyAuth({ client, path: { id: consumer }, body: {} }),
              ),
            )
          }
        >
          {intl.formatMessage(uiCredentialsAddKey)}
        </Button>
      }
    >
      <CredentialTable
        columns={[
          ["key_prefix", uiCredentialsKeyPrefix],
          ["ttl", uiCredentialsTtl],
        ]}
        query={keys}
        actions={(row) => (
          <>
            <ConfirmedButton
              label={intl.formatMessage(uiCredentialsRotate)}
              question={intl.formatMessage(uiCredentialsRotateConfirm)}
              onConfirm={() =>
                issued(
                  sdk.rotateKeyAuth({
                    client,
                    path: { id: row.id },
                  }) as ReturnType<typeof sdk.createKeyAuth>,
                )
              }
            />
            <ConfirmedButton
              destructive
              label={intl.formatMessage(uiCredentialsDelete)}
              question={intl.formatMessage(uiCredentialsDeleteConfirm)}
              onConfirm={async () => {
                await call(sdk.deleteKeyAuth({ client, path: { id: row.id } }));
                await refresh();
              }}
            />
          </>
        )}
      />
    </Section>
  );
}

/** Username and password, for a new basic-auth user or a new password. */
function BasicAuthDialog({
  title,
  withUsername,
  open,
  onClose,
  onSave,
}: {
  title: string;
  withUsername: boolean;
  open: boolean;
  onClose: () => void;
  onSave: (values: { username?: string; password: string }) => Promise<void>;
}) {
  const intl = useIntl();
  const { pending, run } = useAction();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Two of these dialogs live on the page: their own ids.
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              await onSave(
                withUsername ? { username, password } : { password },
              );
              setUsername("");
              setPassword("");
              onClose();
            });
          }}
        >
          {withUsername ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-username`}>
                {intl.formatMessage(uiCredentialsUsername)}
              </Label>
              <Input
                id={`${id}-username`}
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-password`}>
              {intl.formatMessage(uiCredentialsPassword)}
            </Label>
            <Input
              id={`${id}-password`}
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {intl.formatMessage(uiCredentialsSave)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BasicAuthSection({ consumer }: { consumer: string }) {
  const intl = useIntl();
  const canEdit = useCan("editor");
  const queries = useQueryClient();
  const users = useCredentials("basic-auth", consumer);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<string | undefined>();
  const refresh = () =>
    queries.invalidateQueries({
      queryKey: ["credentials", "basic-auth", consumer],
    });
  return (
    <Section
      title={intl.formatMessage(uiNavBasicAuth)}
      action={
        <Button size="sm" disabled={!canEdit} onClick={() => setAdding(true)}>
          {intl.formatMessage(uiCredentialsAddBasic)}
        </Button>
      }
    >
      <CredentialTable
        columns={[["username", uiCredentialsUsername]]}
        query={users}
        actions={(row) => (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit}
              onClick={() => setChanging(row.id)}
            >
              {intl.formatMessage(uiCredentialsChangePassword)}
            </Button>
            <ConfirmedButton
              destructive
              label={intl.formatMessage(uiCredentialsDelete)}
              question={intl.formatMessage(uiCredentialsDeleteConfirm)}
              onConfirm={async () => {
                await call(
                  sdk.deleteBasicAuth({ client, path: { id: row.id } }),
                );
                await refresh();
              }}
            />
          </>
        )}
      />
      <BasicAuthDialog
        title={intl.formatMessage(uiCredentialsAddBasic)}
        withUsername
        open={adding}
        onClose={() => setAdding(false)}
        onSave={async (values) => {
          await call(
            sdk.createBasicAuth({
              client,
              path: { id: consumer },
              body: values as { username: string; password: string },
            }),
          );
          await refresh();
        }}
      />
      <BasicAuthDialog
        title={intl.formatMessage(uiCredentialsChangePassword)}
        withUsername={false}
        open={changing !== undefined}
        onClose={() => setChanging(undefined)}
        onSave={async ({ password }) => {
          await call(
            sdk.updateBasicAuth({
              client,
              path: { id: changing ?? "" },
              body: { password },
            }),
          );
          await refresh();
        }}
      />
    </Section>
  );
}

function CredentialTable({
  columns,
  query,
  actions,
}: {
  /** Field and its column header. */
  columns: [string, MessageDescriptor][];
  query: ReturnType<typeof useCredentials>;
  actions: (row: Row) => ReactNode;
}) {
  const intl = useIntl();
  const rows = query.data;
  // A failed list shows the admin's error, not an empty table.
  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  if (rows && rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {intl.formatMessage(uiCredentialsNone)}
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map(([field, label]) => (
            <TableHead key={field}>{intl.formatMessage(label)}</TableHead>
          ))}
          <TableHead>
            <span className="sr-only">
              {intl.formatMessage(uiConfigActions)}
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(rows ?? []).map((row) => (
          <TableRow key={row.id}>
            {columns.map(([field]) => (
              <TableCell key={field}>{String(row[field] ?? "")}</TableCell>
            ))}
            <TableCell className="flex justify-end gap-2">
              {actions(row)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The consumer page's key-auth and basic-auth cards. */
export function ConsumerCredentials() {
  const record = useRecordContext();
  if (!record) return null;
  const consumer = String(record.id);
  return (
    <>
      <KeyAuthSection consumer={consumer} />
      <BasicAuthSection consumer={consumer} />
    </>
  );
}

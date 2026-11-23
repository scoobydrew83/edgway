/**
 * The signed-in identity and its role (ui-guidelines "Patterns:
 * Roles"): actions above the role are disabled with a line naming who can
 * do them. The admin's role checks stay the authority; this only explains.
 */
import {
  uiRoleEditor,
  uiRoleEditorNeedPublisher,
  uiRoleNeedEditor,
  uiRoleOwner,
  uiRolePublisher,
  uiRoleSignedIn,
  uiRoleSignedInWith,
  uiRoleViewer,
  uiRoleViewerNeedPublisher,
} from "@edgway/i18n/messages";
import * as sdk from "@edgway/sdk";
import { Badge } from "@edgway/ui-kit/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { type MessageDescriptor, useIntl } from "react-intl";
import { call, client } from "./data-provider";

// The admin's roles, least to most privileged, from the SDK's /me schema.
const ROLES = sdk.zMeResponse.shape.role.options;
type Role = sdk.MeResponse["role"];

const ROLE_NAMES: Record<Role, MessageDescriptor> = {
  viewer: uiRoleViewer,
  editor: uiRoleEditor,
  publisher: uiRolePublisher,
  owner: uiRoleOwner,
};

const useMe = () =>
  useQuery({
    queryKey: ["me"],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => (await call(sdk.me({ client }))) as sdk.MeResponse,
  });

/**
 * Whether the signed-in identity holds at least `role`. Unknown while
 * loading or on error: allowed, so a failed /me never locks the console
 * (the server refuses what the role can't do).
 */
export function useCan(role: Role): boolean {
  const { data } = useMe();
  return !data || ROLES.indexOf(data.role) >= ROLES.indexOf(role);
}

/** The reason a viewer can't stage, shown on every page (Layout). */
export function ViewerNotice() {
  const intl = useIntl();
  const canEdit = useCan("editor");
  if (canEdit) return null;
  return (
    <p data-testid="role-notice" className="mb-4 text-sm text-muted-foreground">
      {intl.formatMessage(uiRoleNeedEditor)}
    </p>
  );
}

/** The reason Publish and Roll back are disabled below publisher. */
export function PublisherReason() {
  const intl = useIntl();
  const { data } = useMe();
  const canPublish = useCan("publisher");
  if (canPublish || !data) return null;
  return (
    <p data-testid="publish-reason" className="text-sm text-muted-foreground">
      {intl.formatMessage(
        data.role === "viewer"
          ? uiRoleViewerNeedPublisher
          : uiRoleEditorNeedPublisher,
      )}
    </p>
  );
}

/** The sidebar footer: who is signed in, how, and their role. */
export function IdentityFooter() {
  const intl = useIntl();
  const { data } = useMe();
  if (!data) return null;
  const who = data.email ?? data.id;
  return (
    <div
      data-testid="identity"
      className="flex items-start gap-3 text-sm text-sidebar-foreground"
      title={intl.formatMessage(uiRoleSignedIn as MessageDescriptor, {
        id: data.id,
      })}
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent font-semibold uppercase"
      >
        {who.slice(0, 1)}
      </span>
      {/* Stacked, so a long identity wraps instead of being cut. */}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="break-all">{who}</span>
        <span className="text-xs text-sidebar-foreground/60">
          {intl.formatMessage(uiRoleSignedInWith)}
        </span>
        <Badge
          variant="secondary"
          className="px-1.5 text-[10px] uppercase tracking-wider"
        >
          {intl.formatMessage(ROLE_NAMES[data.role])}
        </Badge>
      </span>
    </div>
  );
}

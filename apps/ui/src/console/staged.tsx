/**
 * Staged versus live, on every page (ui-guidelines "Shell"): the
 * warning banner while changes are pending, and below 768 px the header's
 * "N to publish" link (the header's console links are hidden there).
 */
import {
  uiStagedBanner,
  uiStagedBannerNoVersion,
  uiStagedReview,
  uiStagedToPublish,
} from "@edgway/i18n/messages";
import { Alert, AlertDescription } from "@edgway/ui-kit/components/ui/alert";
import { buttonVariants } from "@edgway/ui-kit/components/ui/button";
import { TriangleAlert } from "lucide-react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { Link } from "react-router";
import { PUBLISH_PATH } from "./nav";
import { usePendingChanges } from "./pending";

export function StagedBanner() {
  const intl = useIntl();
  const { data } = usePendingChanges();
  const count = data?.changes.length ?? 0;
  if (count === 0) return null;
  return (
    // A standing notice, not an interruption: status, not alert.
    <Alert
      role="status"
      data-testid="staged-banner"
      className="mb-4 border-warning-foreground/30 bg-warning text-warning-foreground"
    >
      <TriangleAlert />
      <AlertDescription className="flex flex-wrap items-center gap-x-3 text-warning-foreground">
        <span>
          {data?.version === undefined
            ? intl.formatMessage(uiStagedBannerNoVersion as MessageDescriptor, {
                count,
              })
            : intl.formatMessage(uiStagedBanner as MessageDescriptor, {
                count,
                version: data.version,
              })}
        </span>
        <Link to={PUBLISH_PATH} className="font-medium underline">
          {intl.formatMessage(uiStagedReview)}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

export function MobilePublishLink() {
  const intl = useIntl();
  const count = usePendingChanges().data?.changes.length ?? 0;
  if (count === 0) return null;
  return (
    <Link
      to={PUBLISH_PATH}
      data-testid="mobile-publish-link"
      className={`${buttonVariants({ variant: "outline", size: "sm" })} md:hidden`}
    >
      {intl.formatMessage(uiStagedToPublish as MessageDescriptor, { count })}
    </Link>
  );
}

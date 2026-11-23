/**
 * The portal's public landing page, Zudoku's own `LandingPage`: what
 * the portal is for, the way to API keys (sign-in required), the public API
 * reference when the site was built with one, and how to get going:
 * three steps and a first request, against the gateway's address when the
 * build had `ZUDOKU_PUBLIC_GATEWAY_URL`.
 */
import {
  portalLandingCurl,
  portalLandingFirstRequest,
  portalLandingGatewayPlaceholder,
  portalLandingIntro,
  portalLandingKeyPlaceholder,
  portalLandingKeys,
  portalLandingReference,
  portalLandingStartTitle,
  portalLandingStepKey,
  portalLandingStepKeyText,
  portalLandingStepRequest,
  portalLandingStepRequestText,
  portalLandingStepSignIn,
  portalLandingStepSignInText,
  portalLandingTitle,
} from "@edgway/i18n/messages";
import type { MessageDescriptor } from "react-intl";
import { LandingPage } from "zudoku/components";
import { intl } from "./intl";
import { PORTAL_PAGES } from "./routes";

export function Landing({
  reference,
  gatewayUrl,
}: {
  reference: boolean;
  gatewayUrl?: string;
}) {
  const curl = intl.formatMessage(portalLandingCurl as MessageDescriptor, {
    key: intl.formatMessage(portalLandingKeyPlaceholder),
    url: gatewayUrl || intl.formatMessage(portalLandingGatewayPlaceholder),
  });
  return (
    <LandingPage
      variant="split"
      title={intl.formatMessage(portalLandingTitle)}
      description={intl.formatMessage(portalLandingIntro)}
      actions={[
        {
          label: intl.formatMessage(portalLandingKeys),
          href: PORTAL_PAGES.keys,
        },
        ...(reference
          ? [
              {
                label: intl.formatMessage(portalLandingReference),
                href: PORTAL_PAGES.reference,
                variant: "outline" as const,
              },
            ]
          : []),
      ]}
      aside={
        <section data-testid="first-request" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">
            {intl.formatMessage(portalLandingFirstRequest)}
          </h2>
          <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-sm">
            {curl}
          </pre>
        </section>
      }
    >
      <section data-testid="get-going" className="mx-auto max-w-5xl px-4 py-8">
        <h2 className="mb-4 text-xl font-semibold">
          {intl.formatMessage(portalLandingStartTitle)}
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            [portalLandingStepSignIn, portalLandingStepSignInText],
            [portalLandingStepKey, portalLandingStepKeyText],
            [portalLandingStepRequest, portalLandingStepRequestText],
          ].map(([title, text]) => (
            <li
              key={title?.id}
              className="rounded-lg border bg-card p-4 text-card-foreground"
            >
              <h3 className="font-medium">
                {intl.formatMessage(title as MessageDescriptor)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {intl.formatMessage(text as MessageDescriptor)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </LandingPage>
  );
}

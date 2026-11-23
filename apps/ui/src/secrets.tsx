/**
 * The upload form's sandbox limits and trust model. The vaults and
 * certificates pages are in `secret-pages.tsx`.
 */
import { SANDBOX } from "@edgway/constants";
import { uiSandboxLimits, uiSandboxTrust } from "@edgway/i18n/messages";
import { Alert, AlertDescription } from "@edgway/ui-kit/components/ui/alert";
import { Info } from "lucide-react";
import { type MessageDescriptor, useIntl } from "react-intl";

/** Above the upload form: the sandbox's defaults, limits and trust model. */
export function SandboxLimits() {
  const intl = useIntl();
  return (
    <Alert
      className="mb-4 border-primary/20 bg-primary/5"
      data-testid="sandbox-limits"
    >
      <Info />
      <AlertDescription className="flex flex-col gap-1">
        <span>{intl.formatMessage(uiSandboxTrust)}</span>
        <span>
          {intl.formatMessage(uiSandboxLimits as MessageDescriptor, {
            cpu: SANDBOX.cpuMs,
            sub: SANDBOX.subRequests,
            maxCpu: SANDBOX.maxCpuMs,
            maxSub: SANDBOX.maxSubRequests,
            maxKb: SANDBOX.maxCodeBytes / 1024,
          })}
        </span>
      </AlertDescription>
    </Alert>
  );
}

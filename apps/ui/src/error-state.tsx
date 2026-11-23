/**
 * A page whose data failed to load: the admin's problem (its EDG
 * code, title and detail), a link to the code's docs page and a retry,
 * instead of an endless spinner.
 */
import { errorDocsUrl } from "@edgway/errors/docs";
import {
  uiErrorDocs,
  uiErrorRetry,
  uiErrorStatus,
  uiErrorTitle,
} from "@edgway/i18n/messages";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@edgway/ui-kit/components/ui/alert";
import { Button } from "@edgway/ui-kit/components/ui/button";
import { type MessageDescriptor, useIntl } from "react-intl";

interface Problem {
  code?: string;
  title?: string;
  detail?: string;
}

/** The admin's problem+json body, as `call()` carries it on its HttpError. */
export function problemOf(error: unknown): Problem & { status?: number } {
  const e = error as { status?: number; body?: unknown; message?: string };
  const body = (e?.body ?? {}) as Problem;
  return {
    status: e?.status,
    code: body.code,
    title: body.title ?? e?.message,
    detail: body.detail,
  };
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const intl = useIntl();
  const problem = problemOf(error);
  return (
    <div className="py-4">
      <Alert variant="destructive" data-testid="error-state">
        <AlertTitle>{intl.formatMessage(uiErrorTitle)}</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>
            {problem.code ? (
              <code className="mr-2 font-mono">{problem.code}</code>
            ) : null}
            {problem.title}
          </span>
          {problem.detail ? <span>{problem.detail}</span> : null}
          {!problem.code && problem.status ? (
            <span>
              {intl.formatMessage(uiErrorStatus as MessageDescriptor, {
                status: problem.status,
              })}
            </span>
          ) : null}
          <span className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={onRetry}>
              {intl.formatMessage(uiErrorRetry)}
            </Button>
            {problem.code ? (
              <a
                className="underline underline-offset-4"
                href={errorDocsUrl(problem.code)}
                target="_blank"
                rel="noreferrer"
              >
                {intl.formatMessage(uiErrorDocs as MessageDescriptor, {
                  code: problem.code,
                })}
              </a>
            ) : null}
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
}

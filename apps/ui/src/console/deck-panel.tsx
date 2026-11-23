/**
 * The decK preview (ui-guidelines "decK preview"): YAML in a dark panel with
 * Copy, beside the entity forms and the plugin form.
 */
import { uiFormCopy, uiFormPreview } from "@edgway/i18n/messages";
import { Button } from "@edgway/ui-kit/components/ui/button";
import { useIntl } from "react-intl";

export function DeckPanel({ yaml, testId }: { yaml: string; testId?: string }) {
  const intl = useIntl();
  return (
    <section
      className="flex flex-col overflow-hidden rounded-xl bg-sidebar text-sidebar-foreground"
      data-testid={testId}
    >
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          {intl.formatMessage(uiFormPreview)}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={() => void navigator.clipboard.writeText(yaml)}
        >
          {intl.formatMessage(uiFormCopy)}
        </Button>
      </div>
      <pre className="overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs">
        {yaml}
      </pre>
    </section>
  );
}

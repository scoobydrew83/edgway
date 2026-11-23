/**
 * Above the API key list (Zudoku's `api-keys-list-page-before-keys` slot,
 * Drew): a key is shown once, and rotating replaces only that key;
 * and why the key API refused, when it did.
 */
import { portalKeysHelp } from "@edgway/i18n/messages";
import { Callout } from "zudoku/components";
import { intl } from "./intl";
import { useRefusal } from "./refusal";

export function KeyHelp() {
  const refusal = useRefusal();
  return (
    <div className="mt-4 flex flex-col gap-2" data-testid="key-help">
      {refusal ? (
        <Callout type="danger">
          <span data-testid="key-refusal">{refusal}</span>
        </Callout>
      ) : null}
      <Callout type="info">{intl.formatMessage(portalKeysHelp)}</Callout>
    </div>
  );
}

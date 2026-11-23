import { defineMessage } from "@formatjs/intl";

export const errorsHello = defineMessage({
  id: "errors.hello",
  defaultMessage: "Hello {name}",
  description: "Greeting shown to a named user.",
});

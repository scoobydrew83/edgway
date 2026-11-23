import { errorsHello, t } from "@edgway/i18n";

export const Page = () => <h1>{t(errorsHello, { name: "x" })}</h1>;

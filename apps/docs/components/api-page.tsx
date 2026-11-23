import type { OpenAPIPageProps_Spec } from "fumadocs-openapi/ui";
import { openapi } from "../lib/openapi";
import { ClientPage } from "./api-page.client";

type Props = Omit<OpenAPIPageProps_Spec, "payload"> & { document: string };

/** The generated pages' `<OpenAPIPage>`: loads the document at build time. */
export async function OpenAPIPage({ document, ...props }: Props) {
  const { bundled } = await openapi.getSchema(document);
  return <ClientPage {...props} payload={{ bundled }} />;
}

import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { OpenAPIPage } from "./api-page";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    OpenAPIPage,
    ...components,
  } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

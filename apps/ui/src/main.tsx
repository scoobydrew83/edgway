import { baseLocale, catalogs } from "@edgway/i18n/catalogs";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "react-intl";
import { App } from "./app";
// IBM Plex, self-hosted (no font CDN): the weights ui-guidelines.md uses.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <IntlProvider
        locale={baseLocale}
        defaultLocale={baseLocale}
        messages={catalogs[baseLocale]}
      >
        <App />
      </IntlProvider>
    </StrictMode>,
  );
}

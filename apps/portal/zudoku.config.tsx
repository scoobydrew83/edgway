/**
 * The developer portal (PRD "Developer portal"): Zudoku, themed with
 * Edgway's tokens, with OIDC sign-in and self-serve API keys through the
 * portal Worker. Values come from the environment at build time:
 *   ZUDOKU_PUBLIC_OIDC_ISSUER, ZUDOKU_PUBLIC_OIDC_CLIENT_ID — the IdP;
 *   ZUDOKU_PUBLIC_PORTAL_OPENAPI — an OpenAPI document for the public API
 *   reference (see README.md);
 *   ZUDOKU_PUBLIC_GATEWAY_URL — the gateway's address, for the landing
 *   page's first request.
 * `/` is a public landing page; only the key settings need a sign-in.
 */
// IBM Plex, self-hosted (no font CDN): the weights ui-guidelines.md uses.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@edgway/tokens/theme.css";
import type { ZudokuConfig } from "zudoku";
import { apiKeyService } from "./src/api-key-service";
import { KeyHelp } from "./src/key-help";
import { Landing } from "./src/landing";
import { PORTAL_PAGES } from "./src/routes";
import { UsagePanel } from "./src/usage-panel";

// ZUDOKU_PUBLIC_*, so the page's runtime config sees it too: with another
// name the build made reference pages the prerender then didn't find.
const openapi = process.env.ZUDOKU_PUBLIC_PORTAL_OPENAPI;
const issuer = process.env.ZUDOKU_PUBLIC_OIDC_ISSUER ?? "";
// The gateway's address, for the landing page's first request.
const gatewayUrl = process.env.ZUDOKU_PUBLIC_GATEWAY_URL;

// The guidelines' faces; no serif is used, so serif is Sans too.
const SANS = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace";

const config: ZudokuConfig = {
  site: { title: "Edgway" },
  // Without these Zudoku uses Geist, and imports it, Playfair Display and
  // Geist Mono from Google Fonts. Each url is the local @fontsource file
  // (Vite resolves it), so nothing comes from a CDN.
  theme: {
    fonts: {
      sans: { url: "@fontsource/ibm-plex-sans/400.css", fontFamily: SANS },
      serif: { url: "@fontsource/ibm-plex-sans/400.css", fontFamily: SANS },
      mono: { url: "@fontsource/ibm-plex-mono/400.css", fontFamily: MONO },
    },
  },
  authentication: {
    type: "openid",
    issuer,
    clientId: process.env.ZUDOKU_PUBLIC_OIDC_CLIENT_ID ?? "",
    scopes: ["openid", "profile", "email"],
    // Plain HTTP only for a local issuer (tests, `wrangler dev`).
    allowInsecureRequests:
      new URL(issuer || "https://x").hostname === "localhost",
  },
  apiKeys: { enabled: true, ...apiKeyService },
  ...(openapi
    ? {
        apis: [{ type: "file", input: openapi, path: PORTAL_PAGES.reference }],
      }
    : {}),
  navigation: [
    {
      type: "custom-page",
      path: PORTAL_PAGES.home,
      element: <Landing reference={Boolean(openapi)} gatewayUrl={gatewayUrl} />,
    },
  ],
  slots: {
    "api-keys-list-page-before-keys": (
      <>
        <KeyHelp />
        <UsagePanel />
      </>
    ),
  },
  protectedRoutes: [PORTAL_PAGES.protected],
};

export default config;

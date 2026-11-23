# Design fidelity review, 2026-10-11

Steps 20 to 23 built every feature in the UI plan, and their tests pass, but most screens don't look like the design. The checks were functional: they asserted that banners, counts and endpoints exist, and nothing compared a page with its mockup. This file lists, screen by screen, what must change.

- **Target:** `docs/design/mockups/<Board>.png`. These are rendered from the design canvas at their real size. They are the layout to match.
- **Current:** `docs/design/current-2026-10-11/*.png`. The admin from `main` at `77005be`, with seeded data, at 1440 px wide.
- **Rules:** `docs/design/ui-guidelines.md`. Where a mockup and the guidelines disagree, the guidelines win: tokens, the input-border color, and vocabulary.

## How to read the mockups
- **Values in `[brackets]` are placeholders**, not data or copy.
- **The sidebar to match is the `Sidebar` component**, seen on the Audit, Service, RouteForm, Upstream, Certificates, Vaults, Sandbox and PublishLarge boards. The other boards still draw an older copy, so ignore their sidebars, including their "Targets" item.
- **Content to match:**
  - layout: what sits where, card structure, column split;
  - hierarchy: title, then summary, then detail;
  - which fields are shown at all;
  - control types: radio cards, checkboxes, chips, sliders, a dark code panel.
- **No need to match:** exact pixel spacing or mockup data.
- **Build from `@edgway/ui-kit` components and `@edgway/tokens`.** Don't copy the mockups' inline styles.

## Problems on every page
1. **Form button bars overlap the fields.** The save toolbar of create and edit forms is drawn on top of the fields below it (`04-route-create`, `13-upload`). Fix it once, in the shared form layout.
2. **Generic "show every field" pages for the main entities.** Every column is listed, empty ones included ("Hash on header", "Tls verify", "Custom"), with machine-made labels ("Jwt secrets", "Acls", "Cpu ms"). The service, upstream, consumer and route pages need their own layouts, which hide empty values and use `@edgway/i18n` labels.
3. **Plural titles.** "Services httpbin", "Upstreams httpbin-pool", "Create Routes", "Create Uploaded plugins". Use the singular, or the entity's own name ("httpbin", "Create route").
4. **Array values run together.** Methods show as "GETPOST". Show arrays as badges or chips.
5. **Shell:**
   - Every sidebar item has the same list icon. Give each item its own lucide icon, or none.
   - "Targets" is a top-level sidebar item. Targets belong on their upstream's page.
   - The top bar repeats the Console links (Overview, Plugin catalog, Publish, Route tester, Audit log) that are already in the sidebar. Keep search, theme, refresh and the below-768 px "N to publish" link.
   - The sidebar is a floating card that ends before the page does. Make it full height, with the identity footer pinned to the bottom (Sidebar board).
6. **List filters.** The raw "Tags (comma: all, slash: any)" field is the only filter. Lists get a search box first, with tags as a secondary filter (Routes board).

## Screen by screen

| Screen | Mockup | Current | What to change |
| --- | --- | --- | --- |
| Overview | `Main.png`, `OverviewDark.png` | `01-overview.png` | Close already. Check the figures row (live config, requests, p50, p99) and the chart card once analytics data is present. Busiest routes and consumers go side by side. |
| Publish | `Publish.png`, `PublishLarge.png` | `02-publish.png` | Summary first: the change list grouped by entity, with counts, in a card. The publish action is a side card (note, warnings, "Publish version N"). The full-snapshot JSON diff is collapsed by default and shows only the changed entities' diff when opened. History is a card with "Roll back" buttons. |
| Route tester | `Tester.png` | `14-tester.png` | Status as a badge ("401"), plus the "Matched route" line (a later change adds the header). Trace rows show plugin, phase, a decision badge and a bar placed at its start offset, so the bars form a waterfall instead of one full-width block. Response headers and body sit side by side. |
| Routes list | `Routes.png` | `03-routes.png` | Search box and filter chips (service, method). Methods as badges. A Plugins column. "Create route" as the primary button. |
| Create route | `RouteForm.png` | `04-route-create.png` | Fix the toolbar overlap. Basics (name, service) in a card. "What it matches" in a card, with paths as removable chips with field errors, methods as checkboxes, and hosts. Headers, SNIs, destinations, expression, protocols, strip path and preserve host go under a closed "Advanced". The decK preview is a dark panel in a right-hand column, beside the whole form, not squeezed beside Basics. The button says "Stage route". |
| Service | `Service.png` | `05-service.png` | Header: the name (mono) and URL, with "Add route" and "Edit service". "How requests reach it" (routes, then service, then upstream) at the top, not the bottom. "Which plugins run" as a table: #, plugin, a scope badge, effect, and replaced instances struck through. No field-by-field list. Settings such as timeouts and retries go in a small summary. |
| Upstream | `Upstream.png` | `06-upstream.png` | Header with name, "Used by service …" and Edit. The fallback warning near the top. A settings summary (algorithm, slots, host header, client certificate) instead of every hash field. A targets table with a weight-share bar and an inline "Stage target" row. Health-check settings in readable words, never `{}`. |
| Consumer | `Consumer.png` | `07-consumer.png` | Header with avatar, name and badges (portal developer, portal access). Details as a compact list without empty values. API keys, basic auth, JWT and ACL groups as cards in a 2-column grid, with ACL groups as removable chips. "Plugins on this consumer" as a card. |
| Plugin catalog | `Catalog.png` | `08-catalog.png` | Close already. "In use" plugins say "Configure"; the others have a primary "Add". |
| Add plugin | `PluginForm.png` | `09-plugin-form.png` | "Where it applies" as radio cards with hints, and the target picker under them. Fields grouped by purpose, with the common ones first: for rate-limiting, the limits, count-by and counter store. Everything else (Redis, error code and message, path, sync rate) goes under a closed "Advanced". The decK preview is a dark panel. A "What callers see" note where the plugin has one. The button says "Stage plugin", and the line beside it says it goes live on publish. |
| Audit log | `Audit.png` | `10-audit.png` | Show entity names, not ids ("route public-ip", "plugin rate-limiting on route httpbin-anything"). Filters for who, action and entity. Rows expand inline to the diff and request id. Entity types are singular and lower case. |
| Certificates | `Certificates.png` | `11-certificates.png` | Not compared: no certificate was seeded. Seed one valid and one expiring and compare: the expiry banner, subject and issuer, an expiry badge, and the add form with a vault reference only. |
| Vaults | `Vaults.png` | `12-vaults.png` | Built-in vaults as two cards with their reference pattern. "Make a reference" as a card with a dark output and Copy. "Secrets kept as plain text" as a warning card. "Your vault entities" as its own card, not a second page title with Export. |
| Upload a plugin | `Sandbox.png` | `13-upload.png` | Fix the toolbar overlap. The trust note as an info banner at the top. A code drop zone and file summary instead of a bare editor. Name, version and priority in one row. CPU and subrequests as range inputs showing the default and the maximum (`SANDBOX`). Bindings as checkboxes. The button says "Stage plugin". |
| States | `States.png` | (not captured) | Confirm the error, empty, loading, read-only, dialog and below-768 px states match this sheet when the screenshot script captures them. |
| Portal | `Portal.png`, `PortalKeys.png`, `PortalStates.png` | (not captured) | The portal needs its build variables to render. It's out of these steps, and checked separately. |

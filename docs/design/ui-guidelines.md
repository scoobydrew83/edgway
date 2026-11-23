# UI guidelines: admin console and developer portal

These are the rules for the admin UI (`apps/ui`) and the developer portal (`apps/portal`). They come from the 2026-10-10 design review and its mockups, exported to `docs/design/mockups/`.

**The mockups are the target layout; the code comes from the kit.** Match each mockup's layout, hierarchy, the fields it shows and its control types. Mockup images are in `docs/design/mockups/`, and `docs/design/fidelity-review.md` maps each screen to its mockup. Build every screen from `@edgway/ui-kit` (shadcn) components, with colors from `@edgway/tokens` and strings from `@edgway/i18n`, as `CLAUDE.md` §2 requires. Never copy a mockup's inline styles or hex values. Values in `[brackets]` on the canvas are placeholders, not data.

**Generic pages aren't the design.** ra-core's default show page (every column listed, empty ones included) and its default form (every field in schema order) aren't acceptable for services, routes, upstreams, consumers, plugins, uploaded plugins or certificates. Those screens get their own layouts.

**Screens are checked by eye, against the mockup.** A UI task runs `pnpm --filter @edgway/ui screens`. Its verifier opens each changed screen's PNG beside its mockup and fails the task on any difference that `fidelity-review.md` lists for that screen and that is still there, or on a new layout break (overlap, clipped text, horizontal scroll).

## Principles
1. **Staged versus live is always visible.** A change does nothing until it's published, so every page says when staged changes exist, and every save button says "Stage …".
2. **Say what happens next.** Confirmations name the consequence, such as "The gateways serve the new version within about a second" or "Plugins set on this route are deleted with it". Errors name the fix.
3. **Role-aware, server-enforced.** Actions above the signed-in role are disabled, with a line saying who can do them. The server's 403 stays the authority.
4. **Kong's names, verbatim.** Entity names, fields, paths, plugin names, ids and keys are shown as they are, in the mono face.
5. **Status is never color alone.** Every colored badge or dot also carries a word.

## Color tokens
These replace shadcn's neutral values in `packages/tokens/src/theme.css`. The hex values were checked with colorjs.io (WCAG 2.1); the oklch values are what goes in the file.

| Token | Light | Light oklch | Dark | Dark oklch |
| --- | --- | --- | --- | --- |
| `--background` | `#F6F6F3` | `oklch(0.972 0.004 106.5)` | `#0F1114` | `oklch(0.177 0.007 258.4)` |
| `--foreground` | `#16181D` | `oklch(0.209 0.010 268.2)` | `#E8E8E4` | `oklch(0.930 0.005 106.5)` |
| `--card`, `--popover` | `#FFFFFF` | `oklch(1 0 0)` | `#171A1F` | `oklch(0.217 0.011 260.7)` |
| `--primary`, `--ring` | `#2346D6` | `oklch(0.474 0.222 266.3)` | `#7C9CFF` | `oklch(0.712 0.149 268.9)` |
| `--primary-foreground` | `#FFFFFF` | `oklch(1 0 0)` | `#0F1114` | `oklch(0.177 0.007 258.4)` |
| `--muted`, `--secondary`, `--accent` | `#EDEDE8` | `oklch(0.945 0.007 106.5)` | `#22262D` | `oklch(0.268 0.014 261.7)` |
| `--muted-foreground` | `#5B606B` | `oklch(0.489 0.019 266.1)` | `#9BA0AA` | `oklch(0.705 0.016 264.5)` |
| `--border` | `#E3E3DE` | `oklch(0.914 0.007 106.5)` | `#2A2E36` | `oklch(0.301 0.016 264.3)` |
| `--input` | `#85857F` | `oklch(0.615 0.009 106.7)` | `#6B7079` | `oklch(0.544 0.015 262.3)` |
| `--destructive` | `#B42318` | `oklch(0.500 0.182 29.5)` | `#FF8A7A` | `oklch(0.758 0.145 29.0)` |
| `--warning` (new) | `#FFF4DE` | `oklch(0.970 0.031 84.6)` | `#2B2110` | `oklch(0.255 0.032 79.8)` |
| `--warning-foreground` (new) | `#6B3D00` | `oklch(0.407 0.092 64.4)` | `#F5C979` | `oklch(0.858 0.110 81.4)` |
| `--success` (new) | `#DDF3E6` | `oklch(0.944 0.029 159.9)` | `#0F2A1D` | `oklch(0.259 0.042 160.5)` |
| `--success-foreground` (new) | `#0B5C37` | `oklch(0.420 0.095 156.8)` | `#7BD3A0` | `oklch(0.798 0.113 157.2)` |
| `--sidebar` | `#16181D` | `oklch(0.209 0.010 268.2)` | `#0A0B0D` | `oklch(0.149 0.005 264.5)` |
| `--sidebar-foreground` | `#E8E8E4` | `oklch(0.930 0.005 106.5)` | `#E8E8E4` | `oklch(0.930 0.005 106.5)` |
| `--sidebar-accent` | `#2A2E36` | `oklch(0.301 0.016 264.3)` | `#1F232A` | `oklch(0.255 0.014 261.7)` |
| `--sidebar-primary`, `--sidebar-ring` | `#7C9CFF` | `oklch(0.712 0.149 268.9)` | `#7C9CFF` | `oklch(0.712 0.149 268.9)` |
| `--chart-1` (requests) | `#2346D6` | `oklch(0.474 0.222 266.3)` | `#7C9CFF` | `oklch(0.712 0.149 268.9)` |
| `--chart-2` (errors) | `#D9480F` | `oklch(0.600 0.190 37.9)` | `#FF8A4C` | `oklch(0.751 0.161 46.8)` |
| `--chart-3` (latency) | `#5B606B` | `oklch(0.489 0.019 266.1)` | `#9BA0AA` | `oklch(0.705 0.016 264.5)` |
| `--chart-4` | `#0F766E` | `oklch(0.511 0.086 186.4)` | `#2DD4BF` | `oklch(0.785 0.133 181.9)` |
| `--chart-5` | `#7C3AED` | `oklch(0.541 0.247 293.0)` | `#B79CFF` | `oklch(0.755 0.141 295.4)` |

- **Unlisted tokens** (`--sidebar-accent-foreground`, `--sidebar-primary-foreground`, `--sidebar-border`) follow their pairs: foreground on accent, `--background` on primary, and `--sidebar-accent` for the border.
- **Checked contrasts:**
  - Text is at least 4.5:1 on its background in both themes. The lowest pair is muted text on the light card, at 6.31.
  - Control borders and the focus ring are at least 3:1: light input 3.71, dark input 3.50.
  - Chart lines are at least 3:1 on the card: light chart-2 is the lowest, at 4.30.
- **The mockups' input border** (`#A8A8A2`) fails 3:1, so it is darkened here to `#85857F`.
- **Color order in charts:** requests are chart-1, server errors chart-2, latency chart-3 drawn dashed. That way the series differ by lightness and dash as well as hue.

## Type
- **Faces:** IBM Plex Sans (400, 500, 600) for UI text and IBM Plex Mono (400, 500) for identifiers, code and numbers in tables. They are self-hosted through `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` (OFL-1.1; Drew, 2026-10-10). Load no web fonts from a CDN.
- **Scale:** page title 28/600 (portal hero 52/600), section title 16/600, body 14/400, help and meta 13, captions and table headers 12. Table headers are uppercase, with 0.05em letter spacing, in muted text.
- **Mono** is for entity names, paths, hosts, methods, plugin names, ids, key prefixes, versions, durations, counts in tables, and decK or JSON. Prose stays in Sans.

## Space, shape and size
- **Spacing:** a 4 px base. Page padding is 28 px top and 40 px sides (16 px on phones). Card padding is 18–22 px. Gaps are 16–24 px between cards and 8–12 px inside groups.
- **Radius:** cards 12 px, controls 8 px, badges 10 px, removable chips 16 px.
- **Target sizes:** primary controls and form fields 44 px high. Row and table actions at least 36 px. Nothing under 24 px (WCAG 2.2 AA, 2.5.8).
- **Layout:**
  - A dark sidebar 240 px wide, then fluid content.
  - Below 768 px the sidebar becomes a drawer, and the header keeps a "N to publish" link.
  - Wide tables scroll inside their own box; the page itself never scrolls sideways.

## Shell
- **Sidebar sections, in order:**
  - Console: Overview, Plugin catalog, Publish (with the unpublished count), Route tester, Audit log.
  - Gateway: Services, Routes, Upstreams, Plugins, Uploaded plugins.
  - Consumers: Consumers, Consumer groups, JWT credentials, ACL groups.
  - Certificates and vaults: Certificates, CA certificates, SNIs, Vaults.
- **Targets** live on their upstream's page.
- **Sidebar footer:** the signed-in identity and a role badge (viewer, editor, publisher, owner). It comes from `GET /me`.
- **Staged-changes banner:** shown on every page while changes are pending. It reads "N unpublished changes. The gateways still serve version V.", in the warning colors, with a "Review and publish" link.
- **⌘K palette:** stays (`palette.tsx`).

## Components
Use the ui-kit component named in each item. Don't hand-roll one.

- **Badges** (`Badge`), each a word plus a color:
  - added = success;
  - changed and staged = warning;
  - removed = destructive;
  - live, in use and enabled = success;
  - publish = primary tint;
  - rollback = chart-5 tint;
  - plugin scope = global muted, service primary tint, route warning, consumer chart-5 tint.
- **Banners** (`Alert`):
  - info: the tester's "published version only" note, and sandbox trust;
  - warning: staged changes, publish warnings, the algorithm fallback;
  - destructive: certificate expiry, a publish conflict.

  Each has an icon (decorative, `aria-hidden`), one sentence, and at most one action.
- **Tables** (`Table`): the header row is in the table-header style, cells for identifiers are mono, and numbers are right-aligned. A table wider than its card scrolls inside the card. Lists page with Kong's cursor: "Previous" and "Next page", with no totals.
- **Forms:**
  - The label sits above the field, help text below it, and a field error below that, in destructive, with an icon and `aria-describedby`.
  - Group fields in fieldsets by purpose ("Basics", "What it matches", "Limits") and fold rare fields under "Advanced".
  - The submit button says "Stage …". A line beside it says the change goes live on publish.
  - Plugin forms stay on RJSF with Kong's schema.
- **decK preview:** a dark code panel beside create and edit forms, built with `toDeck` (`apps/ui/src/console/deck.ts`), with a Copy button.
- **Scope picker:** four radio cards (Global, Service, Route, Consumer), each with a short hint. The target picker appears only when the scope needs one.
- **Dialogs** (`Confirm` and `Dialog`):
  - The title is the question ("Publish 3 changes?", "Make version 39 live again?", "Delete route public-ip?").
  - The body names the consequence.
  - The confirm button names the action ("Publish", "Roll back to 39", "Delete route") and is destructive-colored when it removes or reverts.
  - A rollback that revives credentials lists them in a warning box (`ui.config.rollbackRevived`).
- **Key shown once:** a dialog titled "Your new API key", with "Copy this key now: it is not shown again.", the key in a dark mono box, a Copy button, and "I've saved it" (existing `ui.keyAuth.*` messages).
- **States:**
  - Error: the `ErrorState` (code, message, docs link, "Try again").
  - Loading: a skeleton shaped like the content, not a spinner, for lists.
  - Empty: what the thing is, one primary action, and the decK alternative (`edgway import-deck`).
  - First run: a four-step checklist (service, route, plugin, publish and test).
  - Analytics not configured: `ui.overview.empty`.
- **Charts** (Recharts through shadcn's chart wrapper): colors as above, a legend, and the table behind a "Show as a table" disclosure for screen readers.

## Patterns
- **Staged changes:**
  - a sidebar count;
  - the page banner;
  - a "staged" badge on list rows (not yet scheduled: it needs pending changes mapped to entity ids);
  - a "Only staged changes" filter on lists;
  - publish groups changes by entity with removals first, and says that publishing takes every staged change, and whose.
- **Roles:** viewers read; editors also stage; publishers also publish and roll back; owners do everything. A disabled action has a visible reason, for example "You're a viewer: you can see changes and history. A publisher or owner can publish."
- **Which plugins run:** where a plugin is set at several levels, show the winner and strike through the ones it replaces. The answer comes from `@edgway/core`'s `selectPlugins`, the gateway's own precedence code (consumer, consumer group, route, service, and their combinations), never a copy.
- **Health:** show health-check settings, never a live health state. Passive health is per gateway isolate and isn't stored centrally (Drew, 2026-10-10).
- **Secrets:**
  - A field that holds a secret takes a `{vault://…}` reference. Certificate keys take only a reference (`certificates.key`).
  - Show how to build a reference (`env` or `cf-secrets-store`, names starting `VAULT_`).
  - List the plain-text secrets publish warns about.

## Vocabulary
- **Rotate** a key: a new value replaces the old one (Drew, 2026-10-10). This applies to the admin and the portal. The portal's own copy (`portal.keys.help`) says "rotate". Zudoku's built-in "Roll key" button is renamed if Zudoku allows it; otherwise it's recorded as a known exception.
- **Roll back** a version. **Stage** a change. **Publish** staged changes. **Live** is the published version.
- Say **Server errors**, not "errors" (5xx only), and **Uploaded plugins**, not "sandbox plugins".
- Sentence case everywhere. Every string is an `@edgway/i18n` message. Reuse an existing message before adding one.

## Accessibility
- Use real `<button>`, `<a href>` and `<label>` elements. Mark the current page with `aria-current="page"`. Radio cards use `role="radiogroup"` and `aria-checked`.
- Give icon-only buttons an `aria-label`. Mark decorative SVGs `aria-hidden`, and give charts `role="img"` with a label.
- The focus ring uses `--ring` and is never removed.
- The contrast test (`packages/tokens/test/contrast.test.ts`) covers every foreground and background pair in the table above, in both themes.

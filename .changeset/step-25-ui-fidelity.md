---
"@edgway/i18n": minor
"@edgway/sdk": minor
---

`pnpm --filter @edgway/ui screens` seeds the e2e stack and writes a full-page screenshot of each admin screen to `apps/ui/screens/`, with an index naming each one's mockup, for the design check. `test:e2e` doesn't run it.

The admin UI's shell follows the design: a full-height sidebar with "Jump to…", no icons and no Targets item, and the signed-in identity pinned to the bottom; the top bar no longer repeats the console pages. Form toolbars sit under their fields instead of over them. Titles are singular or the entity's own name ("Create route", "Upload a plugin", "httpbin"), arrays show as badges, and every field label comes from `@edgway/i18n`. Lists have a search box first (it filters the page shown), with tags behind "Add filter", Previous and Next page, and "Create …" as the primary action. The routes list adds service and method filters and a Plugins column. The route form puts Basics and "What it matches" in cards, with paths as chips, methods as checkboxes and the rest under a closed Advanced, beside a dark decK preview; the upload form takes its code from a file, with name, version and priority in a row and the limits as sliders.

The service, upstream and consumer pages have their own layouts. A service shows its URL, "How requests reach it" (its routes, the service, then its upstream's targets or the host it calls directly) and "Which plugins run" as a table with each plugin's scope and effect, replaced ones struck through. An upstream shows the services using it, the algorithm note, its settings in brief, its targets with share bars and an inline "Stage target", and its health checks in words. A consumer shows its portal badges, Block or Unblock portal access, the details that are set, and its API keys, basic auth, JWT credentials, ACL groups (as removable chips) and plugins as cards. The native API's consumer reads add a read-only `portal: { developer, blocked }` (never the OIDC subject); the Kong-compatible API doesn't.

The service form follows the route form's pattern: Basics, "Where it sends requests" (protocol, host, port, path), the rest under a closed Advanced, beside the decK preview.

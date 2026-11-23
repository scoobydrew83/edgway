# @edgway/ui

Edgway's admin UI: React on Vite with [ra-core](https://marmelab.com/react-admin/) and [shadcn-admin-kit](https://marmelab.com/shadcn-admin-kit/) components (`@edgway/ui-kit`), over the generated `@edgway/sdk`. The admin Worker serves it under `/ui/`. The Kong-compatible API keeps `/` and the native API keeps `/api/v1`.

- **Data:** `src/data-provider.ts` maps ra-core's DataProvider onto the SDK's operations. Lists page with Kong's cursor and report `pageInfo` (there are no totals). Credentials live under their consumer.
- **Pages:** every entity has a list, a detail and an edit page (`src/resources.tsx`), laid out like Kong Manager, with related entities as tables on the detail page. Form inputs come from the SDK's zod body schemas.
- **⌘K palette:** `src/palette.tsx` jumps to a list or starts a create.
- **Themes:** light and dark come from the kit's theme toggle, with colors from `@edgway/tokens`.
- **Messages:** every string is a `ui.*` message in `@edgway/i18n`, rendered with react-intl from `@edgway/i18n/catalogs`.

```sh
pnpm --filter @edgway/ui build      # dist/ui (the admin's wrangler.jsonc also runs this before deploy/dev)
pnpm --filter @edgway/ui test:e2e   # Playwright against the real admin Worker (Access stubbed)
pnpm --filter @edgway/ui screens    # seeded screenshots of each screen, in screens/ (not committed)
```

`screens` seeds a small config through the native API (an upstream with two targets, a service, three routes, a consumer with a key, a group, key-auth and rate-limiting, a certificate expiring in 9 days, a publish and two staged changes) and writes a full-page PNG per screen at 1440 px, plus the overview and route form at 390 px. `screens/index.md` names each one's mockup in `docs/design/mockups/`, for the design check in `docs/design/fidelity-review.md`.

Signing in goes through Cloudflare Access on the admin's hostname, which also protects `/api/v1`.

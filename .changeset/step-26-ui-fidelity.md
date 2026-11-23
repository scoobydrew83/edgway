---
"@edgway/i18n": minor
"@edgway/sdk": minor
---

The plugin form follows the design: "Where it applies" as radio cards with hints and the target picker under them; each catalog plugin's common fields first, grouped and labelled (for rate-limiting: the limits, count-by and counter store), with everything else under a closed "Advanced"; the dark decK preview; a "What callers see" note naming the status and error code a refused caller gets; and "Stage plugin" with the line that it goes live on publish.

The publish page puts the staged changes first, grouped by entity in a card ("Staged against version N", JSON or decK YAML), beside a card with the note, the warnings publishing now would give, and "Publish version N". The side-by-side diff is folded until opened and shows only the changed entities; history is a card with "Roll back".

The audit log names each event's entity ("route public-ip", "plugin rate-limiting on route httpbin-anything"): `GET /audit-events` adds `entity_name` and, for plugins, `scope`. It filters by who, action and entity, shows each action as a badge, and expands a row to its diff as removed and added lines, its request id and a link to the entity. The route tester shows the status as a badge with the matched route by name, the plugins' timings as a waterfall, and the response headers and body side by side.

The vaults page shows the two built-in vaults as cards with their reference forms, a "Make a reference" card with a dark output and Copy, the vault entities in their own card, and the plugin secrets kept as plain text in a warning card with "Edit plugin". The certificates page shows the expiry banner, each certificate's subject and issuer, SNIs, key type and an expiry badge, with Replace or View, and an add form that reads the pasted PEM and takes the private key as a vault reference only.

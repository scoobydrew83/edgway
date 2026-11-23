---
"@edgway/i18n": minor
"@edgway/constants": minor
"@edgway/sdk": minor
---

Each pending change (`GET /config/pending`) names who staged it (its entity's latest audit event) and carries the entity's name and route paths. The publish page groups changes by entity with added, changed and removed counts, puts removals first, searches names, paths and ids, and says that publishing takes every staged change, and whose.

`GET /config/pending?warnings=true` adds what publishing now would warn about. The admin UI's certificate form takes private keys as vault references only, and says why; the certificate list reads each certificate's subject and expiry, flagging any expired or expiring within 14 days (`CERTIFICATES.expiryWarningDays`); the vaults page explains `env` and `cf-secrets-store`, builds a reference, and lists plain-text plugin secrets; the upload form shows the sandbox's limits and trust model and refuses limits above them.

The developer portal gives an unverified email its own 403 detail (`portal_email_unverified`, separate from `portal_not_allowed`), and shows each refusal (blocked, not allowed, unverified, the key limit) as a message saying what happened and what to do, never naming the allowed domains.

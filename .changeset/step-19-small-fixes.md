---
---

The Kong-compatible schema validation builds its `fields` answer from objects without a prototype, so a violation under a key such as `__proto__` can never reach `Object.prototype`.

The native admin API's credential, consumer-group membership, publish and rollback bodies refuse unknown fields with a 400 (`EDG-ADM-004`) naming them, as entity bodies do.

The admin overview reads only the newest published version (admin-core `config.latest()`), not every version.

Docs: plugin READMEs and two error pages no longer carry internal build-loop tags.

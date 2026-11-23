# @edgway/plugin-acl

Kong's [acl](https://developer.konghq.com/plugins/acl/) plugin (priority 950) for Edgway. It allows or denies the authenticated consumer by its groups. It can also be used as plain Hono middleware after an auth plugin:

```ts
import acl, { setAclStore } from "@edgway/plugin-acl";

app.use((c, next) => (setAclStore(c, store), next()));
app.use(keyAuth.middleware({}));
app.use(acl.middleware({ allow: ["admins"] }));
```

The gateway supplies an `AclStore`. It holds the consumer's groups (Kong's `acls` entity) and, optionally, the names of the consumer's consumer groups.

## Supported config

- `allow`, `deny`: set one of the two, as in Kong.
- `hide_groups_header`: otherwise upstream gets `X-Consumer-Groups: a, b`, or `X-Authenticated-Groups` when authenticated groups decided. A client-sent `X-Consumer-Groups` is always removed.
- `include_consumer_groups`: the names of the consumer's consumer groups count as groups.
- `always_use_authenticated_groups`: groups authenticated by an auth plugin, such as openid-connect's `authenticated_groups_claim`, win over the consumer's own acls. Without it, as in Kong, authenticated groups apply only to the anonymous consumer. A credentialed consumer with no acls is denied under `allow`.

| Case | Status | Code | Message |
| --- | --- | --- | --- |
| No authenticated consumer | 401 | EDG-AUTH-004 | "Unauthorized" |
| Group not allowed, or denied | 403 | EDG-AUTH-019 | "You cannot consume this service" |
| Neither `allow` nor `deny` set | 500 | EDG-CFG-500 | the admin rejects this config |

## Differences from Kong

- **Consumer-less groups:** Kong can check authenticated groups with no consumer at all. Edgway carries authenticated groups on the consumer, so a consumer is always required.

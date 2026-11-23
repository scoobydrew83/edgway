# @edgway/plugin-ip-restriction

Kong's [ip-restriction](https://developer.konghq.com/plugins/ip-restriction/) plugin (priority 990) for Edgway, built on `hono/ip-restriction`. It can also be used as plain Hono middleware:

```ts
import ipRestriction from "@edgway/plugin-ip-restriction";

app.use(ipRestriction.middleware({ allow: ["192.0.2.0/24", "2001:db8::/32"] }));
```

The client IP is Cloudflare's `CF-Connecting-IP`, which the edge sets and clients cannot forge.

## Supported config

- `deny`: IPv4 and IPv6 addresses and CIDRs. Checked first.
- `allow`: anything outside a non-empty list is blocked.
- `status`, `message`: the rejection's status and problem `detail`.

| Case | Status | Code | Message |
| --- | --- | --- | --- |
| Blocked | 403, or `status` | EDG-AUTH-020 | "Your IP address is not allowed", with `message` as the detail |
| No client IP | 403 | EDG-AUTH-021 | "Cannot identify the client IP address" |
| Neither `allow` nor `deny` set | 500 | EDG-CFG-500 | the admin rejects this config |

## Unsupported Kong fields

- **`tcp` and `tls` protocols:** Edgway proxies HTTP only.

# Terraform

Edgway has no Terraform provider of its own (PRD "Terraform"):

- **Kong entities** (services, routes, plugins, consumers, …) use Kong's own [`Kong/kong-gateway`](https://registry.terraform.io/providers/Kong/kong-gateway) provider against the admin's Kong-compatible API at its root. It authenticates with `Kong-Admin-Token` (the `admin_token` setting); see `docs/deploy.md` for the `KONG_ADMIN_TOKENS` secret. The provider uses Kong's `default` workspace paths (`/default/services`), which Edgway serves.
- **Edgway-only entities and actions** use the module in [`modules/edgway`](modules/edgway), over the generic [`Mastercard/restapi`](https://registry.terraform.io/providers/Mastercard/restapi) provider and the native admin API (`/api/v1`): publish and rollback. A service reaches a private backend through a Workers VPC binding by its tag `edgway-tunnel:<binding>` (see `docs/deploy.md`), so it is set with Kong's provider like any other tag.

Writes through either provider are **staged**: nothing reaches the gateway until a publish.

## The module

```hcl
provider "restapi" {
  uri                  = "https://<admin>/api/v1"
  write_returns_object = true
  headers = {
    "cf-access-client-id"     = var.access_client_id     # an Access service token
    "cf-access-client-secret" = var.access_client_secret # with a publisher role in ADMIN_ROLES
  }
}

module "edgway" {
  source = "./modules/edgway"

  # Publishes again whenever this value changes, e.g. a hash of your Kong resources.
  publish_revision = sha256(jsonencode([kong-gateway_service.api, kong-gateway_route.api]))

  # rollback_to = 3
}
```

| Input | Meaning |
| --- | --- |
| `publish_revision` | Publishes the staged configuration; any change publishes again. `null` publishes nothing. |
| `rollback_to` | Rolls the live configuration back to a published version. |

A publish or rollback is an action: destroying it in Terraform changes nothing on the admin.

## Example and check

[`examples/kong`](examples/kong) uses both: a service, a route, key-auth and a consumer with Kong's provider, and the publish with the module. [`test/run.sh`](test/run.sh) applies it against a local admin (`test/local-admin.mjs`: the real admin Worker on a fresh local D1, Access stubbed) and requires a second `plan` to show no changes. CI runs it in `.github/workflows/terraform.yml`:

```sh
TERRAFORM=/path/to/terraform infra/terraform/test/run.sh
```

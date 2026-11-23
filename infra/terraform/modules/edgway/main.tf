# Edgway-only entities and actions over the native admin API (/api/v1), with
# the generic Mastercard/restapi provider (PRD "Terraform"): publish and
# rollback. Kong entities (services, routes, plugins, consumers) belong to
# Kong's own Kong/kong-gateway provider against the Kong-compatible mount.
#
# Configure the restapi provider in the calling module:
#   provider "restapi" {
#     uri                  = "https://<admin>/api/v1"
#     write_returns_object = true
#     headers              = { "cf-access-client-id" = ..., "cf-access-client-secret" = ... }
#   }

# A publish is an action, not an object: it is created once per revision and
# never read back field by field. Destroying it changes nothing on the admin
# (roll back explicitly with `rollback_to`).
resource "restapi_object" "publish" {
  count = var.publish_revision == null ? 0 : 1

  path                      = "/config/publish"
  create_method             = "POST"
  id_attribute              = "version"
  read_path                 = "/config/versions"
  destroy_path              = "/config/versions"
  destroy_method            = "GET"
  ignore_all_server_changes = true
  data                      = jsonencode({ note = "terraform:${var.publish_revision}" })
  force_new                 = ["note"]
}

resource "restapi_object" "rollback" {
  count = var.rollback_to == null ? 0 : 1

  path                      = "/config/rollback"
  create_method             = "POST"
  id_attribute              = "version"
  read_path                 = "/config/versions"
  destroy_path              = "/config/versions"
  destroy_method            = "GET"
  ignore_all_server_changes = true
  data                      = jsonencode({ version = var.rollback_to })
  force_new                 = ["version"]

  depends_on = [restapi_object.publish]
}

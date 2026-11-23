# Kong's own Terraform provider against Edgway's Kong-compatible Admin API,
# with the Edgway module for what Kong doesn't model (the publish that puts
# the staged changes live). The CI job (test/run.sh) applies
# this against a local admin, then checks that a second plan is empty.

terraform {
  required_version = ">= 1.6"
  required_providers {
    kong-gateway = {
      source  = "Kong/kong-gateway"
      version = "1.4.0"
    }
    restapi = {
      source  = "Mastercard/restapi"
      version = "3.0.0"
    }
  }
}

variable "admin_url" {
  description = "The Edgway admin Worker's origin, e.g. https://edgway-admin.example.workers.dev."
  type        = string
}

variable "kong_admin_token" {
  description = "A Kong-Admin-Token whose SHA-256 is in the admin's KONG_ADMIN_TOKENS secret."
  type        = string
  sensitive   = true
}

variable "admin_headers" {
  description = "Headers for the native API (/api/v1): Cloudflare Access service-token headers, or an Access assertion."
  type        = map(string)
  sensitive   = true
}

provider "kong-gateway" {
  server_url  = var.admin_url
  admin_token = var.kong_admin_token
}

provider "restapi" {
  uri                  = "${var.admin_url}/api/v1"
  write_returns_object = true
  headers              = var.admin_headers
}

resource "kong-gateway_service" "httpbin" {
  name     = "httpbin"
  protocol = "https"
  host     = "httpbin.org"
  port     = 443
}

resource "kong-gateway_route" "httpbin" {
  name    = "httpbin"
  paths   = ["/httpbin"]
  service = { id = kong-gateway_service.httpbin.id }
}

resource "kong-gateway_plugin_key_auth" "httpbin" {
  route  = { id = kong-gateway_route.httpbin.id }
  config = { key_names = ["apikey"] }
}

resource "kong-gateway_consumer" "demo" {
  username = "demo"
}

module "edgway" {
  source = "../../modules/edgway"

  # Publish whenever any of the Kong resources changes.
  publish_revision = sha256(jsonencode([
    kong-gateway_service.httpbin,
    kong-gateway_route.httpbin,
    kong-gateway_plugin_key_auth.httpbin,
    kong-gateway_consumer.demo,
  ]))
}

output "published_version" {
  value = module.edgway.published_version
}

/**
 * The message catalog: every user-facing string, as FormatJS descriptors.
 * `pnpm --filter @edgway/i18n generate` extracts these into lang/en.json and
 * compiles the runtime catalogs (en + x-pseudo) into src/generated/.
 * Ids are namespaced: ui.*, portal.*, errors.*, plugins.<name>.*, validation.*
 */
import { defineMessage } from "@formatjs/intl";

export const errorsAuthRequired = defineMessage({
  id: "errors.auth.required",
  defaultMessage: "Valid API key or JWT required",
  description:
    "Error title: the route needs an API key or JWT and none was valid.",
});
export const errorsAuthKeyMissing = defineMessage({
  id: "errors.auth.keyMissing",
  defaultMessage: "No API key found in request",
  description:
    "Error title (key-auth, Kong's wording): the request carries no API key.",
});
export const errorsAuthKeyDuplicate = defineMessage({
  id: "errors.auth.keyDuplicate",
  defaultMessage: "Duplicate API key found",
  description:
    "Error title (key-auth, Kong's wording): the request carries more than one API key.",
});
export const errorsAuthInvalidCredentials = defineMessage({
  id: "errors.auth.invalidCredentials",
  defaultMessage: "Unauthorized",
  description:
    "Error title (Kong's wording): the credential sent does not match any consumer.",
});
export const errorsAuthTokenMultiple = defineMessage({
  id: "errors.auth.tokenMultiple",
  defaultMessage: "Multiple tokens provided",
  description:
    "Error title (jwt, Kong's wording): the request carries more than one token.",
});
export const errorsAuthTokenBad = defineMessage({
  id: "errors.auth.tokenBad",
  defaultMessage: "Bad token",
  description:
    "Error title (jwt, Kong's wording): the token cannot be decoded.",
});
export const errorsAuthTokenKeyClaimMissing = defineMessage({
  id: "errors.auth.tokenKeyClaimMissing",
  defaultMessage: "No mandatory key claim in token",
  description:
    "Error title (jwt, Kong's wording): the JWT lacks the claim naming its credential (the claim name is in `claim`).",
});
export const errorsAuthTokenKeyClaimInvalid = defineMessage({
  id: "errors.auth.tokenKeyClaimInvalid",
  defaultMessage: "Invalid key claim in token",
  description:
    "Error title (jwt, Kong's wording): the JWT's credential claim is empty or not a string (the claim name is in `claim`).",
});
export const errorsAuthTokenNoCredentials = defineMessage({
  id: "errors.auth.tokenNoCredentials",
  defaultMessage: "No credentials found for given key claim",
  description:
    "Error title (jwt, Kong's wording): no credential matches the JWT's key claim.",
});
export const errorsAuthTokenInvalidAlgorithm = defineMessage({
  id: "errors.auth.tokenInvalidAlgorithm",
  defaultMessage: "Invalid algorithm",
  description:
    "Error title (jwt, Kong's wording): the JWT's algorithm differs from its credential's.",
});
export const errorsAuthTokenInvalidSecret = defineMessage({
  id: "errors.auth.tokenInvalidSecret",
  defaultMessage: "Invalid key/secret",
  description:
    "Error title (jwt, Kong's wording): the credential's secret or public key is missing or unusable.",
});
export const errorsAuthTokenInvalidSignature = defineMessage({
  id: "errors.auth.tokenInvalidSignature",
  defaultMessage: "Invalid signature",
  description:
    "Error title (jwt, Kong's wording): the JWT's signature does not verify.",
});
export const errorsAuthTokenExpired = defineMessage({
  id: "errors.auth.tokenExpired",
  defaultMessage: "Token expired",
  description:
    "Error title (jwt, Kong's wording): the JWT's exp claim is in the past.",
});
export const errorsAuthTokenNotYetValid = defineMessage({
  id: "errors.auth.tokenNotYetValid",
  defaultMessage: "Token not valid yet",
  description:
    "Error title (jwt, Kong's wording): the JWT's nbf claim is in the future.",
});
export const errorsAuthTokenExpirationTooLong = defineMessage({
  id: "errors.auth.tokenExpirationTooLong",
  defaultMessage: "Token exceeds maximum allowed expiration",
  description:
    "Error title (jwt, Kong's wording): the JWT's exp is further away than maximum_expiration allows.",
});
export const errorsAuthTokenClaimNotNumber = defineMessage({
  id: "errors.auth.tokenClaimNotNumber",
  defaultMessage: "Token claim must be a number",
  description:
    "Error title (jwt, Kong's wording): a registered time claim (in `claim`) is not a number.",
});
export const errorsAuthTokenConsumerNotFound = defineMessage({
  id: "errors.auth.tokenConsumerNotFound",
  defaultMessage: "Could not find consumer for the token's key claim",
  description:
    "Error title (jwt, Kong's wording): the credential's consumer no longer exists.",
});
export const errorsAuthForbidden = defineMessage({
  id: "errors.auth.forbidden",
  defaultMessage: "Forbidden",
  description:
    "Error title (openid-connect, Kong's wording): the token is valid but lacks a required issuer, audience, scope, group, role or consumer.",
});
export const errorsAuthAclForbidden = defineMessage({
  id: "errors.auth.aclForbidden",
  defaultMessage: "You cannot consume this service",
  description:
    "Error title (acl, Kong's wording): the consumer's groups are not allowed on this route or service.",
});
export const errorsAuthIpNotAllowed = defineMessage({
  id: "errors.auth.ipNotAllowed",
  defaultMessage: "Your IP address is not allowed",
  description:
    "Error title (ip-restriction, Kong's wording): the client IP is denied or not in the allow list.",
});
export const errorsAuthIpUnknown = defineMessage({
  id: "errors.auth.ipUnknown",
  defaultMessage: "Cannot identify the client IP address",
  description:
    "Error title (ip-restriction, Kong's wording): the request has no usable client IP.",
});
export const errorsPluginRequestTooLarge = defineMessage({
  id: "errors.plugin.requestTooLarge",
  defaultMessage: "Request size limit exceeded",
  description:
    "Error title (request-size-limiting, Kong's wording): the request body is larger than allowed.",
});
export const errorsPluginHeaderInvalid = defineMessage({
  id: "errors.plugin.headerInvalid",
  defaultMessage: "A header built from the request is not a valid header value",
  description:
    "Error title (request-transformer): a templated header value taken from the request (a query parameter, header or path capture) contains characters a header can't hold.",
});
export const errorsPluginBodyUntransformable = defineMessage({
  id: "errors.plugin.bodyUntransformable",
  defaultMessage: "The request body can't be transformed",
  description:
    "Error title (request-transformer): the route changes request bodies, and this body is a type it can't edit, not a JSON object, invalid, or too large to edit.",
});
export const errorsPluginContentLengthRequired = defineMessage({
  id: "errors.plugin.contentLengthRequired",
  defaultMessage: "A valid Content-Length header is required",
  description:
    "Error title (request-size-limiting, Kong's wording): the route requires a Content-Length header.",
});
export const errorsPluginRequestTerminated = defineMessage({
  id: "errors.plugin.requestTerminated",
  defaultMessage: "Request terminated",
  description:
    "Error title (request-termination): the route answers with a fixed response; the configured message is the detail.",
});
export const errorsRateLimitExceeded = defineMessage({
  id: "errors.rateLimit.exceeded",
  defaultMessage: "Rate limit exceeded",
  description: "Error title: the client sent too many requests.",
});
export const errorsUpstreamBindingMissing = defineMessage({
  id: "errors.upstream.bindingMissing",
  defaultMessage: "Upstream service binding is not configured",
  description: "Error title: the route's Worker service binding is missing.",
});
export const errorsUpstreamUnreachable = defineMessage({
  id: "errors.upstream.unreachable",
  defaultMessage: "Upstream is unreachable",
  description: "Error title: the gateway could not reach the upstream service.",
});
export const errorsConfigNoRoute = defineMessage({
  id: "errors.config.noRoute",
  defaultMessage: "No route matches this request",
  description: "Error title: no configured route matches the request.",
});
export const errorsConfigHttpsRequired = defineMessage({
  id: "errors.config.httpsRequired",
  defaultMessage: "Please use HTTPS protocol",
  description:
    "Error title (Kong's wording): the route accepts only HTTPS and the request came over plain HTTP.",
});
export const errorsConfigUnknownUpstreamType = defineMessage({
  id: "errors.config.unknownUpstreamType",
  defaultMessage: "Route has an unknown upstream type",
  description:
    "Error title: a route has an upstream type the gateway does not know.",
});
export const errorsConfigInternal = defineMessage({
  id: "errors.config.internal",
  defaultMessage: "Unexpected gateway error",
  description:
    "Error title: an unexpected gateway failure (details are never shown).",
});
export const errorsConfigPluginUnavailable = defineMessage({
  id: "errors.config.pluginUnavailable",
  defaultMessage: "A plugin on this route can't run",
  description:
    "Error title: a configured plugin is missing from the gateway or its secrets can't be resolved, so the route fails closed.",
});
export const errorsConfigUnavailable = defineMessage({
  id: "errors.config.unavailable",
  defaultMessage: "The gateway has no published configuration yet",
  description:
    "Error title: the gateway has no verified configuration to serve (before the first publish, or a broken key pair).",
});
export const errorsAdminPublishConflict = defineMessage({
  id: "errors.admin.publishConflict",
  defaultMessage: "Another publish happened at the same time; try again",
  description:
    "Error title: a concurrent publish moved the live version first, so this one was not applied.",
});
export const errorsAdminPublishedInvalid = defineMessage({
  id: "errors.admin.publishedInvalid",
  defaultMessage: "The live configuration failed its signature check",
  description:
    "Error title: the published snapshot in storage is not signed by this admin, so nothing is built on it.",
});
export const errorsAdminKeyLimit = defineMessage({
  id: "errors.admin.keyLimit",
  defaultMessage: "This consumer already has the most API keys allowed",
  description:
    "Error title: a developer asked the portal for another API key past the per-consumer limit; delete or rotate one first.",
});
export const errorsPortalDeveloperLimit = defineMessage({
  id: "errors.portal.developerLimit",
  defaultMessage:
    "The developer portal has the most developers this install allows",
  description:
    "Error title: a new developer signed in to the portal past the install's cap on portal developers; an admin can raise it or remove unused developers.",
});
export const errorsAdminVersionPruned = defineMessage({
  id: "errors.admin.versionPruned",
  defaultMessage: "That config version is too old to roll back to",
  description:
    "Error title: a rollback named a published version that has since been pruned; only the newest versions and the last week's are kept.",
});
export const errorsAdminForbidden = defineMessage({
  id: "errors.admin.forbidden",
  defaultMessage: "You aren't allowed to do this",
  description:
    "Error title: the caller is refused (an admin identity with no role, a failed CSRF check, a developer the portal doesn't allow); the detail, when present, names what to fix.",
});
export const errorsAdminDisabled = defineMessage({
  id: "errors.admin.disabled",
  defaultMessage: "Admin API is disabled",
  description: "Error title: the admin API is turned off on this deployment.",
});
export const errorsAdminPublishDisabled = defineMessage({
  id: "errors.admin.publishDisabled",
  defaultMessage: "Publishing is not configured",
  description:
    "Error title: the admin can't publish (its signing key, or the portal's Service Binding to the admin, is missing); the detail names what.",
});
export const errorsPortalSignInDisabled = defineMessage({
  id: "errors.portal.signInDisabled",
  defaultMessage: "Portal sign-in is not configured",
  description:
    "Error title: the developer portal's OpenID Connect settings are missing; the detail names which.",
});
export const errorsAdminNotFound = defineMessage({
  id: "errors.admin.notFound",
  defaultMessage: "Entity not found",
  description: "Error title: the requested admin entity does not exist.",
});
export const errorsAdminInvalidRequest = defineMessage({
  id: "errors.admin.invalidRequest",
  defaultMessage: "Invalid request",
  description: "Error title: the admin request body is invalid.",
});
export const errorsAdminConflict = defineMessage({
  id: "errors.admin.conflict",
  defaultMessage: "An entity with these unique fields already exists",
  description:
    "Error title: an admin write would duplicate a unique field such as a name.",
});
export const errorsAdminRoleRequired = defineMessage({
  id: "errors.admin.roleRequired",
  defaultMessage: "Your admin role does not allow this action",
  description:
    "Error title: the signed-in admin's role is below the one this action needs.",
});
export const errorsAdminPluginNotEnabled = defineMessage({
  id: "errors.admin.pluginNotEnabled",
  defaultMessage:
    "schema violation (name: plugin not enabled; add it to the 'plugins' configuration property)",
  description:
    "Error title, in Kong's wording: an admin write names a plugin this gateway does not bundle.",
});
export const errorsAdminUnauthenticated = defineMessage({
  id: "errors.admin.unauthenticated",
  defaultMessage: "Admin sign-in required",
  description:
    "Error title: no valid Cloudflare Access sign-in came with the admin request.",
});
export const cliDescription = defineMessage({
  id: "cli.description",
  defaultMessage: "Set up, deploy and manage an Edgway gateway.",
  description: "CLI help: what the edgway command does.",
});
export const cliOptionAdminUrl = defineMessage({
  id: "cli.option.adminUrl",
  defaultMessage: "Admin Worker URL (overrides edgway.config.ts)",
  description: "CLI help: the --admin-url option.",
});
export const cliOptionToken = defineMessage({
  id: "cli.option.token",
  defaultMessage:
    "A Cloudflare Access token (cloudflared access token); a local admin gets it as the assertion header",
  description: "CLI help: the --token option.",
});
export const cliOptionCwd = defineMessage({
  id: "cli.option.cwd",
  defaultMessage: "Project directory (defaults to the current one)",
  description: "CLI help: the --cwd option.",
});
export const cliErrorNoAdminUrl = defineMessage({
  id: "cli.error.noAdminUrl",
  defaultMessage:
    "No admin URL: set adminUrl in edgway.config.ts, set EDGWAY_ADMIN_URL or pass --admin-url.",
  description: "CLI error: the admin URL is not configured.",
});
export const cliErrorRequest = defineMessage({
  id: "cli.error.request",
  defaultMessage: "The admin answered {status}: {message}",
  description:
    "CLI error: an admin API call failed; status is the HTTP status.",
});
export const cliInitDescription = defineMessage({
  id: "cli.init.description",
  defaultMessage: "Create edgway.config.ts for this project.",
  description: "CLI help: the init command.",
});
export const cliInitOptionYes = defineMessage({
  id: "cli.init.option.yes",
  defaultMessage: "Accept the defaults without prompting",
  description: "CLI help: the init --yes option.",
});
export const cliInitOptionForce = defineMessage({
  id: "cli.init.option.force",
  defaultMessage: "Overwrite an existing config file",
  description: "CLI help: the init --force option.",
});
export const cliInitAdminUrl = defineMessage({
  id: "cli.init.adminUrl",
  defaultMessage: "Admin Worker URL",
  description: "CLI prompt: the admin Worker's URL.",
});
export const cliInitAdminConfig = defineMessage({
  id: "cli.init.adminConfig",
  defaultMessage: "Path to the admin Worker's wrangler config",
  description: "CLI prompt: the admin Worker's wrangler config path.",
});
export const cliInitGatewayConfig = defineMessage({
  id: "cli.init.gatewayConfig",
  defaultMessage: "Path to the gateway Worker's wrangler config",
  description: "CLI prompt: the gateway Worker's wrangler config path.",
});
export const cliInitPortalConfig = defineMessage({
  id: "cli.init.portalConfig",
  defaultMessage: "Path to the developer portal Worker's wrangler config",
  description: "CLI prompt: the portal Worker's wrangler config path.",
});
export const cliInitExists = defineMessage({
  id: "cli.init.exists",
  defaultMessage: "{file} already exists. Pass --force to overwrite it.",
  description: "CLI error: the config file already exists.",
});
export const cliInitCancelled = defineMessage({
  id: "cli.init.cancelled",
  defaultMessage: "Cancelled.",
  description: "CLI message: the user cancelled a prompt.",
});
export const cliInitWritten = defineMessage({
  id: "cli.init.written",
  defaultMessage: "Wrote {file}.",
  description: "CLI message: the config file was written.",
});
export const cliDeployDescription = defineMessage({
  id: "cli.deploy.description",
  defaultMessage:
    "Provision, migrate and deploy the admin, gateway and portal Workers, as pnpm run deploy does.",
  description: "CLI help: the deploy command.",
});
export const cliDeployOptionDryRun = defineMessage({
  id: "cli.deploy.option.dryRun",
  defaultMessage:
    "Bundle and check the three Workers without provisioning, migrating or deploying",
  description: "CLI help: the deploy --dry-run option.",
});
export const cliDeployFailed = defineMessage({
  id: "cli.deploy.failed",
  defaultMessage: "{command} failed (exit {code}).",
  description: "CLI error: a wrangler command failed.",
});
export const cliDeployDone = defineMessage({
  id: "cli.deploy.done",
  defaultMessage:
    "Deployed. Next: put the admin behind Cloudflare Access and set its vars (docs/deploy.md).",
  description: "CLI message: deploy finished.",
});
export const cliDeployChecked = defineMessage({
  id: "cli.deploy.checked",
  defaultMessage:
    "Dry run: the three Workers bundle. Not run: provisioning, migrations, deploys, secrets.",
  description: "CLI message: a dry-run deploy finished.",
});
export const cliImportDescription = defineMessage({
  id: "cli.importDeck.description",
  defaultMessage:
    "Import a decK file into the admin's local D1, offline. Review it with edgway diff.",
  description: "CLI help: the import-deck command.",
});
export const cliImportOptionFile = defineMessage({
  id: "cli.importDeck.option.file",
  defaultMessage: "decK file (YAML or JSON)",
  description: "CLI help: the import-deck file argument.",
});
export const cliImportOptionPersist = defineMessage({
  id: "cli.importDeck.option.persist",
  defaultMessage: "Local state directory, as wrangler's --persist-to",
  description: "CLI help: the import-deck --persist-to option.",
});
export const cliImportInvalid = defineMessage({
  id: "cli.importDeck.invalid",
  defaultMessage: "{file} is not a valid decK file:",
  description:
    "CLI error: the decK file fails decK's schema; the problems follow.",
});
export const cliImportFailed = defineMessage({
  id: "cli.importDeck.failed",
  defaultMessage: "{entity} {name}: {message}",
  description: "CLI error: one entity of the decK file was refused.",
});
export const cliImportDone = defineMessage({
  id: "cli.importDeck.done",
  defaultMessage:
    "Imported {count, plural, one {# entity} other {# entities}} from {file}.",
  description: "CLI message: import finished.",
});
export const cliImportPartial = defineMessage({
  id: "cli.importDeck.partial",
  defaultMessage:
    "{failed, plural, one {# entity was} other {# entities were}} not imported.",
  description: "CLI error: some entities failed to import.",
});
export const cliDiffDescription = defineMessage({
  id: "cli.diff.description",
  defaultMessage: "Show the staged changes the next publish would make.",
  description: "CLI help: the diff command.",
});
export const cliDiffNone = defineMessage({
  id: "cli.diff.none",
  defaultMessage: "No pending changes.",
  description: "CLI message: nothing to publish.",
});
export const cliDiffSummary = defineMessage({
  id: "cli.diff.summary",
  defaultMessage:
    "{count, plural, one {# pending change} other {# pending changes}} (published version: {version}).",
  description: "CLI message: how many changes are pending.",
});
export const cliPublishDescription = defineMessage({
  id: "cli.publish.description",
  defaultMessage: "Publish the staged configuration to the gateway.",
  description: "CLI help: the publish command.",
});
export const cliPublishOptionNote = defineMessage({
  id: "cli.publish.option.note",
  defaultMessage: "A note for the version history",
  description: "CLI help: the publish --note option.",
});
export const cliPublishDone = defineMessage({
  id: "cli.publish.done",
  defaultMessage: "Published version {version}.",
  description: "CLI message: publish finished.",
});
export const cliPluginDescription = defineMessage({
  id: "cli.plugin.description",
  defaultMessage: "Work with Edgway plugins.",
  description: "CLI help: the plugin command group.",
});
export const cliPluginNewDescription = defineMessage({
  id: "cli.plugin.new.description",
  defaultMessage: "Scaffold a new Edgway plugin package.",
  description: "CLI help: the plugin new command.",
});
export const cliPluginNewOptionName = defineMessage({
  id: "cli.plugin.new.option.name",
  defaultMessage: "Plugin name (lowercase letters, digits and dashes)",
  description: "CLI help: the plugin new name argument.",
});
export const cliPluginNewOptionDir = defineMessage({
  id: "cli.plugin.new.option.dir",
  defaultMessage: "Directory to create the package in",
  description: "CLI help: the plugin new --dir option.",
});
export const cliPluginNewInvalidName = defineMessage({
  id: "cli.plugin.new.invalidName",
  defaultMessage:
    "Plugin names use lowercase letters, digits and dashes, starting with a letter.",
  description: "CLI error: the plugin name is not valid.",
});
export const cliPluginNewExists = defineMessage({
  id: "cli.plugin.new.exists",
  defaultMessage: "{dir} already exists.",
  description: "CLI error: the plugin directory already exists.",
});
export const cliPluginNewDone = defineMessage({
  id: "cli.plugin.new.done",
  defaultMessage: "Created {dir}.",
  description: "CLI message: the plugin package was created.",
});
export const uiTitle = defineMessage({
  id: "ui.title",
  defaultMessage: "Edgway",
  description: "Admin UI: the application title.",
});
export const uiNavServices = defineMessage({
  id: "ui.nav.services",
  defaultMessage: "Services",
  description: "Admin UI resource: Kong services.",
});
export const uiNavRoutes = defineMessage({
  id: "ui.nav.routes",
  defaultMessage: "Routes",
  description: "Admin UI resource: Kong routes.",
});
export const uiNavUpstreams = defineMessage({
  id: "ui.nav.upstreams",
  defaultMessage: "Upstreams",
  description: "Admin UI resource: load-balanced upstreams.",
});
export const uiNavTargets = defineMessage({
  id: "ui.nav.targets",
  defaultMessage: "Targets",
  description: "Admin UI resource: upstream targets.",
});

export const uiNavSandboxPlugins = defineMessage({
  id: "ui.nav.sandboxPlugins",
  defaultMessage: "Uploaded plugins",
  description:
    "Admin UI resource: third-party plugins uploaded as code and run in a sandbox.",
});

export const uiFieldCode = defineMessage({
  id: "ui.field.code",
  defaultMessage: "Plugin code",
  description: "Admin UI: label of the code editor for an uploaded plugin.",
});
export const uiFieldAlgorithm = defineMessage({
  id: "ui.field.algorithm",
  defaultMessage: "Algorithm",
  description:
    "Admin UI: the label of Kong's `algorithm` field on forms, lists and detail pages.",
});
export const uiFieldBindings = defineMessage({
  id: "ui.field.bindings",
  defaultMessage: "Bindings",
  description:
    "Admin UI: the label of Kong's `bindings` field on forms, lists and detail pages.",
});
export const uiFieldCaCertificates = defineMessage({
  id: "ui.field.caCertificates",
  defaultMessage: "CA certificates",
  description:
    "Admin UI: the label of Kong's `ca_certificates` field on forms, lists and detail pages.",
});
export const uiFieldCert = defineMessage({
  id: "ui.field.cert",
  defaultMessage: "Certificate (PEM)",
  description:
    "Admin UI: the label of Kong's `cert` field on forms, lists and detail pages.",
});
export const uiFieldCertAlt = defineMessage({
  id: "ui.field.certAlt",
  defaultMessage: "Alternate certificate (PEM)",
  description:
    "Admin UI: the label of Kong's `cert_alt` field on forms, lists and detail pages.",
});
export const uiFieldCertDigest = defineMessage({
  id: "ui.field.certDigest",
  defaultMessage: "Certificate digest",
  description:
    "Admin UI: the label of Kong's `cert_digest` field on forms, lists and detail pages.",
});
export const uiFieldCertificateId = defineMessage({
  id: "ui.field.certificateId",
  defaultMessage: "Certificate",
  description:
    "Admin UI: the label of Kong's `certificate_id` field on forms, lists and detail pages.",
});
export const uiFieldClientCertificateId = defineMessage({
  id: "ui.field.clientCertificateId",
  defaultMessage: "Client certificate",
  description:
    "Admin UI: the label of Kong's `client_certificate_id` field on forms, lists and detail pages.",
});
export const uiFieldConfig = defineMessage({
  id: "ui.field.config",
  defaultMessage: "Configuration",
  description:
    "Admin UI: the label of Kong's `config` field on forms, lists and detail pages.",
});
export const uiFieldConnectTimeout = defineMessage({
  id: "ui.field.connectTimeout",
  defaultMessage: "Connect timeout (ms)",
  description:
    "Admin UI: the label of Kong's `connect_timeout` field on forms, lists and detail pages.",
});
export const uiFieldConsumerGroupId = defineMessage({
  id: "ui.field.consumerGroupId",
  defaultMessage: "Consumer group",
  description:
    "Admin UI: the label of Kong's `consumer_group_id` field on forms, lists and detail pages.",
});
export const uiFieldConsumerId = defineMessage({
  id: "ui.field.consumerId",
  defaultMessage: "Consumer",
  description:
    "Admin UI: the label of Kong's `consumer_id` field on forms, lists and detail pages.",
});
export const uiFieldCpuMs = defineMessage({
  id: "ui.field.cpuMs",
  defaultMessage: "CPU time (ms)",
  description:
    "Admin UI: the label of Kong's `cpu_ms` field on forms, lists and detail pages.",
});
export const uiFieldCustomId = defineMessage({
  id: "ui.field.customId",
  defaultMessage: "Custom ID",
  description:
    "Admin UI: the label of Kong's `custom_id` field on forms, lists and detail pages.",
});
export const uiFieldDescription = defineMessage({
  id: "ui.field.description",
  defaultMessage: "Description",
  description:
    "Admin UI: the label of Kong's `description` field on forms, lists and detail pages.",
});
export const uiFieldDestinations = defineMessage({
  id: "ui.field.destinations",
  defaultMessage: "Destinations",
  description:
    "Admin UI: the label of Kong's `destinations` field on forms, lists and detail pages.",
});
export const uiFieldDisplayName = defineMessage({
  id: "ui.field.displayName",
  defaultMessage: "Display name",
  description:
    "Admin UI: the label of Kong's `display_name` field on forms, lists and detail pages.",
});
export const uiFieldEnabled = defineMessage({
  id: "ui.field.enabled",
  defaultMessage: "Enabled",
  description:
    "Admin UI: the label of Kong's `enabled` field on forms, lists and detail pages.",
});
export const uiFieldExpression = defineMessage({
  id: "ui.field.expression",
  defaultMessage: "Expression",
  description:
    "Admin UI: the label of Kong's `expression` field on forms, lists and detail pages.",
});
export const uiFieldFailover = defineMessage({
  id: "ui.field.failover",
  defaultMessage: "Failover",
  description:
    "Admin UI: the label of Kong's `failover` field on forms, lists and detail pages.",
});
export const uiFieldGroup = defineMessage({
  id: "ui.field.group",
  defaultMessage: "Group",
  description:
    "Admin UI: the label of Kong's `group` field on forms, lists and detail pages.",
});
export const uiFieldHashFallback = defineMessage({
  id: "ui.field.hashFallback",
  defaultMessage: "Hash fallback",
  description:
    "Admin UI: the label of Kong's `hash_fallback` field on forms, lists and detail pages.",
});
export const uiFieldHashFallbackHeader = defineMessage({
  id: "ui.field.hashFallbackHeader",
  defaultMessage: "Hash fallback header",
  description:
    "Admin UI: the label of Kong's `hash_fallback_header` field on forms, lists and detail pages.",
});
export const uiFieldHashFallbackQueryArg = defineMessage({
  id: "ui.field.hashFallbackQueryArg",
  defaultMessage: "Hash fallback query argument",
  description:
    "Admin UI: the label of Kong's `hash_fallback_query_arg` field on forms, lists and detail pages.",
});
export const uiFieldHashFallbackUriCapture = defineMessage({
  id: "ui.field.hashFallbackUriCapture",
  defaultMessage: "Hash fallback URI capture",
  description:
    "Admin UI: the label of Kong's `hash_fallback_uri_capture` field on forms, lists and detail pages.",
});
export const uiFieldHashOn = defineMessage({
  id: "ui.field.hashOn",
  defaultMessage: "Hash on",
  description:
    "Admin UI: the label of Kong's `hash_on` field on forms, lists and detail pages.",
});
export const uiFieldHashOnCookie = defineMessage({
  id: "ui.field.hashOnCookie",
  defaultMessage: "Hash on cookie",
  description:
    "Admin UI: the label of Kong's `hash_on_cookie` field on forms, lists and detail pages.",
});
export const uiFieldHashOnCookiePath = defineMessage({
  id: "ui.field.hashOnCookiePath",
  defaultMessage: "Hash cookie path",
  description:
    "Admin UI: the label of Kong's `hash_on_cookie_path` field on forms, lists and detail pages.",
});
export const uiFieldHashOnHeader = defineMessage({
  id: "ui.field.hashOnHeader",
  defaultMessage: "Hash on header",
  description:
    "Admin UI: the label of Kong's `hash_on_header` field on forms, lists and detail pages.",
});
export const uiFieldHashOnQueryArg = defineMessage({
  id: "ui.field.hashOnQueryArg",
  defaultMessage: "Hash on query argument",
  description:
    "Admin UI: the label of Kong's `hash_on_query_arg` field on forms, lists and detail pages.",
});
export const uiFieldHashOnUriCapture = defineMessage({
  id: "ui.field.hashOnUriCapture",
  defaultMessage: "Hash on URI capture",
  description:
    "Admin UI: the label of Kong's `hash_on_uri_capture` field on forms, lists and detail pages.",
});
export const uiFieldHeaders = defineMessage({
  id: "ui.field.headers",
  defaultMessage: "Headers",
  description:
    "Admin UI: the label of Kong's `headers` field on forms, lists and detail pages.",
});
export const uiFieldHealthchecks = defineMessage({
  id: "ui.field.healthchecks",
  defaultMessage: "Health checks",
  description:
    "Admin UI: the label of Kong's `healthchecks` field on forms, lists and detail pages.",
});
export const uiFieldHost = defineMessage({
  id: "ui.field.host",
  defaultMessage: "Host",
  description:
    "Admin UI: the label of Kong's `host` field on forms, lists and detail pages.",
});
export const uiFieldHostHeader = defineMessage({
  id: "ui.field.hostHeader",
  defaultMessage: "Host header",
  description:
    "Admin UI: the label of Kong's `host_header` field on forms, lists and detail pages.",
});
export const uiFieldHosts = defineMessage({
  id: "ui.field.hosts",
  defaultMessage: "Hosts",
  description:
    "Admin UI: the label of Kong's `hosts` field on forms, lists and detail pages.",
});
export const uiFieldHttpsRedirectStatusCode = defineMessage({
  id: "ui.field.httpsRedirectStatusCode",
  defaultMessage: "HTTPS redirect status",
  description:
    "Admin UI: the label of Kong's `https_redirect_status_code` field on forms, lists and detail pages.",
});
export const uiFieldId = defineMessage({
  id: "ui.field.id",
  defaultMessage: "ID",
  description:
    "Admin UI: the label of Kong's `id` field on forms, lists and detail pages.",
});
export const uiFieldInstanceName = defineMessage({
  id: "ui.field.instanceName",
  defaultMessage: "Instance name",
  description:
    "Admin UI: the label of Kong's `instance_name` field on forms, lists and detail pages.",
});
export const uiFieldKey = defineMessage({
  id: "ui.field.key",
  defaultMessage: "Private key",
  description:
    "Admin UI: the label of Kong's `key` field on forms, lists and detail pages.",
});
export const uiFieldKeyAlt = defineMessage({
  id: "ui.field.keyAlt",
  defaultMessage: "Alternate private key",
  description:
    "Admin UI: the label of Kong's `key_alt` field on forms, lists and detail pages.",
});
export const uiFieldMethods = defineMessage({
  id: "ui.field.methods",
  defaultMessage: "Methods",
  description:
    "Admin UI: the label of Kong's `methods` field on forms, lists and detail pages.",
});
export const uiFieldName = defineMessage({
  id: "ui.field.name",
  defaultMessage: "Name",
  description:
    "Admin UI: the label of Kong's `name` field on forms, lists and detail pages.",
});
export const uiFieldOnError = defineMessage({
  id: "ui.field.onError",
  defaultMessage: "On error",
  description:
    "Admin UI: the label of Kong's `on_error` field on forms, lists and detail pages.",
});
export const uiFieldOrdering = defineMessage({
  id: "ui.field.ordering",
  defaultMessage: "Ordering",
  description:
    "Admin UI: the label of Kong's `ordering` field on forms, lists and detail pages.",
});
export const uiFieldPassword = defineMessage({
  id: "ui.field.password",
  defaultMessage: "Password",
  description:
    "Admin UI: the label of Kong's `password` field on forms, lists and detail pages.",
});
export const uiFieldPath = defineMessage({
  id: "ui.field.path",
  defaultMessage: "Path",
  description:
    "Admin UI: the label of Kong's `path` field on forms, lists and detail pages.",
});
export const uiFieldPathHandling = defineMessage({
  id: "ui.field.pathHandling",
  defaultMessage: "Path handling",
  description:
    "Admin UI: the label of Kong's `path_handling` field on forms, lists and detail pages.",
});
export const uiFieldPaths = defineMessage({
  id: "ui.field.paths",
  defaultMessage: "Paths",
  description:
    "Admin UI: the label of Kong's `paths` field on forms, lists and detail pages.",
});
export const uiFieldPort = defineMessage({
  id: "ui.field.port",
  defaultMessage: "Port",
  description:
    "Admin UI: the label of Kong's `port` field on forms, lists and detail pages.",
});
export const uiFieldPrefix = defineMessage({
  id: "ui.field.prefix",
  defaultMessage: "Prefix",
  description:
    "Admin UI: the label of Kong's `prefix` field on forms, lists and detail pages.",
});
export const uiFieldPreserveHost = defineMessage({
  id: "ui.field.preserveHost",
  defaultMessage: "Preserve host",
  description:
    "Admin UI: the label of Kong's `preserve_host` field on forms, lists and detail pages.",
});
export const uiFieldPriority = defineMessage({
  id: "ui.field.priority",
  defaultMessage: "Priority",
  description:
    "Admin UI: the label of Kong's `priority` field on forms, lists and detail pages.",
});
export const uiFieldProtocol = defineMessage({
  id: "ui.field.protocol",
  defaultMessage: "Protocol",
  description:
    "Admin UI: the label of Kong's `protocol` field on forms, lists and detail pages.",
});
export const uiFieldProtocols = defineMessage({
  id: "ui.field.protocols",
  defaultMessage: "Protocols",
  description:
    "Admin UI: the label of Kong's `protocols` field on forms, lists and detail pages.",
});
export const uiFieldReadTimeout = defineMessage({
  id: "ui.field.readTimeout",
  defaultMessage: "Read timeout (ms)",
  description:
    "Admin UI: the label of Kong's `read_timeout` field on forms, lists and detail pages.",
});
export const uiFieldRegexPriority = defineMessage({
  id: "ui.field.regexPriority",
  defaultMessage: "Regex priority",
  description:
    "Admin UI: the label of Kong's `regex_priority` field on forms, lists and detail pages.",
});
export const uiFieldRequestBuffering = defineMessage({
  id: "ui.field.requestBuffering",
  defaultMessage: "Request buffering",
  description:
    "Admin UI: the label of Kong's `request_buffering` field on forms, lists and detail pages.",
});
export const uiFieldResponseBuffering = defineMessage({
  id: "ui.field.responseBuffering",
  defaultMessage: "Response buffering",
  description:
    "Admin UI: the label of Kong's `response_buffering` field on forms, lists and detail pages.",
});
export const uiFieldRetries = defineMessage({
  id: "ui.field.retries",
  defaultMessage: "Retries",
  description:
    "Admin UI: the label of Kong's `retries` field on forms, lists and detail pages.",
});
export const uiFieldRouteId = defineMessage({
  id: "ui.field.routeId",
  defaultMessage: "Route",
  description:
    "Admin UI: the label of Kong's `route_id` field on forms, lists and detail pages.",
});
export const uiFieldRsaPublicKey = defineMessage({
  id: "ui.field.rsaPublicKey",
  defaultMessage: "RSA public key",
  description:
    "Admin UI: the label of Kong's `rsa_public_key` field on forms, lists and detail pages.",
});
export const uiFieldSecret = defineMessage({
  id: "ui.field.secret",
  defaultMessage: "Secret",
  description:
    "Admin UI: the label of Kong's `secret` field on forms, lists and detail pages.",
});
export const uiFieldServiceId = defineMessage({
  id: "ui.field.serviceId",
  defaultMessage: "Service",
  description:
    "Admin UI: the label of Kong's `service_id` field on forms, lists and detail pages.",
});
export const uiFieldSlots = defineMessage({
  id: "ui.field.slots",
  defaultMessage: "Slots",
  description:
    "Admin UI: the label of Kong's `slots` field on forms, lists and detail pages.",
});
export const uiFieldSnis = defineMessage({
  id: "ui.field.snis",
  defaultMessage: "SNIs",
  description:
    "Admin UI: the label of Kong's `snis` field on forms, lists and detail pages.",
});
export const uiFieldSources = defineMessage({
  id: "ui.field.sources",
  defaultMessage: "Sources",
  description:
    "Admin UI: the label of Kong's `sources` field on forms, lists and detail pages.",
});
export const uiFieldStickySessionsCookie = defineMessage({
  id: "ui.field.stickySessionsCookie",
  defaultMessage: "Sticky sessions cookie",
  description:
    "Admin UI: the label of Kong's `sticky_sessions_cookie` field on forms, lists and detail pages.",
});
export const uiFieldStickySessionsCookiePath = defineMessage({
  id: "ui.field.stickySessionsCookiePath",
  defaultMessage: "Sticky sessions cookie path",
  description:
    "Admin UI: the label of Kong's `sticky_sessions_cookie_path` field on forms, lists and detail pages.",
});
export const uiFieldStripPath = defineMessage({
  id: "ui.field.stripPath",
  defaultMessage: "Strip path",
  description:
    "Admin UI: the label of Kong's `strip_path` field on forms, lists and detail pages.",
});
export const uiFieldSubRequests = defineMessage({
  id: "ui.field.subRequests",
  defaultMessage: "Subrequests",
  description:
    "Admin UI: the label of Kong's `sub_requests` field on forms, lists and detail pages.",
});
export const uiFieldTags = defineMessage({
  id: "ui.field.tags",
  defaultMessage: "Tags",
  description:
    "Admin UI: the label of Kong's `tags` field on forms, lists and detail pages.",
});
export const uiFieldTarget = defineMessage({
  id: "ui.field.target",
  defaultMessage: "Target",
  description:
    "Admin UI: the label of Kong's `target` field on forms, lists and detail pages.",
});
export const uiFieldTlsVerify = defineMessage({
  id: "ui.field.tlsVerify",
  defaultMessage: "Verify TLS",
  description:
    "Admin UI: the label of Kong's `tls_verify` field on forms, lists and detail pages.",
});
export const uiFieldTlsVerifyDepth = defineMessage({
  id: "ui.field.tlsVerifyDepth",
  defaultMessage: "TLS verify depth",
  description:
    "Admin UI: the label of Kong's `tls_verify_depth` field on forms, lists and detail pages.",
});
export const uiFieldTtl = defineMessage({
  id: "ui.field.ttl",
  defaultMessage: "Time to live (s)",
  description:
    "Admin UI: the label of Kong's `ttl` field on forms, lists and detail pages.",
});
export const uiFieldUpstreamId = defineMessage({
  id: "ui.field.upstreamId",
  defaultMessage: "Upstream",
  description:
    "Admin UI: the label of Kong's `upstream_id` field on forms, lists and detail pages.",
});
export const uiFieldUseSrvName = defineMessage({
  id: "ui.field.useSrvName",
  defaultMessage: "Use SRV name",
  description:
    "Admin UI: the label of Kong's `use_srv_name` field on forms, lists and detail pages.",
});
export const uiFieldUsername = defineMessage({
  id: "ui.field.username",
  defaultMessage: "Username",
  description:
    "Admin UI: the label of Kong's `username` field on forms, lists and detail pages.",
});
export const uiFieldVersion = defineMessage({
  id: "ui.field.version",
  defaultMessage: "Version",
  description:
    "Admin UI: the label of Kong's `version` field on forms, lists and detail pages.",
});
export const uiFieldWeight = defineMessage({
  id: "ui.field.weight",
  defaultMessage: "Weight",
  description:
    "Admin UI: the label of Kong's `weight` field on forms, lists and detail pages.",
});
export const uiFieldWriteTimeout = defineMessage({
  id: "ui.field.writeTimeout",
  defaultMessage: "Write timeout (ms)",
  description:
    "Admin UI: the label of Kong's `write_timeout` field on forms, lists and detail pages.",
});
export const uiEntityServices = defineMessage({
  id: "ui.entity.services",
  defaultMessage: "service",
  description:
    'Admin UI: one service, lower case, inside titles such as "Create service".',
});
export const uiEntityRoutes = defineMessage({
  id: "ui.entity.routes",
  defaultMessage: "route",
  description:
    'Admin UI: one route, lower case, inside titles such as "Create route".',
});
export const uiEntityUpstreams = defineMessage({
  id: "ui.entity.upstreams",
  defaultMessage: "upstream",
  description:
    'Admin UI: one upstream, lower case, inside titles such as "Create upstream".',
});
export const uiEntityTargets = defineMessage({
  id: "ui.entity.targets",
  defaultMessage: "target",
  description:
    'Admin UI: one target, lower case, inside titles such as "Create target".',
});
export const uiEntitySandboxPlugins = defineMessage({
  id: "ui.entity.sandboxPlugins",
  defaultMessage: "uploaded plugin",
  description:
    'Admin UI: one uploaded plugin, lower case, inside titles such as "Create uploaded plugin".',
});
export const uiEntityConsumers = defineMessage({
  id: "ui.entity.consumers",
  defaultMessage: "consumer",
  description:
    'Admin UI: one consumer, lower case, inside titles such as "Create consumer".',
});
export const uiEntityConsumerGroups = defineMessage({
  id: "ui.entity.consumerGroups",
  defaultMessage: "consumer group",
  description:
    'Admin UI: one consumer group, lower case, inside titles such as "Create consumer group".',
});
export const uiEntityKeyAuth = defineMessage({
  id: "ui.entity.keyAuth",
  defaultMessage: "API key",
  description:
    'Admin UI: one API key, lower case, inside titles such as "Create API key".',
});
export const uiEntityBasicAuth = defineMessage({
  id: "ui.entity.basicAuth",
  defaultMessage: "basic auth credential",
  description:
    'Admin UI: one basic auth credential, lower case, inside titles such as "Create basic auth credential".',
});
export const uiEntityJwtSecrets = defineMessage({
  id: "ui.entity.jwtSecrets",
  defaultMessage: "JWT credential",
  description:
    'Admin UI: one JWT credential, lower case, inside titles such as "Create JWT credential".',
});
export const uiEntityAcls = defineMessage({
  id: "ui.entity.acls",
  defaultMessage: "ACL group",
  description:
    'Admin UI: one ACL group, lower case, inside titles such as "Create ACL group".',
});
export const uiEntityPlugins = defineMessage({
  id: "ui.entity.plugins",
  defaultMessage: "plugin",
  description:
    'Admin UI: one plugin, lower case, inside titles such as "Create plugin".',
});
export const uiEntityCertificates = defineMessage({
  id: "ui.entity.certificates",
  defaultMessage: "certificate",
  description:
    'Admin UI: one certificate, lower case, inside titles such as "Create certificate".',
});
export const uiEntityCaCertificates = defineMessage({
  id: "ui.entity.caCertificates",
  defaultMessage: "CA certificate",
  description:
    'Admin UI: one CA certificate, lower case, inside titles such as "Create CA certificate".',
});
export const uiEntitySnis = defineMessage({
  id: "ui.entity.snis",
  defaultMessage: "SNI",
  description:
    'Admin UI: one SNI, lower case, inside titles such as "Create SNI".',
});
export const uiEntityVaults = defineMessage({
  id: "ui.entity.vaults",
  defaultMessage: "vault",
  description:
    'Admin UI: one vault, lower case, inside titles such as "Create vault".',
});
export const uiPageCreate = defineMessage({
  id: "ui.page.create",
  defaultMessage: "Create {entity}",
  description:
    "Admin UI: a create page's title; {entity} is the singular entity name, lower case.",
});
export const uiPageEdit = defineMessage({
  id: "ui.page.edit",
  defaultMessage: "Edit {name}",
  description:
    "Admin UI: an edit page's title; {name} is the entity's own name.",
});
export const uiPageUpload = defineMessage({
  id: "ui.page.upload",
  defaultMessage: "Upload a plugin",
  description: "Admin UI: the uploaded-plugin create page's title.",
});
export const uiListSearch = defineMessage({
  id: "ui.list.search",
  defaultMessage: "Filter by name, path or host",
  description:
    "Admin UI lists: the search box's placeholder and label; it filters the rows on this page.",
});
export const uiPageEditEntity = defineMessage({
  id: "ui.page.editEntity",
  defaultMessage: "Edit {entity}",
  description:
    'Admin UI entity page: the primary edit action, such as "Edit service".',
});
export const uiServiceFlow = defineMessage({
  id: "ui.service.flow",
  defaultMessage: "How requests reach it",
  description:
    "Admin UI service page: the card showing routes, then the service, then its upstream.",
});
export const uiServiceRoutes = defineMessage({
  id: "ui.service.routes",
  defaultMessage:
    "{count, plural, =0 {No routes} one {# route} other {# routes}}",
  description: "Admin UI service page: the routes box's heading.",
});
export const uiServiceBox = defineMessage({
  id: "ui.service.box",
  defaultMessage: "Service",
  description: "Admin UI service page: the service box's heading in the flow.",
});
export const uiServiceSettings = defineMessage({
  id: "ui.service.settings",
  defaultMessage: "Timeouts {seconds} s · retries {retries}",
  description:
    "Admin UI service page: the service's timeouts (the longest, in seconds) and retries.",
});
export const uiServicePlugins = defineMessage({
  id: "ui.service.plugins",
  defaultMessage:
    "{count, plural, =0 {No plugins attached} one {# plugin attached} other {# plugins attached}}",
  description: "Admin UI service page: plugins set on the service itself.",
});
export const uiServiceAlgorithm = defineMessage({
  id: "ui.service.algorithm",
  defaultMessage: "· {algorithm}",
  description:
    "Admin UI service page: after the upstream's name, its balancing algorithm.",
});
export const uiServiceTargetWeight = defineMessage({
  id: "ui.service.targetWeight",
  defaultMessage: "weight {weight}",
  description: "Admin UI service page: a target's weight in the upstream box.",
});
export const uiWhichIntro = defineMessage({
  id: "ui.which.intro",
  defaultMessage:
    "Pick a route and a caller. When a plugin is set at several levels, the most specific one wins: consumer, then consumer group, then route, then service, as in Kong.",
  description: 'Admin UI service page: under "Which plugins run".',
});
export const uiWhichOrder = defineMessage({
  id: "ui.which.order",
  defaultMessage: "Run order follows each plugin's priority, as in Kong.",
  description: "Admin UI service page: under the which-plugins table.",
});
export const uiWhichTest = defineMessage({
  id: "ui.which.test",
  defaultMessage: "Send a test request",
  description: "Admin UI service page: link to the route tester.",
});
export const uiWhichNumber = defineMessage({
  id: "ui.which.number",
  defaultMessage: "#",
  description:
    "Admin UI service page: the which-plugins table's run-order column header.",
});
export const uiWhichPlugin = defineMessage({
  id: "ui.which.plugin",
  defaultMessage: "Plugin",
  description:
    "Admin UI service page: the which-plugins table's plugin column.",
});
export const uiWhichSetOn = defineMessage({
  id: "ui.which.setOn",
  defaultMessage: "Set on",
  description: "Admin UI service page: the which-plugins table's level column.",
});
export const uiWhichEffect = defineMessage({
  id: "ui.which.effect",
  defaultMessage: "Effect",
  description:
    "Admin UI service page: the which-plugins table's effect column.",
});
export const uiUpstreamUsedBy = defineMessage({
  id: "ui.upstream.usedBy",
  defaultMessage: "Used by service {services}",
  description:
    "Admin UI upstream page: the services whose host names this upstream.",
});
export const uiUpstreamUnused = defineMessage({
  id: "ui.upstream.unused",
  defaultMessage:
    "No service uses it yet: a service uses an upstream by naming it as its host.",
  description: "Admin UI upstream page: no service names it.",
});
export const uiUpstreamRunsAs = defineMessage({
  id: "ui.upstream.runsAs",
  defaultMessage: "(runs as {fallback})",
  description:
    "Admin UI upstream page: after an algorithm Workers runs as another.",
});
export const uiUpstreamFromTarget = defineMessage({
  id: "ui.upstream.fromTarget",
  defaultMessage: "From the target",
  description:
    "Admin UI upstream page: no host header set, so the target's host is sent.",
});
export const uiUpstreamNone = defineMessage({
  id: "ui.upstream.none",
  defaultMessage: "None",
  description: "Admin UI upstream page: an unset setting.",
});
export const uiUpstreamTargetsNote = defineMessage({
  id: "ui.upstream.targetsNote",
  defaultMessage: "Traffic share follows weight. Weight 0 takes a target out.",
  description: "Admin UI upstream page: beside the targets card's title.",
});
export const uiUpstreamOut = defineMessage({
  id: "ui.upstream.out",
  defaultMessage: "Out of rotation",
  description: "Admin UI upstream page: a target with weight 0.",
});
export const uiUpstreamNewTarget = defineMessage({
  id: "ui.upstream.newTarget",
  defaultMessage: "New target",
  description: "Admin UI upstream page: the inline new-target field's label.",
});
export const uiUpstreamTargetHint = defineMessage({
  id: "ui.upstream.targetHint",
  defaultMessage: "host:port",
  description: "Admin UI upstream page: the new-target field's placeholder.",
});
export const uiUpstreamStageTarget = defineMessage({
  id: "ui.upstream.stageTarget",
  defaultMessage: "Stage target",
  description: "Admin UI upstream page: stages the new target.",
});
export const uiUpstreamOn = defineMessage({
  id: "ui.upstream.on",
  defaultMessage: "on",
  description: "Admin UI upstream page: a health check that is set.",
});
export const uiUpstreamOff = defineMessage({
  id: "ui.upstream.off",
  defaultMessage: "off",
  description: "Admin UI upstream page: a health check that isn't set.",
});
export const uiUpstreamPassiveOn = defineMessage({
  id: "ui.upstream.passiveOn",
  defaultMessage:
    "Watches real traffic. After {failures} failures in a row, a gateway instance stops sending requests to that target for a while.",
  description: "Admin UI upstream page: passive health checks, set.",
});
export const uiUpstreamPassiveOff = defineMessage({
  id: "ui.upstream.passiveOff",
  defaultMessage: "Watches real traffic. Set a failure count to turn it on.",
  description: "Admin UI upstream page: passive health checks, not set.",
});
export const uiUpstreamActiveOn = defineMessage({
  id: "ui.upstream.activeOn",
  defaultMessage:
    "Probes {path} on each target every {interval} s, even with no traffic.",
  description: "Admin UI upstream page: active health checks, set.",
});
export const uiUpstreamActiveOff = defineMessage({
  id: "ui.upstream.activeOff",
  defaultMessage:
    "Probes each target on a schedule, even with no traffic. Set a path and an interval to turn it on.",
  description: "Admin UI upstream page: active health checks, not set.",
});
export const uiConsumerDeveloper = defineMessage({
  id: "ui.consumer.developer",
  defaultMessage: "Portal developer",
  description:
    "Admin UI consumer page: a badge on a developer-portal consumer.",
});
export const uiConsumerAllowed = defineMessage({
  id: "ui.consumer.allowed",
  defaultMessage: "Portal access allowed",
  description: "Admin UI consumer page: a portal developer who may sign in.",
});
export const uiConsumerBlocked = defineMessage({
  id: "ui.consumer.blocked",
  defaultMessage: "Portal access blocked",
  description: "Admin UI consumer page: a blocked portal developer.",
});
export const uiConsumerBlock = defineMessage({
  id: "ui.consumer.block",
  defaultMessage: "Block portal access",
  description: "Admin UI consumer page: blocks a portal developer.",
});
export const uiConsumerBlockConfirm = defineMessage({
  id: "ui.consumer.blockConfirm",
  defaultMessage:
    "Block {name} from the portal? Their API keys are deleted and the gateways stop accepting them within about a second.",
  description: "Admin UI consumer page: the block dialog's body.",
});
export const uiConsumerUnblock = defineMessage({
  id: "ui.consumer.unblock",
  defaultMessage: "Unblock portal access",
  description:
    "Admin UI consumer page: lets a blocked portal developer sign in again.",
});
export const uiConsumerUnblockConfirm = defineMessage({
  id: "ui.consumer.unblockConfirm",
  defaultMessage:
    "Let {name} sign in to the portal again? Their old keys stay deleted; they can make new ones.",
  description: "Admin UI consumer page: the unblock dialog's body.",
});
export const uiConsumerPlugins = defineMessage({
  id: "ui.consumer.plugins",
  defaultMessage: "Plugins on this consumer",
  description: "Admin UI consumer page: the plugins card.",
});
export const uiConsumerAddToGroup = defineMessage({
  id: "ui.consumer.addToGroup",
  defaultMessage: "Add to group",
  description: "Admin UI consumer page: adds an ACL group.",
});
export const uiConsumerLeaveGroup = defineMessage({
  id: "ui.consumer.leaveGroup",
  defaultMessage: "Remove from {group}",
  description:
    "Admin UI consumer page: the accessible name of an ACL chip's remove button.",
});
export const uiConsumerJwtKey = defineMessage({
  id: "ui.consumer.jwtKey",
  defaultMessage: "Key (iss)",
  description:
    "Admin UI consumer page: the JWT credentials table's key column; Kong matches it to the token's iss claim.",
});
export const uiConsumerNoGroups = defineMessage({
  id: "ui.consumer.noGroups",
  defaultMessage: "In no ACL group.",
  description: "Admin UI consumer page: no ACL groups.",
});
export const uiConsumerNoPlugins = defineMessage({
  id: "ui.consumer.noPlugins",
  defaultMessage: "No plugin is set on this consumer.",
  description: "Admin UI consumer page: no plugins.",
});
export const uiPluginEnabled = defineMessage({
  id: "ui.plugin.enabled",
  defaultMessage: "enabled",
  description: "Admin UI: a badge on an enabled plugin.",
});
export const uiPluginDisabled = defineMessage({
  id: "ui.plugin.disabled",
  defaultMessage: "disabled",
  description: "Admin UI: a badge on a disabled plugin.",
});
export const uiPluginFieldAllow = defineMessage({
  id: "ui.pluginField.allow",
  defaultMessage: "Allow",
  description:
    "Admin UI plugin form: the label of Kong's `allow` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldDeny = defineMessage({
  id: "ui.pluginField.deny",
  defaultMessage: "Deny",
  description:
    "Admin UI plugin form: the label of Kong's `deny` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldHideGroupsHeader = defineMessage({
  id: "ui.pluginField.hide_groups_header",
  defaultMessage: "Hide the groups header from the upstream",
  description:
    "Admin UI plugin form: the label of Kong's `hide_groups_header` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldAllowPatterns = defineMessage({
  id: "ui.pluginField.allow_patterns",
  defaultMessage: "Allow patterns",
  description:
    "Admin UI plugin form: the label of Kong's `allow_patterns` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldDenyPatterns = defineMessage({
  id: "ui.pluginField.deny_patterns",
  defaultMessage: "Deny patterns",
  description:
    "Admin UI plugin form: the label of Kong's `deny_patterns` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldRouteType = defineMessage({
  id: "ui.pluginField.route_type",
  defaultMessage: "Route type",
  description:
    "Admin UI plugin form: the label of Kong's `route_type` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldModel = defineMessage({
  id: "ui.pluginField.model",
  defaultMessage: "Model",
  description:
    "Admin UI plugin form: the label of Kong's `model` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldAuth = defineMessage({
  id: "ui.pluginField.auth",
  defaultMessage: "Provider credentials",
  description:
    "Admin UI plugin form: the label of Kong's `auth` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldLlmProviders = defineMessage({
  id: "ui.pluginField.llm_providers",
  defaultMessage: "Providers and limits",
  description:
    "Admin UI plugin form: the label of Kong's `llm_providers` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldWindowType = defineMessage({
  id: "ui.pluginField.window_type",
  defaultMessage: "Window",
  description:
    "Admin UI plugin form: the label of Kong's `window_type` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldStrategy = defineMessage({
  id: "ui.pluginField.strategy",
  defaultMessage: "Strategy",
  description:
    "Admin UI plugin form: the label of Kong's `strategy` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldHideCredentials = defineMessage({
  id: "ui.pluginField.hide_credentials",
  defaultMessage: "Hide credentials from the upstream",
  description:
    "Admin UI plugin form: the label of Kong's `hide_credentials` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldAnonymous = defineMessage({
  id: "ui.pluginField.anonymous",
  defaultMessage: "Anonymous consumer",
  description:
    "Admin UI plugin form: the label of Kong's `anonymous` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldRealm = defineMessage({
  id: "ui.pluginField.realm",
  defaultMessage: "Realm",
  description:
    "Admin UI plugin form: the label of Kong's `realm` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldHeaderName = defineMessage({
  id: "ui.pluginField.header_name",
  defaultMessage: "Header",
  description:
    "Admin UI plugin form: the label of Kong's `header_name` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldGenerator = defineMessage({
  id: "ui.pluginField.generator",
  defaultMessage: "Generator",
  description:
    "Admin UI plugin form: the label of Kong's `generator` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldEchoDownstream = defineMessage({
  id: "ui.pluginField.echo_downstream",
  defaultMessage: "Echo it back to the client",
  description:
    "Admin UI plugin form: the label of Kong's `echo_downstream` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldOrigins = defineMessage({
  id: "ui.pluginField.origins",
  defaultMessage: "Origins",
  description:
    "Admin UI plugin form: the label of Kong's `origins` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldMethods = defineMessage({
  id: "ui.pluginField.methods",
  defaultMessage: "Methods",
  description:
    "Admin UI plugin form: the label of Kong's `methods` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldHeaders = defineMessage({
  id: "ui.pluginField.headers",
  defaultMessage: "Headers",
  description:
    "Admin UI plugin form: the label of Kong's `headers` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldCredentials = defineMessage({
  id: "ui.pluginField.credentials",
  defaultMessage: "Allow credentials",
  description:
    "Admin UI plugin form: the label of Kong's `credentials` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldMaxAge = defineMessage({
  id: "ui.pluginField.max_age",
  defaultMessage: "Max age (s)",
  description:
    "Admin UI plugin form: the label of Kong's `max_age` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldHttpEndpoint = defineMessage({
  id: "ui.pluginField.http_endpoint",
  defaultMessage: "Endpoint",
  description:
    "Admin UI plugin form: the label of Kong's `http_endpoint` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldMethod = defineMessage({
  id: "ui.pluginField.method",
  defaultMessage: "Method",
  description:
    "Admin UI plugin form: the label of Kong's `method` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldContentType = defineMessage({
  id: "ui.pluginField.content_type",
  defaultMessage: "Content type",
  description:
    "Admin UI plugin form: the label of Kong's `content_type` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldStatus = defineMessage({
  id: "ui.pluginField.status",
  defaultMessage: "Status code",
  description:
    "Admin UI plugin form: the label of Kong's `status` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldMessage = defineMessage({
  id: "ui.pluginField.message",
  defaultMessage: "Message",
  description:
    "Admin UI plugin form: the label of Kong's `message` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldKeyClaimName = defineMessage({
  id: "ui.pluginField.key_claim_name",
  defaultMessage: "Key claim",
  description:
    "Admin UI plugin form: the label of Kong's `key_claim_name` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldClaimsToVerify = defineMessage({
  id: "ui.pluginField.claims_to_verify",
  defaultMessage: "Claims to verify",
  description:
    "Admin UI plugin form: the label of Kong's `claims_to_verify` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldHeaderNames = defineMessage({
  id: "ui.pluginField.header_names",
  defaultMessage: "Header names",
  description:
    "Admin UI plugin form: the label of Kong's `header_names` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldUriParamNames = defineMessage({
  id: "ui.pluginField.uri_param_names",
  defaultMessage: "Query parameters",
  description:
    "Admin UI plugin form: the label of Kong's `uri_param_names` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldKeyNames = defineMessage({
  id: "ui.pluginField.key_names",
  defaultMessage: "Key names",
  description:
    "Admin UI plugin form: the label of Kong's `key_names` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldKeyInHeader = defineMessage({
  id: "ui.pluginField.key_in_header",
  defaultMessage: "Read keys from headers",
  description:
    "Admin UI plugin form: the label of Kong's `key_in_header` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldKeyInQuery = defineMessage({
  id: "ui.pluginField.key_in_query",
  defaultMessage: "Read keys from the query",
  description:
    "Admin UI plugin form: the label of Kong's `key_in_query` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldKeyInBody = defineMessage({
  id: "ui.pluginField.key_in_body",
  defaultMessage: "Read keys from the body",
  description:
    "Admin UI plugin form: the label of Kong's `key_in_body` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldIssuer = defineMessage({
  id: "ui.pluginField.issuer",
  defaultMessage: "Issuer",
  description:
    "Admin UI plugin form: the label of Kong's `issuer` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldClientId = defineMessage({
  id: "ui.pluginField.client_id",
  defaultMessage: "Client ID",
  description:
    "Admin UI plugin form: the label of Kong's `client_id` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldClientSecret = defineMessage({
  id: "ui.pluginField.client_secret",
  defaultMessage: "Client secret",
  description:
    "Admin UI plugin form: the label of Kong's `client_secret` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldAuthMethods = defineMessage({
  id: "ui.pluginField.auth_methods",
  defaultMessage: "Sign-in methods",
  description:
    "Admin UI plugin form: the label of Kong's `auth_methods` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldScopes = defineMessage({
  id: "ui.pluginField.scopes",
  defaultMessage: "Scopes",
  description:
    "Admin UI plugin form: the label of Kong's `scopes` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldCacheTtl = defineMessage({
  id: "ui.pluginField.cache_ttl",
  defaultMessage: "Cache TTL (s)",
  description:
    "Admin UI plugin form: the label of Kong's `cache_ttl` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldResponseCode = defineMessage({
  id: "ui.pluginField.response_code",
  defaultMessage: "Response codes",
  description:
    "Admin UI plugin form: the label of Kong's `response_code` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldRequestMethod = defineMessage({
  id: "ui.pluginField.request_method",
  defaultMessage: "Request methods",
  description:
    "Admin UI plugin form: the label of Kong's `request_method` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldSecond = defineMessage({
  id: "ui.pluginField.second",
  defaultMessage: "Per second",
  description:
    "Admin UI plugin form: the label of Kong's `second` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldMinute = defineMessage({
  id: "ui.pluginField.minute",
  defaultMessage: "Per minute",
  description:
    "Admin UI plugin form: the label of Kong's `minute` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldHour = defineMessage({
  id: "ui.pluginField.hour",
  defaultMessage: "Per hour",
  description:
    "Admin UI plugin form: the label of Kong's `hour` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldDay = defineMessage({
  id: "ui.pluginField.day",
  defaultMessage: "Per day",
  description:
    "Admin UI plugin form: the label of Kong's `day` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldLimitBy = defineMessage({
  id: "ui.pluginField.limit_by",
  defaultMessage: "Count requests by",
  description:
    "Admin UI plugin form: the label of Kong's `limit_by` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldPolicy = defineMessage({
  id: "ui.pluginField.policy",
  defaultMessage: "Counter store",
  description:
    "Admin UI plugin form: the label of Kong's `policy` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldFaultTolerant = defineMessage({
  id: "ui.pluginField.fault_tolerant",
  defaultMessage: "Keep serving if the counter store fails",
  description:
    "Admin UI plugin form: the label of Kong's `fault_tolerant` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldHideClientHeaders = defineMessage({
  id: "ui.pluginField.hide_client_headers",
  defaultMessage: "Hide rate-limit headers from clients",
  description:
    "Admin UI plugin form: the label of Kong's `hide_client_headers` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldAllowedPayloadSize = defineMessage({
  id: "ui.pluginField.allowed_payload_size",
  defaultMessage: "Largest body",
  description:
    "Admin UI plugin form: the label of Kong's `allowed_payload_size` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldSizeUnit = defineMessage({
  id: "ui.pluginField.size_unit",
  defaultMessage: "Unit",
  description:
    "Admin UI plugin form: the label of Kong's `size_unit` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldRequireContentLength = defineMessage({
  id: "ui.pluginField.require_content_length",
  defaultMessage: "Require a Content-Length",
  description:
    "Admin UI plugin form: the label of Kong's `require_content_length` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldStatusCode = defineMessage({
  id: "ui.pluginField.status_code",
  defaultMessage: "Status code",
  description:
    "Admin UI plugin form: the label of Kong's `status_code` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldBody = defineMessage({
  id: "ui.pluginField.body",
  defaultMessage: "Body",
  description:
    "Admin UI plugin form: the label of Kong's `body` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldAdd = defineMessage({
  id: "ui.pluginField.add",
  defaultMessage: "Add",
  description:
    "Admin UI plugin form: the label of Kong's `add` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldRemove = defineMessage({
  id: "ui.pluginField.remove",
  defaultMessage: "Remove",
  description:
    "Admin UI plugin form: the label of Kong's `remove` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldRename = defineMessage({
  id: "ui.pluginField.rename",
  defaultMessage: "Rename",
  description:
    "Admin UI plugin form: the label of Kong's `rename` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldReplace = defineMessage({
  id: "ui.pluginField.replace",
  defaultMessage: "Replace",
  description:
    "Admin UI plugin form: the label of Kong's `replace` config field where a plugin's layout puts it first.",
});
export const uiPluginFieldAppend = defineMessage({
  id: "ui.pluginField.append",
  defaultMessage: "Append",
  description:
    "Admin UI plugin form: the label of Kong's `append` config field where a plugin's layout puts it first.",
});
export const uiPluginGroupGroups = defineMessage({
  id: "ui.pluginGroup.groups",
  defaultMessage: "Groups",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupPatterns = defineMessage({
  id: "ui.pluginGroup.patterns",
  defaultMessage: "Patterns",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupModel = defineMessage({
  id: "ui.pluginGroup.model",
  defaultMessage: "Model",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupLimits = defineMessage({
  id: "ui.pluginGroup.limits",
  defaultMessage: "Limits",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupCredentials = defineMessage({
  id: "ui.pluginGroup.credentials",
  defaultMessage: "Credentials",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupRequestId = defineMessage({
  id: "ui.pluginGroup.requestId",
  defaultMessage: "Request ID",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupOrigins = defineMessage({
  id: "ui.pluginGroup.origins",
  defaultMessage: "Origins",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupDestination = defineMessage({
  id: "ui.pluginGroup.destination",
  defaultMessage: "Where logs go",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupAddresses = defineMessage({
  id: "ui.pluginGroup.addresses",
  defaultMessage: "Addresses",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupTokens = defineMessage({
  id: "ui.pluginGroup.tokens",
  defaultMessage: "Tokens",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupKeys = defineMessage({
  id: "ui.pluginGroup.keys",
  defaultMessage: "Keys",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupProvider = defineMessage({
  id: "ui.pluginGroup.provider",
  defaultMessage: "Identity provider",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupCaching = defineMessage({
  id: "ui.pluginGroup.caching",
  defaultMessage: "Caching",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupSize = defineMessage({
  id: "ui.pluginGroup.size",
  defaultMessage: "Size",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupResponse = defineMessage({
  id: "ui.pluginGroup.response",
  defaultMessage: "Response",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginGroupChanges = defineMessage({
  id: "ui.pluginGroup.changes",
  defaultMessage: "Changes",
  description: "Admin UI plugin form: the title of a group of common fields.",
});
export const uiPluginsAddTitle = defineMessage({
  id: "ui.plugins.addTitle",
  defaultMessage: "Add {name}",
  description:
    "Admin UI plugin form: the page title; {name} is the plugin's Kong name, in mono.",
});
export const uiPluginsEditTitle = defineMessage({
  id: "ui.plugins.editTitle",
  defaultMessage: "Edit {name}",
  description: "Admin UI plugin form: the edit page's title.",
});
export const uiPluginsSchemaNote = defineMessage({
  id: "ui.plugins.schemaNote",
  defaultMessage: "Fields come from Kong's schema for this plugin.",
  description:
    "Admin UI plugin form: after the plugin's description, under the title.",
});
export const uiPluginsWhere = defineMessage({
  id: "ui.plugins.where",
  defaultMessage: "Where it applies",
  description: "Admin UI plugin form: the scope card's title.",
});
export const uiPluginsHintGlobal = defineMessage({
  id: "ui.plugins.hintGlobal",
  defaultMessage: "Every request",
  description: "Admin UI plugin form: the hint on the Global scope card.",
});
export const uiPluginsHintService = defineMessage({
  id: "ui.plugins.hintService",
  defaultMessage: "All its routes",
  description: "Admin UI plugin form: the hint on the Service scope card.",
});
export const uiPluginsHintRoute = defineMessage({
  id: "ui.plugins.hintRoute",
  defaultMessage: "One route",
  description: "Admin UI plugin form: the hint on the Route scope card.",
});
export const uiPluginsHintConsumer = defineMessage({
  id: "ui.plugins.hintConsumer",
  defaultMessage: "One caller",
  description: "Admin UI plugin form: the hint on the Consumer scope card.",
});
export const uiPluginsAdvanced = defineMessage({
  id: "ui.plugins.advanced",
  defaultMessage:
    "Advanced ({count, plural, one {# more field} other {# more fields}})",
  description:
    "Admin UI plugin form: the folded group of the plugin's other fields.",
});
export const uiPluginsSettings = defineMessage({
  id: "ui.plugins.settings",
  defaultMessage: "Settings",
  description:
    "Admin UI plugin form: the group of a plugin without a layout: its required fields.",
});
export const uiPluginsLimitsHint = defineMessage({
  id: "ui.plugins.limitsHint",
  defaultMessage: "Set at least one. Empty means no limit for that window.",
  description: "Admin UI plugin form: under rate-limiting's Limits title.",
});
export const uiPluginsPolicyHint = defineMessage({
  id: "ui.plugins.policyHint",
  defaultMessage:
    "local counts per isolate; cluster and redis share one count.",
  description: "Admin UI plugin form: under rate-limiting's counter store.",
});
export const uiPluginsCallers = defineMessage({
  id: "ui.plugins.callers",
  defaultMessage: "What callers see",
  description: "Admin UI plugin form: the card on what a refused caller gets.",
});
export const uiPluginsCallersRefused = defineMessage({
  id: "ui.plugins.callersRefused",
  defaultMessage: "A caller it refuses gets {status} with code {code}.",
  description:
    "Admin UI plugin form: what a refused caller gets; {code} links to its docs page.",
});
export const uiPluginsCallersRateLimited = defineMessage({
  id: "ui.plugins.callersRateLimited",
  defaultMessage:
    "Over the limit, the gateway answers {status} with code {code} and a Retry-After header.",
  description: "Admin UI plugin form: what a rate-limited caller gets.",
});
export const uiPluginsStageNote = defineMessage({
  id: "ui.plugins.stageNote",
  defaultMessage: "Staged plugins go live when you publish.",
  description: 'Admin UI plugin form: the line beside "Stage plugin".',
});
export const uiConfigStagedAgainst = defineMessage({
  id: "ui.config.stagedAgainst",
  defaultMessage: "Staged against version {version}",
  description: "Admin UI publish page: the changes card's title.",
});
export const uiConfigStagedFirst = defineMessage({
  id: "ui.config.stagedFirst",
  defaultMessage: "Staged, not yet published",
  description:
    "Admin UI publish page: the changes card's title before any publish.",
});
export const uiConfigPublishCount = defineMessage({
  id: "ui.config.publishCount",
  defaultMessage: "Publish {count, plural, one {# change} other {# changes}}",
  description: "Admin UI publish page: the side card's title.",
});
export const uiConfigPublishVersion = defineMessage({
  id: "ui.config.publishVersion",
  defaultMessage: "Publish version {version}",
  description:
    "Admin UI publish page: the publish button, naming the version it makes.",
});
export const uiConfigShowDiff = defineMessage({
  id: "ui.config.showDiff",
  defaultMessage:
    "Show the diff: the changed entities, as published and as staged",
  description: "Admin UI publish page: the folded side-by-side diff.",
});
export const uiConfigWarningsAhead = defineMessage({
  id: "ui.config.warningsAhead",
  defaultMessage: "Publish goes ahead with these warnings:",
  description:
    "Admin UI publish page: before the warnings publishing now would give.",
});
export const uiAuditIntro = defineMessage({
  id: "ui.audit.intro",
  defaultMessage: "Every change, publish and rollback, newest first.",
  description: "Admin UI audit log: under the title.",
});
export const uiAuditWhoHint = defineMessage({
  id: "ui.audit.whoHint",
  defaultMessage: "Email or token name",
  description:
    "Admin UI audit log: the who filter's placeholder; it matches the whole identity.",
});
export const uiAuditAnyEntity = defineMessage({
  id: "ui.audit.anyEntity",
  defaultMessage: "Any entity",
  description: "Admin UI audit log: the entity filter when it's off.",
});
export const uiAuditWhat = defineMessage({
  id: "ui.audit.what",
  defaultMessage: "What",
  description: "Admin UI audit log: the column naming the entity.",
});
export const uiAuditNamed = defineMessage({
  id: "ui.audit.named",
  defaultMessage: "{type} {name}",
  description:
    'Admin UI audit log: what an event changed, such as "route public-ip"; {type} is the singular entity type.',
});
export const uiAuditScoped = defineMessage({
  id: "ui.audit.scoped",
  defaultMessage: "{type} on {scopeType} {scope}",
  description:
    'Admin UI audit log: an entity without a name of its own, by what it belongs to, such as "API key on consumer partner-a".',
});
export const uiAuditNamedOn = defineMessage({
  id: "ui.audit.namedOn",
  defaultMessage: "{type} {name} on {scopeType} {scope}",
  description:
    'Admin UI audit log: a plugin event, such as "plugin rate-limiting on route httpbin-anything".',
});
export const uiAuditOpen = defineMessage({
  id: "ui.audit.open",
  defaultMessage: "Open {entity}",
  description:
    "Admin UI audit log: link from an expanded event to its entity's page.",
});
export const uiEntityConsumerGroupConsumers = defineMessage({
  id: "ui.entity.consumerGroupConsumers",
  defaultMessage: "group membership",
  description:
    "Admin UI: one consumer's membership of a consumer group, lower case, in the audit log.",
});
export const uiTesterOrder = defineMessage({
  id: "ui.tester.order",
  defaultMessage: "Plugins, in the order they ran",
  description: "Admin UI route tester: above the trace table.",
});
export const uiTesterResponseHeaders = defineMessage({
  id: "ui.tester.responseHeaders",
  defaultMessage: "Response headers",
  description: "Admin UI route tester: the response's headers.",
});
export const uiTesterResponseBody = defineMessage({
  id: "ui.tester.responseBody",
  defaultMessage: "Response body",
  description: "Admin UI route tester: the response's body.",
});
export const uiVaultsIntro = defineMessage({
  id: "ui.vaults.intro",
  defaultMessage:
    "Secrets stay in Cloudflare. Config holds only a reference, and the gateway reads the secret when a request needs it.",
  description: "Admin UI vaults page: under the title.",
});
export const uiVaultsBuiltIn = defineMessage({
  id: "ui.vaults.builtIn",
  defaultMessage: "built in",
  description:
    "Admin UI vaults page: the badge on a vault the gateway always has.",
});
export const uiVaultsEnvCard = defineMessage({
  id: "ui.vaults.envCard",
  defaultMessage: "Reads a Worker secret on the gateway.",
  description: "Admin UI vaults page: what the env vault reads.",
});
export const uiVaultsStoreCard = defineMessage({
  id: "ui.vaults.storeCard",
  defaultMessage: "Reads a Secrets Store binding on the gateway.",
  description: "Admin UI vaults page: what the cf-secrets-store vault reads.",
});
export const uiVaultsMake = defineMessage({
  id: "ui.vaults.make",
  defaultMessage: "Make a reference",
  description: "Admin UI vaults page: the reference builder's card.",
});
export const uiVaultsUnchecked = defineMessage({
  id: "ui.vaults.unchecked",
  defaultMessage:
    "The admin can't see the gateway's secrets, so it doesn't check that this one exists. A request that needs a missing secret fails.",
  description: "Admin UI vaults page: under the built reference.",
});
export const uiVaultsEntities = defineMessage({
  id: "ui.vaults.entities",
  defaultMessage: "Your vault entities",
  description: "Admin UI vaults page: the card of Kong vault entities.",
});
export const uiVaultsEntitiesHint = defineMessage({
  id: "ui.vaults.entitiesHint",
  defaultMessage: "Kong-style vaults: your own prefix over a built-in vault.",
  description: 'Admin UI vaults page: under "Your vault entities".',
});
export const uiVaultsEntityPrefix = defineMessage({
  id: "ui.vaults.entityPrefix",
  defaultMessage: "prefix {reference}",
  description: "Admin UI vaults page: a vault entity's reference form.",
});
export const uiVaultsNone = defineMessage({
  id: "ui.vaults.none",
  defaultMessage: "No vault entities yet: the built-in vaults need none.",
  description: "Admin UI vaults page: no vault entities.",
});
export const uiVaultsRawTitle = defineMessage({
  id: "ui.vaults.rawTitle",
  defaultMessage: "Secrets kept as plain text",
  description:
    "Admin UI vaults page: the warning card of plugin secrets stored raw.",
});
export const uiVaultsRawHint = defineMessage({
  id: "ui.vaults.rawHint",
  defaultMessage:
    "The same fields publish warns about. Move each one to a vault.",
  description: 'Admin UI vaults page: under "Secrets kept as plain text".',
});
export const uiVaultsRawFields = defineMessage({
  id: "ui.vaults.rawFields",
  defaultMessage: "{count, plural, one {field} other {fields}} {fields}",
  description: "Admin UI vaults page: a plugin's raw secret fields.",
});
export const uiCertIssuer = defineMessage({
  id: "ui.cert.issuer",
  defaultMessage: "Issuer {issuer}",
  description: "Admin UI certificates: under a certificate's subject.",
});
export const uiCertKeyType = defineMessage({
  id: "ui.cert.keyType",
  defaultMessage: "Key type",
  description: "Admin UI certificates: the key-type column.",
});
export const uiCertReplace = defineMessage({
  id: "ui.cert.replace",
  defaultMessage: "Replace",
  description:
    "Admin UI certificates: edits an expired or expiring certificate to put the renewed one in.",
});
export const uiCertView = defineMessage({
  id: "ui.cert.view",
  defaultMessage: "View",
  description: "Admin UI certificates: opens a certificate.",
});
export const uiCertRead = defineMessage({
  id: "ui.cert.read",
  defaultMessage: "Read: {subject}, expires {date}, {keyType}",
  description: "Admin UI certificates: what the pasted PEM says, under it.",
});
export const uiCertStage = defineMessage({
  id: "ui.cert.stage",
  defaultMessage: "Stage certificate",
  description: "Admin UI certificates: stages the new certificate.",
});
export const uiCertPrivateKey = defineMessage({
  id: "ui.cert.privateKey",
  defaultMessage: "Private key (vault reference)",
  description: "Admin UI certificates: the add form's key field.",
});
export const uiListFilter = defineMessage({
  id: "ui.list.filter",
  defaultMessage: "Filter this page",
  description:
    "Admin UI lists other than routes: the search box's placeholder and label; it filters the rows on this page.",
});
export const uiListPrevious = defineMessage({
  id: "ui.list.previous",
  defaultMessage: "Previous",
  description:
    "Admin UI lists: the previous-page button; Kong's cursor paging has no totals.",
});
export const uiListNext = defineMessage({
  id: "ui.list.next",
  defaultMessage: "Next page",
  description: "Admin UI lists: the next-page button.",
});
export const uiFilterServiceAny = defineMessage({
  id: "ui.filter.serviceAny",
  defaultMessage: "Service: any",
  description: "Admin UI routes list: the service filter when it's off.",
});
export const uiFilterMethodAny = defineMessage({
  id: "ui.filter.methodAny",
  defaultMessage: "Method: any",
  description: "Admin UI routes list: the method filter when it's off.",
});
export const uiRoutesPlugins = defineMessage({
  id: "ui.routes.plugins",
  defaultMessage: "Plugins",
  description:
    "Admin UI routes list: the column of plugins that apply to each route (on it, its service, or everywhere).",
});
export const uiRoutesNoPlugins = defineMessage({
  id: "ui.routes.noPlugins",
  defaultMessage: "None",
  description: "Admin UI routes list: a route no plugin applies to.",
});
export const uiRoutesAnyHost = defineMessage({
  id: "ui.routes.anyHost",
  defaultMessage: "Any host",
  description:
    "Admin UI routes list: a route with no hosts matches every host.",
});
export const uiRoutesAnyMethod = defineMessage({
  id: "ui.routes.anyMethod",
  defaultMessage: "ANY",
  description:
    "Admin UI routes list: the badge for a route with no methods, which matches every method.",
});
export const uiFormNameHint = defineMessage({
  id: "ui.form.nameHint",
  defaultMessage: "Letters, digits, dots, dashes and underscores.",
  description: "Admin UI entity form: help under the name field.",
});
export const uiFormCreateService = defineMessage({
  id: "ui.form.createService",
  defaultMessage: "Create a service",
  description:
    "Admin UI route form: link under the service picker to the service form.",
});
export const uiFormMatchesHint = defineMessage({
  id: "ui.form.matchesHint",
  defaultMessage: "Set at least one of paths, hosts or methods.",
  description: 'Admin UI route form: help at the top of "What it matches".',
});
export const uiFormPathInvalid = defineMessage({
  id: "ui.form.pathInvalid",
  defaultMessage: 'A path starts with "/". Regex paths start with "~/".',
  description:
    "Admin UI route form: the error under a path that Kong wouldn't accept.",
});
export const uiFormMethodsHint = defineMessage({
  id: "ui.form.methodsHint",
  defaultMessage: "None checked matches every method.",
  description: "Admin UI route form: help under the method checkboxes.",
});
export const uiFormRouteAdvanced = defineMessage({
  id: "ui.form.routeAdvanced",
  defaultMessage:
    "Advanced: protocols, strip path, preserve host, regex priority",
  description:
    "Admin UI route form: the folded section's summary, naming what's in it.",
});
export const uiFormStagePlugin = defineMessage({
  id: "ui.form.stagePlugin",
  defaultMessage: "Stage plugin",
  description:
    "Admin UI uploaded-plugin form: the submit button; the plugin is staged, not live.",
});
export const uiFormStagePluginNote = defineMessage({
  id: "ui.form.stagePluginNote",
  defaultMessage:
    "Then add it to a route or service like any plugin, and publish.",
  description:
    "Admin UI uploaded-plugin form: the line beside the stage button.",
});
export const uiFormStageRouteNote = defineMessage({
  id: "ui.form.stageRouteNote",
  defaultMessage: "Staged routes go live when you publish.",
  description: "Admin UI route form: the line beside the stage button.",
});
export const uiSandboxCode = defineMessage({
  id: "ui.sandbox.code",
  defaultMessage: "Code",
  description: "Admin UI upload form: the code card's title.",
});
export const uiSandboxDrop = defineMessage({
  id: "ui.sandbox.drop",
  defaultMessage: "Drop an ES module here, or choose a file",
  description: "Admin UI upload form: the drop zone.",
});
export const uiSandboxDropHint = defineMessage({
  id: "ui.sandbox.dropHint",
  defaultMessage: "One .js file, up to {kib} KB",
  description: "Admin UI upload form: under the drop zone.",
});
export const uiSandboxFile = defineMessage({
  id: "ui.sandbox.file",
  defaultMessage: "{kib} KB",
  description: "Admin UI upload form: the code's size in its summary.",
});
export const uiSandboxNoFile = defineMessage({
  id: "ui.sandbox.noFile",
  defaultMessage: "No code yet: choose a file, or write it in the editor.",
  description: "Admin UI upload form: before any code is chosen.",
});
export const uiSandboxViewSource = defineMessage({
  id: "ui.sandbox.viewSource",
  defaultMessage: "View source",
  description: "Admin UI upload form: opens the code in the editor.",
});
export const uiSandboxHideSource = defineMessage({
  id: "ui.sandbox.hideSource",
  defaultMessage: "Hide source",
  description: "Admin UI upload form: closes the editor.",
});
export const uiSandboxPriorityHint = defineMessage({
  id: "ui.sandbox.priorityHint",
  defaultMessage: "Higher runs earlier, as in Kong.",
  description: "Admin UI upload form: help under priority.",
});
export const uiSandboxLimitsTitle = defineMessage({
  id: "ui.sandbox.limitsTitle",
  defaultMessage: "Limits, per request",
  description: "Admin UI upload form: the limits card's title.",
});
export const uiSandboxDefault = defineMessage({
  id: "ui.sandbox.default",
  defaultMessage: "Default {value}",
  description:
    "Admin UI upload form: under a limit slider, the sandbox's default.",
});
export const uiSandboxMost = defineMessage({
  id: "ui.sandbox.most",
  defaultMessage: "Most {value}",
  description:
    "Admin UI upload form: under a limit slider, the sandbox's maximum.",
});
export const uiSandboxMs = defineMessage({
  id: "ui.sandbox.ms",
  defaultMessage: "{value} ms",
  description: "Admin UI upload form: a CPU time in milliseconds.",
});
export const uiSandboxBindings = defineMessage({
  id: "ui.sandbox.bindings",
  defaultMessage: "Bindings it may use",
  description: "Admin UI upload form: the bindings group's label.",
});
export const uiSandboxAddBinding = defineMessage({
  id: "ui.sandbox.addBinding",
  defaultMessage: "Add a binding",
  description:
    "Admin UI upload form: names a binding the plugin may use, added as a checked checkbox.",
});
export const uiSandboxBindingsAllow = defineMessage({
  id: "ui.sandbox.bindingsAllow",
  defaultMessage:
    "The plugin gets a checked binding only if the gateway allows it.",
  description: "Admin UI upload form: under the bindings once one is checked.",
});
export const uiSandboxBindingsNone = defineMessage({
  id: "ui.sandbox.bindingsNone",
  defaultMessage:
    "None checked: the plugin can only read and change the request and response.",
  description: "Admin UI upload form: under the bindings.",
});
export const uiRoleSignedInWith = defineMessage({
  id: "ui.role.signedInWith",
  defaultMessage: "Signed in with Cloudflare Access",
  description: "Admin UI sidebar footer: under the signed-in identity.",
});
export const uiPaletteJump = defineMessage({
  id: "ui.palette.jump",
  defaultMessage: "Jump to…",
  description: "Admin UI sidebar: the button that opens the ⌘K palette.",
});
export const uiNavConsumers = defineMessage({
  id: "ui.nav.consumers",
  defaultMessage: "Consumers",
  description: "Admin UI resource: API consumers.",
});
export const uiNavConsumerGroups = defineMessage({
  id: "ui.nav.consumerGroups",
  defaultMessage: "Consumer groups",
  description: "Admin UI resource: consumer groups.",
});
export const uiNavKeyAuth = defineMessage({
  id: "ui.nav.keyAuth",
  defaultMessage: "API keys",
  description: "Admin UI resource: key-auth credentials.",
});
export const uiNavBasicAuth = defineMessage({
  id: "ui.nav.basicAuth",
  defaultMessage: "Basic auth",
  description: "Admin UI resource: basic-auth credentials.",
});
export const uiNavJwtSecrets = defineMessage({
  id: "ui.nav.jwtSecrets",
  defaultMessage: "JWT credentials",
  description: "Admin UI resource: JWT credentials.",
});
export const uiNavAcls = defineMessage({
  id: "ui.nav.acls",
  defaultMessage: "ACL groups",
  description: "Admin UI resource: ACL group memberships.",
});
export const uiNavPlugins = defineMessage({
  id: "ui.nav.plugins",
  defaultMessage: "Plugins",
  description: "Admin UI resource: plugin instances.",
});
export const uiNavCertificates = defineMessage({
  id: "ui.nav.certificates",
  defaultMessage: "Certificates",
  description: "Admin UI resource: TLS certificates.",
});
export const uiNavCaCertificates = defineMessage({
  id: "ui.nav.caCertificates",
  defaultMessage: "CA certificates",
  description: "Admin UI resource: CA certificates.",
});
export const uiNavSnis = defineMessage({
  id: "ui.nav.snis",
  defaultMessage: "SNIs",
  description: "Admin UI resource: server names for certificates.",
});
export const uiNavVaults = defineMessage({
  id: "ui.nav.vaults",
  defaultMessage: "Vaults",
  description: "Admin UI resource: secret vaults.",
});
export const uiFilterTags = defineMessage({
  id: "ui.filter.tags",
  defaultMessage: "Tags (comma: all, slash: any)",
  description: "Admin UI list filter: Kong's tag filter syntax.",
});
export const uiPalettePlaceholder = defineMessage({
  id: "ui.palette.placeholder",
  defaultMessage: "Go to a page or create an entity…",
  description: "Admin UI command palette: the search box placeholder.",
});
export const uiPaletteEmpty = defineMessage({
  id: "ui.palette.empty",
  defaultMessage: "Nothing matches.",
  description: "Admin UI command palette: no results.",
});
export const uiPaletteGoTo = defineMessage({
  id: "ui.palette.goTo",
  defaultMessage: "Go to",
  description: "Admin UI command palette: the navigation group heading.",
});
export const uiPaletteCreate = defineMessage({
  id: "ui.palette.create",
  defaultMessage: "Create",
  description: "Admin UI command palette: the create group heading.",
});
export const uiPaletteCreateItem = defineMessage({
  id: "ui.palette.createItem",
  defaultMessage: "New: {resource}",
  description: "Admin UI command palette: create an entity of a resource.",
});
export const uiPaletteHint = defineMessage({
  id: "ui.palette.hint",
  defaultMessage: "Search",
  description: "Admin UI header: the button that opens the command palette.",
});
export const uiKeyShownOnce = defineMessage({
  id: "ui.keyAuth.shownOnce",
  defaultMessage: "Copy this key now: it is not shown again.",
  description: "Admin UI: a new API key is displayed only once.",
});
export const uiValidationJson = defineMessage({
  id: "ui.validation.json",
  defaultMessage: "Must be valid JSON",
  description: "Admin UI form validation: a JSON field doesn't parse.",
});
export const uiPaletteShortcut = defineMessage({
  id: "ui.palette.shortcut",
  defaultMessage: "⌘K",
  description:
    "Admin UI header: the keyboard shortcut that opens the command palette (Ctrl+K off macOS).",
});
export const errorsAdminTesterUnconfigured = defineMessage({
  id: "errors.admin.testerUnconfigured",
  defaultMessage: "The route tester has no gateway to call: set GATEWAY_URL",
  description:
    "Error title: the admin has neither a GATEWAY binding nor a GATEWAY_URL for the route tester.",
});
export const errorsAdminAnalyticsFailed = defineMessage({
  id: "errors.admin.analyticsFailed",
  defaultMessage: "Analytics Engine did not answer the overview query",
  description:
    "Error title: Cloudflare's Analytics Engine SQL API failed or refused the admin's token.",
});
export const uiNavOverview = defineMessage({
  id: "ui.nav.overview",
  defaultMessage: "Overview",
  description: "Admin UI navigation: the overview dashboard.",
});
export const uiNavPluginCatalog = defineMessage({
  id: "ui.nav.pluginCatalog",
  defaultMessage: "Plugin catalog",
  description: "Admin UI navigation: the plugin catalog page.",
});
export const uiNavConfig = defineMessage({
  id: "ui.nav.config",
  defaultMessage: "Publish",
  description:
    "Admin UI navigation: the staged-changes, publish and history page.",
});
export const uiNavTester = defineMessage({
  id: "ui.nav.tester",
  defaultMessage: "Route tester",
  description: "Admin UI navigation: the route tester page.",
});
export const uiOverviewTitle = defineMessage({
  id: "ui.overview.title",
  defaultMessage:
    "{hours, plural, one {Traffic, last hour} =168 {Traffic, last 7 days} other {Traffic, last # hours}}",
  description: "Admin UI overview: the dashboard heading.",
});
export const uiOverviewEmpty = defineMessage({
  id: "ui.overview.empty",
  defaultMessage:
    "No traffic data yet. Bind Analytics Engine to the gateway, then set CF_ACCOUNT_ID and the AE_API_TOKEN secret on the admin.",
  description:
    "Admin UI overview: shown when Analytics Engine isn't configured or has no data.",
});
export const uiOverviewRequests = defineMessage({
  id: "ui.overview.requests",
  defaultMessage: "Requests",
  description: "Admin UI overview: request count series and column.",
});
export const uiOverviewErrors = defineMessage({
  id: "ui.overview.errors",
  defaultMessage: "Server errors",
  description: "Admin UI overview: 5xx count series and column.",
});
export const uiOverviewLatency = defineMessage({
  id: "ui.overview.latency",
  defaultMessage: "Mean latency (ms)",
  description: "Admin UI overview: mean request duration series.",
});
export const uiOverviewTopRoutes = defineMessage({
  id: "ui.overview.topRoutes",
  defaultMessage: "Busiest routes",
  description: "Admin UI overview: the table of routes by request count.",
});
export const uiOverviewRoute = defineMessage({
  id: "ui.overview.route",
  defaultMessage: "Route",
  description: "Admin UI overview: route id column.",
});
export const uiOverviewP50 = defineMessage({
  id: "ui.overview.p50",
  defaultMessage: "p50 latency",
  description: "Admin UI overview: the median request duration tile.",
});
export const uiOverviewP99 = defineMessage({
  id: "ui.overview.p99",
  defaultMessage: "p99 latency",
  description: "Admin UI overview: the 99th-percentile request duration tile.",
});
export const uiOverviewMs = defineMessage({
  id: "ui.overview.ms",
  defaultMessage: "{ms, number, ::.#} ms",
  description: "Admin UI overview: a duration in milliseconds.",
});
export const uiOverviewNoValue = defineMessage({
  id: "ui.overview.noValue",
  defaultMessage: "No data",
  description:
    "Admin UI overview: a tile with nothing to show over the window.",
});
export const uiOverviewLiveConfig = defineMessage({
  id: "ui.overview.liveConfig",
  defaultMessage: "Live config",
  description: "Admin UI overview: the live config version tile.",
});
export const uiOverviewVersion = defineMessage({
  id: "ui.overview.version",
  defaultMessage: "Version {version}",
  description: "Admin UI overview: the live config version number.",
});
export const uiOverviewNothingLive = defineMessage({
  id: "ui.overview.nothingLive",
  defaultMessage: "Nothing published yet",
  description:
    "Admin UI overview: the live config tile before the first publish.",
});
export const uiOverviewLastPublish = defineMessage({
  id: "ui.overview.lastPublish",
  defaultMessage: "Last publish: version {version}, {when}, by {who}",
  description:
    "Admin UI overview: the newest published version, its time and its publisher.",
});
export const uiOverviewTopConsumers = defineMessage({
  id: "ui.overview.topConsumers",
  defaultMessage: "Busiest consumers",
  description: "Admin UI overview: the table of consumers by request count.",
});
export const uiOverviewConsumer = defineMessage({
  id: "ui.overview.consumer",
  defaultMessage: "Consumer",
  description: "Admin UI overview: consumer id column.",
});
export const uiPluginsTitle = defineMessage({
  id: "ui.plugins.title",
  defaultMessage: "Plugin catalog",
  description: "Admin UI plugin catalog: page heading.",
});
export const uiPluginsAdd = defineMessage({
  id: "ui.plugins.add",
  defaultMessage: "Add",
  description:
    "Admin UI plugin catalog: button that opens a plugin's configuration form.",
});
export const uiPluginsScope = defineMessage({
  id: "ui.plugins.scope",
  defaultMessage: "Apply to",
  description: "Admin UI plugin form: label of the scope picker.",
});
export const uiPluginsAdded = defineMessage({
  id: "ui.plugins.added",
  defaultMessage: "Plugin added. Publish to apply it.",
  description:
    "Admin UI plugin form: notification after the plugin was staged.",
});
export const uiCategoryAuthentication = defineMessage({
  id: "ui.category.authentication",
  defaultMessage: "Authentication",
  description: "Admin UI plugin catalog category.",
});
export const uiCategorySecurity = defineMessage({
  id: "ui.category.security",
  defaultMessage: "Security",
  description: "Admin UI plugin catalog category.",
});
export const uiCategoryTrafficControl = defineMessage({
  id: "ui.category.trafficControl",
  defaultMessage: "Traffic control",
  description: "Admin UI plugin catalog category.",
});
export const uiCategoryTransformations = defineMessage({
  id: "ui.category.transformations",
  defaultMessage: "Transformations",
  description: "Admin UI plugin catalog category.",
});
export const uiCategoryLogging = defineMessage({
  id: "ui.category.logging",
  defaultMessage: "Logging",
  description: "Admin UI plugin catalog category.",
});
export const uiCategoryAi = defineMessage({
  id: "ui.category.ai",
  defaultMessage: "AI",
  description: "Admin UI plugin catalog category.",
});
export const uiCategoryOther = defineMessage({
  id: "ui.category.other",
  defaultMessage: "Other",
  description: "Admin UI plugin catalog category.",
});
export const uiConfigTitle = defineMessage({
  id: "ui.config.title",
  defaultMessage: "Publish staged changes",
  description: "Admin UI publish page: heading over the diff.",
});
export const uiConfigPublished = defineMessage({
  id: "ui.config.published",
  defaultMessage: "Published (version {version})",
  description: "Admin UI publish page: left side of the diff.",
});
export const uiConfigNothingPublished = defineMessage({
  id: "ui.config.nothingPublished",
  defaultMessage: "Nothing published yet",
  description:
    "Admin UI publish page: left side of the diff before the first publish.",
});
export const uiConfigStaged = defineMessage({
  id: "ui.config.staged",
  defaultMessage: "Staged",
  description: "Admin UI publish page: right side of the diff.",
});
export const uiConfigViewJson = defineMessage({
  id: "ui.config.viewJson",
  defaultMessage: "JSON",
  description: "Admin UI publish page: show the snapshots as JSON.",
});
export const uiConfigViewDeck = defineMessage({
  id: "ui.config.viewDeck",
  defaultMessage: "decK / YAML",
  description:
    "Admin UI publish page: show the snapshots as a decK-style YAML file.",
});
export const uiConfigNote = defineMessage({
  id: "ui.config.note",
  defaultMessage: "Note",
  description:
    "Admin UI publish page: optional note recorded with the publish.",
});
export const uiConfigPublish = defineMessage({
  id: "ui.config.publish",
  defaultMessage: "Publish",
  description: "Admin UI publish page: publish button.",
});
export const uiConfigPublishDone = defineMessage({
  id: "ui.config.publishDone",
  defaultMessage: "Published version {version}",
  description: "Admin UI publish page: notification after a publish.",
});
export const uiConfigHistory = defineMessage({
  id: "ui.config.history",
  defaultMessage: "History",
  description: "Admin UI publish page: heading of the published versions list.",
});
export const uiConfigVersion = defineMessage({
  id: "ui.config.version",
  defaultMessage: "Version",
  description: "Admin UI publish page: version column.",
});
export const uiConfigCurrent = defineMessage({
  id: "ui.config.current",
  defaultMessage: "live",
  description: "Admin UI publish page: badge on the version gateways serve.",
});
export const uiConfigRollback = defineMessage({
  id: "ui.config.rollback",
  defaultMessage: "Roll back",
  description: "Admin UI publish page: roll back to this version.",
});
export const uiConfigRolledBack = defineMessage({
  id: "ui.config.rolledBack",
  defaultMessage: "Rolled back to version {version}",
  description: "Admin UI publish page: notification after a rollback.",
});
export const uiConfigRollbackRevived = defineMessage({
  id: "ui.config.rollbackRevived",
  defaultMessage:
    "{count, plural, one {# credential} other {# credentials}} revoked or rotated since version {version} will work again:",
  description:
    "Admin UI publish page: rollback confirmation, warning before the list of revoked or rotated credentials the rollback would make live again.",
});
export const uiConfigRollbackPreviewFailed = defineMessage({
  id: "ui.config.rollbackPreviewFailed",
  defaultMessage:
    "Couldn't check which revoked or rotated credentials this rollback makes work again. If it does, you'll be told after it's done.",
  description:
    "Admin UI publish page: rollback confirmation, when asking the admin what the rollback would revive failed.",
});
export const uiConfigRollbackRevivedDone = defineMessage({
  id: "ui.config.rollbackRevivedDone",
  defaultMessage:
    "{count, plural, one {# credential} other {# credentials}} revoked or rotated since version {version} work again: revoke them again if they should not.",
  description:
    "Admin UI publish page: warning after a rollback (whose preview failed) that made revoked or rotated credentials live again.",
});
export const uiConfigRollbackRevivedItem = defineMessage({
  id: "ui.config.rollbackRevivedItem",
  defaultMessage: "{entity} {id} (consumer {consumer})",
  description:
    "Admin UI publish page: one credential a rollback would make live again: its kind, id and consumer id.",
});
export const uiTesterTitle = defineMessage({
  id: "ui.tester.title",
  defaultMessage: "Route tester",
  description: "Admin UI route tester: page heading.",
});
export const uiTesterMethod = defineMessage({
  id: "ui.tester.method",
  defaultMessage: "Method",
  description: "Admin UI route tester: HTTP method field.",
});
export const uiTesterPath = defineMessage({
  id: "ui.tester.path",
  defaultMessage: "Path",
  description: "Admin UI route tester: request path field.",
});
export const uiTesterHeaders = defineMessage({
  id: "ui.tester.headers",
  defaultMessage: "Headers (JSON object)",
  description: "Admin UI route tester: request headers field.",
});
export const uiTesterBody = defineMessage({
  id: "ui.tester.body",
  defaultMessage: "Body",
  description: "Admin UI route tester: request body field.",
});
export const uiTesterSend = defineMessage({
  id: "ui.tester.send",
  defaultMessage: "Send",
  description: "Admin UI route tester: send button.",
});
export const uiTesterStatus = defineMessage({
  id: "ui.tester.status",
  defaultMessage: "{status} in {ms} ms",
  description:
    "Admin UI route tester: the gateway's status and the round trip.",
});
export const uiTesterPlugin = defineMessage({
  id: "ui.tester.plugin",
  defaultMessage: "Plugin",
  description: "Admin UI route tester: trace column.",
});
export const uiTesterPhase = defineMessage({
  id: "ui.tester.phase",
  defaultMessage: "Phase",
  description: "Admin UI route tester: trace column.",
});
export const uiTesterOutcome = defineMessage({
  id: "ui.tester.outcome",
  defaultMessage: "Decision",
  description:
    "Admin UI route tester: trace column (ok, short-circuit, error).",
});
export const uiTesterDuration = defineMessage({
  id: "ui.tester.duration",
  defaultMessage: "Time (ms)",
  description: "Admin UI route tester: trace column.",
});
export const uiTesterNoPlugins = defineMessage({
  id: "ui.tester.noPlugins",
  defaultMessage: "No plugin ran for this request.",
  description: "Admin UI route tester: empty trace.",
});
export const uiTesterTruncated = defineMessage({
  id: "ui.tester.truncated",
  defaultMessage: "The body was cut off at {kib} KiB.",
  description: "Admin UI route tester: the response body was truncated.",
});
export const errorsAdminTesterBadRequest = defineMessage({
  id: "errors.admin.testerBadRequest",
  defaultMessage: "The route tester only sends requests to the gateway",
  description:
    "Error title: the tester's path resolved to another host, or the request can't be sent (e.g. a body with GET).",
});
export const uiPluginsTargetRequired = defineMessage({
  id: "ui.plugins.targetRequired",
  defaultMessage:
    "Pick which service, route or consumer the plugin applies to.",
  description:
    "Admin UI plugin form: submitted with a scope but no target picked.",
});
export const errorsAiPromptBlocked = defineMessage({
  id: "errors.ai.promptBlocked",
  defaultMessage: "The prompt is not allowed",
  description:
    "Error title: ai-prompt-guard matched a deny pattern, or no allow pattern.",
});
export const errorsAiRequestInvalid = defineMessage({
  id: "errors.ai.requestInvalid",
  defaultMessage: "The request is not a valid LLM request",
  description:
    "Error title: an AI plugin couldn't read the body as an LLM request (not JSON, wrong shape, or larger than the configured size).",
});
export const errorsAiProviderFailed = defineMessage({
  id: "errors.ai.providerFailed",
  defaultMessage: "The LLM provider failed",
  description:
    "Error title: ai-proxy's provider (and its Workers AI fallback, if any) failed.",
});
export const errorsAiRateLimited = defineMessage({
  id: "errors.ai.rateLimited",
  defaultMessage: "AI token rate limit exceeded",
  description:
    "Error title: ai-rate-limiting-advanced's token limit for a provider is used up.",
});
export const errorsAiStreamingDenied = defineMessage({
  id: "errors.ai.streamingDenied",
  defaultMessage: "Streaming is not allowed on this route",
  description:
    "Error title: the client asked for a streamed answer and ai-proxy's response_streaming is deny.",
});
export const cliOptionJson = defineMessage({
  id: "cli.option.json",
  defaultMessage: "Print the result as JSON",
  description: "CLI help: the --json option.",
});
export const cliOptionDebug = defineMessage({
  id: "cli.option.debug",
  defaultMessage: "Print an error's stack trace",
  description: "CLI help: the --debug option.",
});
export const cliErrorDebugHint = defineMessage({
  id: "cli.error.debugHint",
  defaultMessage: "Run again with --debug to see the stack trace.",
  description: "CLI error: printed after an error's message.",
});
export const cliDiffOptionExitCode = defineMessage({
  id: "cli.diff.option.exitCode",
  defaultMessage: "Exit with 1 when there are pending changes (for CI)",
  description: "CLI help: the diff --exit-code option.",
});
export const cliVersionsDescription = defineMessage({
  id: "cli.versions.description",
  defaultMessage: "List the published config versions, newest first.",
  description: "CLI help: the versions command.",
});
export const cliVersionsNone = defineMessage({
  id: "cli.versions.none",
  defaultMessage: "No versions published yet.",
  description: "CLI message: nothing has been published.",
});
export const cliVersionsLine = defineMessage({
  id: "cli.versions.line",
  defaultMessage: "Version {version}, published {publishedAt} by {actor}.",
  description: "CLI output: one published version.",
});
export const cliVersionsLiveLine = defineMessage({
  id: "cli.versions.liveLine",
  defaultMessage:
    "Version {version} (live), published {publishedAt} by {actor}.",
  description: "CLI output: the published version the gateway serves.",
});
export const cliVersionsNote = defineMessage({
  id: "cli.versions.note",
  defaultMessage: "Note: {note}",
  description: "CLI output: a published version's note, under its line.",
});
export const cliRollbackDescription = defineMessage({
  id: "cli.rollback.description",
  defaultMessage: "Make an earlier published version live again.",
  description: "CLI help: the rollback command.",
});
export const cliRollbackOptionVersion = defineMessage({
  id: "cli.rollback.option.version",
  defaultMessage: "The version to make live",
  description: "CLI help: the rollback command's version argument.",
});
export const cliRollbackInvalidVersion = defineMessage({
  id: "cli.rollback.invalidVersion",
  defaultMessage: "The version must be a positive whole number.",
  description:
    "CLI error: rollback was given something other than a version number.",
});
export const cliRollbackDone = defineMessage({
  id: "cli.rollback.done",
  defaultMessage: "Version {version} is live.",
  description: "CLI message: the rollback succeeded.",
});
export const cliImportOptionRemote = defineMessage({
  id: "cli.import.option.remote",
  defaultMessage:
    "Write to the admin at --admin-url through its Kong-compatible API, instead of the local D1",
  description: "CLI help: the import-deck --remote option.",
});
export const cliImportOptionKongToken = defineMessage({
  id: "cli.import.option.kongToken",
  defaultMessage:
    "A Kong-Admin-Token for the admin's Kong-compatible API (or EDGWAY_KONG_TOKEN)",
  description: "CLI help: the import-deck --kong-token option.",
});
export const cliErrorNoKongToken = defineMessage({
  id: "cli.error.noKongToken",
  defaultMessage:
    "No Kong admin token: pass --kong-token or set EDGWAY_KONG_TOKEN.",
  description: "CLI error: import-deck --remote needs a Kong-Admin-Token.",
});
export const cliDeployStep = defineMessage({
  id: "cli.deploy.step",
  defaultMessage: "Running {command}",
  description: "CLI message: the wrangler command deploy runs next.",
});
export const cliDeployBound = defineMessage({
  id: "cli.deploy.bound",
  defaultMessage: "Set {binding}.{field} to {id} in {file}.",
  description:
    "CLI message: deploy wrote a resource id into a wrangler config.",
});
export const cliDeployNoBinding = defineMessage({
  id: "cli.deploy.noBinding",
  defaultMessage: "{file} has no {binding} binding.",
  description: "CLI error: a wrangler config lacks a binding deploy needs.",
});
export const cliDeployKeysPartial = defineMessage({
  id: "cli.deploy.keysPartial",
  defaultMessage:
    "Keys are only partly set (missing: {missing}). Copy the existing key pair to the missing secrets (docs/deploy.md); generating a new pair would invalidate what the old one signed.",
  description:
    "CLI error: some but not all of a key pair's Worker secrets exist, so deploy stops.",
});
export const cliImportNotKong = defineMessage({
  id: "cli.import.notKong",
  defaultMessage:
    "The admin answered {status} without JSON. Give its Kong-compatible mount a Cloudflare Access bypass or service-token policy, or send a service token (docs/deploy.md).",
  description:
    "CLI error: import-deck --remote got a non-JSON answer, usually Cloudflare Access's login redirect.",
});
export const uiErrorTitle = defineMessage({
  id: "ui.error.title",
  defaultMessage: "This page couldn't load.",
  description:
    "Admin UI error state: heading when a page's data failed to load.",
});
export const uiErrorRetry = defineMessage({
  id: "ui.error.retry",
  defaultMessage: "Try again",
  description: "Admin UI error state: the button that reloads the page's data.",
});
export const uiErrorDocs = defineMessage({
  id: "ui.error.docs",
  defaultMessage: "What {code} means",
  description: "Admin UI error state: link to the error code's docs page.",
});
export const uiErrorStatus = defineMessage({
  id: "ui.error.status",
  defaultMessage: "The admin answered {status}.",
  description:
    "Admin UI error state: the HTTP status, when the answer has no error code.",
});
export const uiOverviewNoTraffic = defineMessage({
  id: "ui.overview.noTraffic",
  defaultMessage:
    "Analytics is set up, but no requests came in over the last {hours, plural, one {hour} other {# hours}}.",
  description:
    "Admin UI overview: analytics is configured and the gateway served nothing in the window.",
});
export const uiOverviewRange = defineMessage({
  id: "ui.overview.range",
  defaultMessage: "Time range",
  description: "Admin UI overview: the label of the time range buttons.",
});
export const uiOverviewRangeHour = defineMessage({
  id: "ui.overview.rangeHour",
  defaultMessage: "Last hour",
  description: "Admin UI overview: time range button, the last hour.",
});
export const uiOverviewRangeDay = defineMessage({
  id: "ui.overview.rangeDay",
  defaultMessage: "Last 24 hours",
  description: "Admin UI overview: time range button, the last 24 hours.",
});
export const uiOverviewRangeWeek = defineMessage({
  id: "ui.overview.rangeWeek",
  defaultMessage: "Last 7 days",
  description: "Admin UI overview: time range button, the last 7 days.",
});
export const uiOverviewErrorRate = defineMessage({
  id: "ui.overview.errorRate",
  defaultMessage: "Error rate",
  description:
    "Admin UI overview: tile, the share of requests that ended in a 5xx over the range.",
});
export const uiTesterUpstream = defineMessage({
  id: "ui.tester.upstream",
  defaultMessage: "Upstream",
  description:
    "Admin UI route tester: the waterfall's upstream bar, the request's time not spent in plugins.",
});
export const uiTesterRoute = defineMessage({
  id: "ui.tester.route",
  defaultMessage: "Matched route: {route}",
  description:
    "Admin UI route tester: the route the gateway matched (from its x-edgway-route header).",
});
export const uiKeyDialogTitle = defineMessage({
  id: "ui.keyAuth.dialogTitle",
  defaultMessage: "Your new API key",
  description:
    "Admin UI key dialog: heading over a newly created or rotated key.",
});
export const uiKeyCopy = defineMessage({
  id: "ui.keyAuth.copy",
  defaultMessage: "Copy",
  description: "Admin UI key dialog: copies the key to the clipboard.",
});
export const uiKeyCopied = defineMessage({
  id: "ui.keyAuth.copied",
  defaultMessage: "The key is on your clipboard.",
  description: "Admin UI key dialog: confirmation after copying the key.",
});
export const uiKeyDone = defineMessage({
  id: "ui.keyAuth.done",
  defaultMessage: "I’ve saved it",
  description: "Admin UI key dialog: closes the dialog once the key is stored.",
});
export const uiCredentialsAddKey = defineMessage({
  id: "ui.credentials.addKey",
  defaultMessage: "Add an API key",
  description:
    "Admin UI consumer page: creates a key-auth key for this consumer.",
});
export const uiCredentialsRotate = defineMessage({
  id: "ui.credentials.rotate",
  defaultMessage: "Rotate",
  description:
    "Admin UI consumer page: replaces a key-auth key with a new one.",
});
export const uiCredentialsRotateConfirm = defineMessage({
  id: "ui.credentials.rotateConfirm",
  defaultMessage:
    "Rotate this key? Clients using it stop working until they get the new one.",
  description: "Admin UI consumer page: confirmation before rotating a key.",
});
export const uiCredentialsDelete = defineMessage({
  id: "ui.credentials.delete",
  defaultMessage: "Delete",
  description: "Admin UI consumer page: deletes a credential.",
});
export const uiCredentialsDeleteConfirm = defineMessage({
  id: "ui.credentials.deleteConfirm",
  defaultMessage:
    "Delete this credential? Clients using it stop working at the next publish.",
  description:
    "Admin UI consumer page: confirmation before deleting a credential.",
});
export const uiCredentialsAddBasic = defineMessage({
  id: "ui.credentials.addBasic",
  defaultMessage: "Add a basic-auth user",
  description: "Admin UI consumer page: creates a basic-auth credential.",
});
export const uiCredentialsChangePassword = defineMessage({
  id: "ui.credentials.changePassword",
  defaultMessage: "Change password",
  description:
    "Admin UI consumer page: sets a basic-auth credential's password.",
});
export const uiCredentialsUsername = defineMessage({
  id: "ui.credentials.username",
  defaultMessage: "Username",
  description: "Admin UI basic-auth form: the username field.",
});
export const uiCredentialsPassword = defineMessage({
  id: "ui.credentials.password",
  defaultMessage: "Password",
  description: "Admin UI basic-auth form: the password field.",
});
export const uiCredentialsSave = defineMessage({
  id: "ui.credentials.save",
  defaultMessage: "Save",
  description: "Admin UI basic-auth form: saves the credential.",
});
export const uiCredentialsNone = defineMessage({
  id: "ui.credentials.none",
  defaultMessage: "None yet.",
  description: "Admin UI consumer page: a credential type has no entries.",
});
export const uiCredentialsAdd = defineMessage({
  id: "ui.credentials.add",
  defaultMessage: "Add {resource}",
  description:
    "Admin UI detail page: creates a related entity for this record.",
});
export const uiVaultHint = defineMessage({
  id: "ui.vault.hint",
  defaultMessage:
    "Enter a vault reference such as {example}, never the secret itself.",
  description:
    "Admin UI form: under a secret field (a key, a password); the example is a vault reference.",
});
export const uiSecretMasked = defineMessage({
  id: "ui.secret.masked",
  defaultMessage: "Hidden",
  description:
    "Admin UI detail page: shown instead of a secret that isn't a vault reference.",
});
export const uiPluginsSaved = defineMessage({
  id: "ui.plugins.saved",
  defaultMessage: "Plugin saved. Publish to make the change live.",
  description:
    "Admin UI plugin edit page: confirmation after saving a plugin's config.",
});
export const uiConfigActions = defineMessage({
  id: "ui.config.actions",
  defaultMessage: "Actions",
  description:
    "Admin UI publish page: hidden header of the history table's button column.",
});
export const uiConfigPublishedBy = defineMessage({
  id: "ui.config.publishedBy",
  defaultMessage: "Published by",
  description:
    "Admin UI publish page: history column, who published the version.",
});
export const uiConfigPublishedAt = defineMessage({
  id: "ui.config.publishedAt",
  defaultMessage: "Published at",
  description:
    "Admin UI publish page: history column, when the version was published.",
});
export const uiConfigNoChanges = defineMessage({
  id: "ui.config.noChanges",
  defaultMessage:
    "Nothing to publish: the staged configuration is the live one.",
  description: "Admin UI publish page: no staged changes.",
});
export const uiConfigChangeAdded = defineMessage({
  id: "ui.config.kindAdded",
  defaultMessage: "Added",
  description:
    "Admin UI publish page: badge on a staged entity that publishing adds.",
});
export const uiConfigChangeRemoved = defineMessage({
  id: "ui.config.kindRemoved",
  defaultMessage: "Removed",
  description:
    "Admin UI publish page: badge on a staged entity that publishing removes.",
});
export const uiConfigChangeChanged = defineMessage({
  id: "ui.config.kindChanged",
  defaultMessage: "Changed",
  description:
    "Admin UI publish page: badge on a staged entity that publishing changes.",
});
export const uiConfigPublishConfirm = defineMessage({
  id: "ui.config.publishConfirm",
  defaultMessage: "Publish {count, plural, one {# change} other {# changes}}?",
  description: "Admin UI publish page: confirmation dialog title.",
});
export const uiConfigPublishConfirmBody = defineMessage({
  id: "ui.config.publishConfirmBody",
  defaultMessage: "The gateways serve the new version within about a second.",
  description: "Admin UI publish page: confirmation dialog text.",
});
export const uiConfigRollbackConfirm = defineMessage({
  id: "ui.config.rollbackConfirm",
  defaultMessage: "Make version {version} live again?",
  description: "Admin UI publish page: rollback confirmation dialog title.",
});
export const uiConfigRollbackConfirmBody = defineMessage({
  id: "ui.config.rollbackConfirmBody",
  defaultMessage:
    "The gateways switch to it within about a second. Staged changes stay staged.",
  description: "Admin UI publish page: rollback confirmation dialog text.",
});
export const uiNavUnpublished = defineMessage({
  id: "ui.nav.unpublished",
  defaultMessage:
    "{count, plural, one {# unpublished change} other {# unpublished changes}}",
  description:
    "Admin UI navigation: badge on the publish link, the number of staged changes.",
});
export const uiRoleViewer = defineMessage({
  id: "ui.role.viewer",
  defaultMessage: "Viewer",
  description: "Admin UI: the viewer role, on the sidebar footer's badge.",
});
export const uiRoleEditor = defineMessage({
  id: "ui.role.editor",
  defaultMessage: "Editor",
  description: "Admin UI: the editor role, on the sidebar footer's badge.",
});
export const uiRolePublisher = defineMessage({
  id: "ui.role.publisher",
  defaultMessage: "Publisher",
  description: "Admin UI: the publisher role, on the sidebar footer's badge.",
});
export const uiRoleOwner = defineMessage({
  id: "ui.role.owner",
  defaultMessage: "Owner",
  description: "Admin UI: the owner role, on the sidebar footer's badge.",
});
export const uiRoleSignedIn = defineMessage({
  id: "ui.role.signedIn",
  defaultMessage: "Signed in as {id}",
  description:
    "Admin UI: the sidebar footer's label for the signed-in Access identity (an email or a service token's client id).",
});
export const uiRoleNeedEditor = defineMessage({
  id: "ui.role.needEditor",
  defaultMessage:
    "You're a viewer: you can see the configuration and its history. An editor, publisher or owner can stage changes.",
  description:
    "Admin UI: why staging actions are disabled for a viewer, shown on every page.",
});
export const uiRoleViewerNeedPublisher = defineMessage({
  id: "ui.role.viewerNeedPublisher",
  defaultMessage:
    "You're a viewer: you can see changes and history. A publisher or owner can publish and roll back.",
  description:
    "Admin UI: why Publish and Roll back are disabled for a viewer, on the publish page.",
});
export const uiRoleEditorNeedPublisher = defineMessage({
  id: "ui.role.editorNeedPublisher",
  defaultMessage:
    "You're an editor: you can stage changes and see history. A publisher or owner can publish and roll back.",
  description:
    "Admin UI: why Publish and Roll back are disabled for an editor, on the publish page.",
});
export const uiPluginsDescriptionAcl = defineMessage({
  id: "ui.plugins.description.acl",
  defaultMessage: "Allow or deny consumers by their ACL groups.",
  description:
    "Admin UI plugin catalog: the acl plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionAiPromptGuard = defineMessage({
  id: "ui.plugins.description.ai-prompt-guard",
  defaultMessage:
    "Block AI prompts that match deny patterns, or that miss allow patterns.",
  description:
    "Admin UI plugin catalog: the ai-prompt-guard plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionAiProxy = defineMessage({
  id: "ui.plugins.description.ai-proxy",
  defaultMessage:
    "Send requests to an LLM provider, or Workers AI, with one request format.",
  description:
    "Admin UI plugin catalog: the ai-proxy plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionAiRateLimitingAdvanced = defineMessage({
  id: "ui.plugins.description.ai-rate-limiting-advanced",
  defaultMessage:
    "Limit AI usage by tokens per consumer, per provider and per window.",
  description:
    "Admin UI plugin catalog: the ai-rate-limiting-advanced plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionBasicAuth = defineMessage({
  id: "ui.plugins.description.basic-auth",
  defaultMessage: "Authenticate consumers with a username and password.",
  description:
    "Admin UI plugin catalog: the basic-auth plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionCorrelationId = defineMessage({
  id: "ui.plugins.description.correlation-id",
  defaultMessage:
    "Add an id header to each request and response so calls can be traced.",
  description:
    "Admin UI plugin catalog: the correlation-id plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionCors = defineMessage({
  id: "ui.plugins.description.cors",
  defaultMessage: "Answer browsers' cross-origin checks and add CORS headers.",
  description:
    "Admin UI plugin catalog: the cors plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionHttpLog = defineMessage({
  id: "ui.plugins.description.http-log",
  defaultMessage: "Send a log of each request to an HTTP endpoint.",
  description:
    "Admin UI plugin catalog: the http-log plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionIpRestriction = defineMessage({
  id: "ui.plugins.description.ip-restriction",
  defaultMessage: "Allow or deny clients by IP address or CIDR range.",
  description:
    "Admin UI plugin catalog: the ip-restriction plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionJwt = defineMessage({
  id: "ui.plugins.description.jwt",
  defaultMessage: "Authenticate consumers with signed JSON Web Tokens.",
  description:
    "Admin UI plugin catalog: the jwt plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionKeyAuth = defineMessage({
  id: "ui.plugins.description.key-auth",
  defaultMessage:
    "Authenticate consumers with an API key in a header or query parameter.",
  description:
    "Admin UI plugin catalog: the key-auth plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionOpenidConnect = defineMessage({
  id: "ui.plugins.description.openid-connect",
  defaultMessage:
    "Sign users in with an OpenID Connect provider, or verify its tokens.",
  description:
    "Admin UI plugin catalog: the openid-connect plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionProxyCache = defineMessage({
  id: "ui.plugins.description.proxy-cache",
  defaultMessage: "Cache upstream responses at the edge.",
  description:
    "Admin UI plugin catalog: the proxy-cache plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionRateLimiting = defineMessage({
  id: "ui.plugins.description.rate-limiting",
  defaultMessage: "Limit requests per second, minute, hour or day.",
  description:
    "Admin UI plugin catalog: the rate-limiting plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionRequestSizeLimiting = defineMessage({
  id: "ui.plugins.description.request-size-limiting",
  defaultMessage: "Refuse request bodies over a size limit.",
  description:
    "Admin UI plugin catalog: the request-size-limiting plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionRequestTermination = defineMessage({
  id: "ui.plugins.description.request-termination",
  defaultMessage:
    "Answer requests with a fixed status and body, without calling the upstream.",
  description:
    "Admin UI plugin catalog: the request-termination plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionRequestTransformer = defineMessage({
  id: "ui.plugins.description.request-transformer",
  defaultMessage:
    "Add, rename, replace or remove request headers, query parameters and body fields.",
  description:
    "Admin UI plugin catalog: the request-transformer plugin's card, one line on what it does.",
});
export const uiPluginsDescriptionResponseTransformer = defineMessage({
  id: "ui.plugins.description.response-transformer",
  defaultMessage:
    "Add, rename, replace or remove response headers and JSON body fields.",
  description:
    "Admin UI plugin catalog: the response-transformer plugin's card, one line on what it does.",
});
export const uiPluginsFilter = defineMessage({
  id: "ui.plugins.filter",
  defaultMessage: "Category",
  description:
    "Admin UI plugin catalog: the label of the category filter buttons.",
});
export const uiPluginsFilterAll = defineMessage({
  id: "ui.plugins.filterAll",
  defaultMessage: "All",
  description:
    "Admin UI plugin catalog: the filter button that shows every category.",
});
export const uiPluginsInUse = defineMessage({
  id: "ui.plugins.inUse",
  defaultMessage: "In use",
  description:
    "Admin UI plugin catalog: badge on a plugin that is configured somewhere.",
});
export const uiPluginsStaged = defineMessage({
  id: "ui.plugins.staged",
  defaultMessage: "Staged",
  description:
    "Admin UI plugin catalog: badge on a plugin with unpublished changes.",
});
export const uiNavAudit = defineMessage({
  id: "ui.nav.audit",
  defaultMessage: "Audit log",
  description: "Admin UI navigation: the audit log page.",
});
export const uiAuditTitle = defineMessage({
  id: "ui.audit.title",
  defaultMessage: "Audit log",
  description: "Admin UI audit log: the page heading.",
});
export const uiAuditWho = defineMessage({
  id: "ui.audit.who",
  defaultMessage: "Who",
  description: "Admin UI audit log: column, the identity that made the change.",
});
export const uiAuditAction = defineMessage({
  id: "ui.audit.action",
  defaultMessage: "Action",
  description:
    "Admin UI audit log: column, and the label of the action filter.",
});
export const uiAuditEntity = defineMessage({
  id: "ui.audit.entity",
  defaultMessage: "Entity",
  description: "Admin UI audit log: column, what was changed.",
});
export const uiAuditWhen = defineMessage({
  id: "ui.audit.when",
  defaultMessage: "When",
  description: "Admin UI audit log: column, the time of the change.",
});
export const uiAuditAll = defineMessage({
  id: "ui.audit.all",
  defaultMessage: "All actions",
  description:
    "Admin UI audit log: the action filter's option that shows every action.",
});
export const uiAuditActionCreate = defineMessage({
  id: "ui.audit.actionCreate",
  defaultMessage: "Created",
  description: "Admin UI audit log: the create action.",
});
export const uiAuditActionUpdate = defineMessage({
  id: "ui.audit.actionUpdate",
  defaultMessage: "Changed",
  description: "Admin UI audit log: the update action.",
});
export const uiAuditActionDelete = defineMessage({
  id: "ui.audit.actionDelete",
  defaultMessage: "Removed",
  description: "Admin UI audit log: the delete action.",
});
export const uiAuditActionPublish = defineMessage({
  id: "ui.audit.actionPublish",
  defaultMessage: "Published",
  description: "Admin UI audit log: the publish action.",
});
export const uiAuditActionRollback = defineMessage({
  id: "ui.audit.actionRollback",
  defaultMessage: "Rolled back",
  description: "Admin UI audit log: the rollback action.",
});
export const uiAuditDetails = defineMessage({
  id: "ui.audit.details",
  defaultMessage: "Details",
  description:
    "Admin UI audit log: the button that expands an event to its diff.",
});
export const uiAuditRequestId = defineMessage({
  id: "ui.audit.requestId",
  defaultMessage: "Request {id}",
  description: "Admin UI audit log: an expanded event's request id.",
});
export const uiAuditVersion = defineMessage({
  id: "ui.audit.version",
  defaultMessage: "Version {version}",
  description:
    "Admin UI audit log: a publish or rollback's config version, linked to the publish page.",
});
export const uiAuditEmpty = defineMessage({
  id: "ui.audit.empty",
  defaultMessage: "No changes recorded yet.",
  description: "Admin UI audit log: no events match.",
});
export const uiAuditMore = defineMessage({
  id: "ui.audit.more",
  defaultMessage: "Load more",
  description: "Admin UI audit log: loads the next page of older events.",
});
export const uiFormBasics = defineMessage({
  id: "ui.form.basics",
  defaultMessage: "Basics",
  description:
    "Admin UI entity form: the fieldset of the fields every route or service needs.",
});
export const uiFormMatches = defineMessage({
  id: "ui.form.matches",
  defaultMessage: "What it matches",
  description:
    "Admin UI route form: the fieldset of the request attributes a route matches on.",
});
export const uiFormDestination = defineMessage({
  id: "ui.form.destination",
  defaultMessage: "Where it sends requests",
  description:
    "Admin UI service form: the card of the protocol, host, port and path a service calls.",
});
export const uiFormAdvanced = defineMessage({
  id: "ui.form.advanced",
  defaultMessage: "Advanced",
  description:
    "Admin UI entity form: the folded fieldset of rarely changed fields.",
});
export const uiFormStageRoute = defineMessage({
  id: "ui.form.stageRoute",
  defaultMessage: "Stage route",
  description:
    "Admin UI route form: the submit button; the route is staged, not live.",
});
export const uiFormStageService = defineMessage({
  id: "ui.form.stageService",
  defaultMessage: "Stage service",
  description:
    "Admin UI service form: the submit button; the service is staged, not live.",
});
export const uiFormStageNote = defineMessage({
  id: "ui.form.stageNote",
  defaultMessage: "It goes live when you publish.",
  description: "Admin UI entity form: the line beside the stage button.",
});
export const uiFormPreview = defineMessage({
  id: "ui.form.preview",
  defaultMessage: "decK preview",
  description:
    "Admin UI entity form: heading of the entity being edited, as decK YAML.",
});
export const uiFormCopy = defineMessage({
  id: "ui.form.copy",
  defaultMessage: "Copy",
  description:
    "Admin UI entity form: copies the decK preview to the clipboard.",
});
export const uiServiceUpstream = defineMessage({
  id: "ui.service.upstream",
  defaultMessage: "Upstream {name}",
  description:
    "Admin UI service page: heading of the Kong upstream the service's host names.",
});
export const uiServiceDirect = defineMessage({
  id: "ui.service.direct",
  defaultMessage: "Calls {host} directly.",
  description:
    "Admin UI service page: the service's host isn't a Kong upstream.",
});
export const uiServiceTarget = defineMessage({
  id: "ui.service.target",
  defaultMessage: "Target",
  description: "Admin UI service page: targets column, host and port.",
});
export const uiServiceWeight = defineMessage({
  id: "ui.service.weight",
  defaultMessage: "Weight",
  description: "Admin UI service page: targets column, the target's weight.",
});
export const uiServiceShare = defineMessage({
  id: "ui.service.share",
  defaultMessage: "Share",
  description:
    "Admin UI service page: targets column, the target's share of the traffic.",
});
export const uiWhichTitle = defineMessage({
  id: "ui.which.title",
  defaultMessage: "Which plugins run",
  description:
    "Admin UI service page: heading of the panel that answers which plugins run for a route and caller.",
});
export const uiWhichRoute = defineMessage({
  id: "ui.which.route",
  defaultMessage: "Route",
  description: "Admin UI which-plugins panel: the route picker's label.",
});
export const uiWhichCaller = defineMessage({
  id: "ui.which.caller",
  defaultMessage: "Caller",
  description: "Admin UI which-plugins panel: the caller picker's label.",
});
export const uiWhichNobody = defineMessage({
  id: "ui.which.nobody",
  defaultMessage: "Anyone (no consumer)",
  description: "Admin UI which-plugins panel: no authenticated consumer.",
});
export const uiWhichConsumer = defineMessage({
  id: "ui.which.consumer",
  defaultMessage: "Consumer {name}",
  description: "Admin UI which-plugins panel: a consumer as the caller.",
});
export const uiWhichGroup = defineMessage({
  id: "ui.which.group",
  defaultMessage: "Consumer group {name}",
  description: "Admin UI which-plugins panel: a consumer group as the caller.",
});
export const uiWhichNone = defineMessage({
  id: "ui.which.none",
  defaultMessage: "No plugin runs for this route and caller.",
  description: "Admin UI which-plugins panel: empty answer.",
});
export const uiWhichNoRoutes = defineMessage({
  id: "ui.which.noRoutes",
  defaultMessage: "This service has no routes yet.",
  description:
    "Admin UI which-plugins panel: the service has no route to ask about.",
});
export const uiWhichReplaced = defineMessage({
  id: "ui.which.replaced",
  defaultMessage: "replaced by a more specific one",
  description:
    "Admin UI which-plugins panel: after a struck-through plugin instance that doesn't run.",
});
export const uiWhichLevelGlobal = defineMessage({
  id: "ui.which.levelGlobal",
  defaultMessage: "Global",
  description: "Admin UI which-plugins panel: a plugin set for every request.",
});
export const uiWhichLevelRoute = defineMessage({
  id: "ui.which.levelRoute",
  defaultMessage: "Route",
  description: "Admin UI which-plugins panel: a plugin set on the route.",
});
export const uiWhichLevelService = defineMessage({
  id: "ui.which.levelService",
  defaultMessage: "Service",
  description: "Admin UI which-plugins panel: a plugin set on the service.",
});
export const uiWhichLevelConsumer = defineMessage({
  id: "ui.which.levelConsumer",
  defaultMessage: "Consumer",
  description: "Admin UI which-plugins panel: a plugin set on the consumer.",
});
export const uiWhichLevelGroup = defineMessage({
  id: "ui.which.levelGroup",
  defaultMessage: "Consumer group",
  description:
    "Admin UI which-plugins panel: a plugin set on the consumer group.",
});
export const uiUpstreamFallback = defineMessage({
  id: "ui.upstream.fallback",
  defaultMessage:
    "{algorithm} runs as {fallback} on Workers. The upstream is accepted, and every publish says so.",
  description:
    "Admin UI upstream page: the algorithm the gateway can't run, and what it runs instead.",
});
export const uiUpstreamHealth = defineMessage({
  id: "ui.upstream.health",
  defaultMessage: "Health checks",
  description: "Admin UI upstream page: heading of the health-check settings.",
});
export const uiUpstreamHealthNote = defineMessage({
  id: "ui.upstream.healthNote",
  defaultMessage:
    "These are the settings. Each gateway checks health on its own, so there is no live health to show here.",
  description: "Admin UI upstream page: why no live target health is shown.",
});
export const uiUpstreamPassive = defineMessage({
  id: "ui.upstream.passive",
  defaultMessage: "Passive",
  description: "Admin UI upstream page: passive health-check settings.",
});
export const uiUpstreamActive = defineMessage({
  id: "ui.upstream.active",
  defaultMessage: "Active",
  description: "Admin UI upstream page: active health-check settings.",
});
export const uiUpstreamTargets = defineMessage({
  id: "ui.upstream.targets",
  defaultMessage: "Targets",
  description:
    "Admin UI upstream page: heading of the targets with their share.",
});
export const uiConfigSearch = defineMessage({
  id: "ui.config.search",
  defaultMessage: "Search changes",
  description:
    "Admin UI publish page: the search box over staged changes (names, paths, ids).",
});
export const uiConfigGroupCounts = defineMessage({
  id: "ui.config.groupCounts",
  defaultMessage: "{added} added, {changed} changed, {removed} removed",
  description: "Admin UI publish page: an entity group's counts.",
});
export const uiConfigTakesAll = defineMessage({
  id: "ui.config.takesAll",
  defaultMessage: "Publishing takes every staged change: {authors}.",
  description:
    "Admin UI publish page: publishing isn't selective; authors lists how many changes each person staged.",
});
export const uiConfigByAuthor = defineMessage({
  id: "ui.config.byAuthor",
  defaultMessage: "{count} by {actor}",
  description:
    "Admin UI publish page: how many staged changes one person made.",
});
export const uiConfigUnknownAuthor = defineMessage({
  id: "ui.config.unknownAuthor",
  defaultMessage: "an unknown author",
  description:
    "Admin UI publish page: a staged change with no audit event (for example, from before the audit log).",
});
export const uiConfigNoMatch = defineMessage({
  id: "ui.config.noMatch",
  defaultMessage: "No change matches the search.",
  description: "Admin UI publish page: the search hides every change.",
});
export const uiCertSubject = defineMessage({
  id: "ui.cert.subject",
  defaultMessage: "Subject",
  description: "Admin UI certificate list: column, the certificate's subject.",
});
export const uiCertExpires = defineMessage({
  id: "ui.cert.expires",
  defaultMessage: "Expires",
  description:
    "Admin UI certificate list: column, the certificate's expiry date.",
});
export const uiCertExpired = defineMessage({
  id: "ui.cert.expired",
  defaultMessage: "Expired",
  description: "Admin UI certificate list: badge on an expired certificate.",
});
export const uiCertSoon = defineMessage({
  id: "ui.cert.soon",
  defaultMessage: "Expires soon",
  description:
    "Admin UI certificate list: badge on a certificate expiring within the warning window.",
});
export const uiCertUnreadable = defineMessage({
  id: "ui.cert.unreadable",
  defaultMessage: "Can't read this certificate",
  description: "Admin UI certificate list: the PEM doesn't parse.",
});
export const uiCertBanner = defineMessage({
  id: "ui.cert.banner",
  defaultMessage:
    "{count, plural, one {# certificate has expired or expires within {days} days.} other {# certificates have expired or expire within {days} days.}} Renew them, or the gateway serves an expired certificate.",
  description:
    "Admin UI certificate list: the banner over expired and soon-expiring certificates.",
});
export const uiCertKeyHint = defineMessage({
  id: "ui.cert.keyHint",
  defaultMessage:
    "A vault reference such as {example}, not the key itself: Edgway never stores a private key. Put the key in a Worker secret or Secrets Store named {prefix}…, and reference it here.",
  description: "Admin UI certificate form: under the private key fields.",
});
export const uiCertKeyInvalid = defineMessage({
  id: "ui.cert.keyInvalid",
  defaultMessage: "Must be a vault reference, such as {example}.",
  description:
    "Admin UI certificate form: the private key field holds something other than a vault reference.",
});
export const uiVaultsPrefix = defineMessage({
  id: "ui.vaults.prefix",
  defaultMessage:
    "Only names starting with {prefix} can be read, so a reference never reaches the gateway's own secrets.",
  description: "Admin UI vaults page: the name prefix rule.",
});
export const uiVaultsVault = defineMessage({
  id: "ui.vaults.vault",
  defaultMessage: "Vault",
  description: "Admin UI vaults page: the builder's vault picker.",
});
export const uiVaultsName = defineMessage({
  id: "ui.vaults.name",
  defaultMessage: "Secret name",
  description: "Admin UI vaults page: the builder's secret name field.",
});
export const uiVaultsNeedsPrefix = defineMessage({
  id: "ui.vaults.needsPrefix",
  defaultMessage: "The name must start with {prefix}.",
  description:
    "Admin UI vaults page: the builder's name doesn't start with the prefix.",
});
export const uiVaultsNoRaw = defineMessage({
  id: "ui.vaults.noRaw",
  defaultMessage: "No plugin holds a secret as plain text.",
  description: "Admin UI vaults page: nothing for publish to warn about.",
});
export const uiSandboxLimits = defineMessage({
  id: "ui.sandbox.limits",
  defaultMessage:
    "Each run gets {cpu} ms of CPU and {sub} subrequests unless the plugin asks for more, up to {maxCpu} ms and {maxSub}. The code can be up to {maxKb} KB.",
  description: "Admin UI upload form: the sandbox's defaults and limits.",
});
export const uiSandboxTrust = defineMessage({
  id: "ui.sandbox.trust",
  defaultMessage:
    "Uploaded plugins run in an isolated Worker with no network access: they can only change the request and response they're given.",
  description: "Admin UI upload form: the sandbox's trust model.",
});
export const uiStagedBanner = defineMessage({
  id: "ui.staged.banner",
  defaultMessage:
    "{count, plural, one {# unpublished change} other {# unpublished changes}}. The gateways still serve version {version}.",
  description:
    "Admin UI: the banner on every page while changes are staged; version is the live config version.",
});
export const uiStagedBannerNoVersion = defineMessage({
  id: "ui.staged.bannerNoVersion",
  defaultMessage:
    "{count, plural, one {# unpublished change} other {# unpublished changes}}. Nothing is published yet.",
  description:
    "Admin UI: the staged-changes banner before the first publish, when no version is live.",
});
export const uiStagedReview = defineMessage({
  id: "ui.staged.review",
  defaultMessage: "Review and publish",
  description:
    "Admin UI: the staged-changes banner's link to the publish page.",
});
export const uiStagedToPublish = defineMessage({
  id: "ui.staged.toPublish",
  defaultMessage: "{count} to publish",
  description:
    "Admin UI: the header link to the publish page on narrow screens; count is the number of staged changes.",
});
export const uiTesterPublishedOnly = defineMessage({
  id: "ui.tester.publishedOnly",
  defaultMessage:
    "The tester sends requests through the live gateway, which serves the published version. Publish staged changes to test them.",
  description:
    "Admin UI route tester: explains that staged changes aren't tested.",
});
export const uiNavGroupConsole = defineMessage({
  id: "ui.nav.group.console",
  defaultMessage: "Console",
  description:
    "Admin UI sidebar: section of the overview, plugin catalog, publish and tester pages.",
});
export const uiNavGroupGateway = defineMessage({
  id: "ui.nav.group.gateway",
  defaultMessage: "Gateway",
  description:
    "Admin UI sidebar: section of services, routes, upstreams, plugins.",
});
export const uiNavGroupConsumers = defineMessage({
  id: "ui.nav.group.consumers",
  defaultMessage: "Consumers",
  description:
    "Admin UI sidebar: section of consumers, groups and their credentials.",
});
export const uiNavGroupTls = defineMessage({
  id: "ui.nav.group.tls",
  defaultMessage: "Certificates and vaults",
  description: "Admin UI sidebar: section of certificates, SNIs and vaults.",
});

export const uiValidationRequired = defineMessage({
  id: "validation.required",
  defaultMessage: "This field is required.",
  description: "Form validation: a required field is empty.",
});
export const uiValidationType = defineMessage({
  id: "validation.type",
  defaultMessage: "This must be a {type}.",
  description:
    "Form validation: wrong type; type is a JSON Schema type such as string or integer.",
});
export const uiValidationEnum = defineMessage({
  id: "validation.enum",
  defaultMessage: "Choose one of the allowed values.",
  description: "Form validation: the value isn't one of the allowed ones.",
});
export const uiValidationMinimum = defineMessage({
  id: "validation.minimum",
  defaultMessage: "This must be at least {limit}.",
  description: "Form validation: a number below its minimum.",
});
export const uiValidationMaximum = defineMessage({
  id: "validation.maximum",
  defaultMessage: "This must be at most {limit}.",
  description: "Form validation: a number above its maximum.",
});
export const uiValidationMinLength = defineMessage({
  id: "validation.minLength",
  defaultMessage:
    "{limit, plural, one {This needs at least # character.} other {This needs at least # characters.}}",
  description: "Form validation: text shorter than its minimum length.",
});
export const uiValidationMaxLength = defineMessage({
  id: "validation.maxLength",
  defaultMessage:
    "{limit, plural, one {This takes at most # character.} other {This takes at most # characters.}}",
  description: "Form validation: text longer than its maximum length.",
});
export const uiValidationMinItems = defineMessage({
  id: "validation.minItems",
  defaultMessage:
    "{limit, plural, one {Add at least # item.} other {Add at least # items.}}",
  description: "Form validation: a list shorter than its minimum.",
});
export const uiValidationMaxItems = defineMessage({
  id: "validation.maxItems",
  defaultMessage:
    "{limit, plural, one {Keep at most # item.} other {Keep at most # items.}}",
  description: "Form validation: a list longer than its maximum.",
});
export const uiValidationPattern = defineMessage({
  id: "validation.pattern",
  defaultMessage: "This doesn't match the expected pattern {pattern}.",
  description:
    "Form validation: text that doesn't match its regular expression.",
});
export const uiValidationFormat = defineMessage({
  id: "validation.format",
  defaultMessage: "This isn't a valid {format}.",
  description:
    "Form validation: text in the wrong format, such as an email or a URI.",
});
export const uiValidationUnknownField = defineMessage({
  id: "validation.unknownField",
  defaultMessage: "{property} isn't a field of this form.",
  description:
    "Form validation: the config has a field the schema doesn't allow.",
});

export const uiCredentialsKeyPrefix = defineMessage({
  id: "ui.credentials.keyPrefix",
  defaultMessage: "Key prefix",
  description:
    "Admin UI consumer page: API key column, the first characters of the key.",
});
export const uiCredentialsTtl = defineMessage({
  id: "ui.credentials.ttl",
  defaultMessage: "Lifetime (seconds)",
  description:
    "Admin UI consumer page: API key column, how long the key lasts.",
});
export const uiKeyCopyFailed = defineMessage({
  id: "ui.keyAuth.copyFailed",
  defaultMessage:
    "The browser didn't allow copying. Select the key and copy it yourself.",
  description: "Admin UI key dialog: copying to the clipboard was refused.",
});

export const portalLandingTitle = defineMessage({
  id: "portal.landing.title",
  defaultMessage: "APIs for developers",
  description: "Developer portal landing page: the page heading.",
});
export const portalLandingIntro = defineMessage({
  id: "portal.landing.intro",
  defaultMessage:
    "Sign in to create API keys, then call the APIs with one. Each request carries your key.",
  description: "Developer portal landing page: what a developer does here.",
});
export const portalLandingKeys = defineMessage({
  id: "portal.landing.keys",
  defaultMessage: "Manage your API keys",
  description:
    "Developer portal landing page: link to the API keys page (sign-in required).",
});
export const portalLandingReference = defineMessage({
  id: "portal.landing.reference",
  defaultMessage: "Read the API reference",
  description:
    "Developer portal landing page: link to the public API reference.",
});
export const portalRefusalBlocked = defineMessage({
  id: "portal.refusal.blocked",
  defaultMessage:
    "An admin has turned off your API keys. Ask them to turn your access back on.",
  description:
    "Developer portal: refusal when an admin blocked this developer.",
});
export const portalRefusalNotAllowed = defineMessage({
  id: "portal.refusal.notAllowed",
  defaultMessage:
    "This portal is for developers at approved organizations. Sign in with your work account, or ask an admin for access.",
  description:
    "Developer portal: refusal when the developer's email isn't at an allowed domain. Never names the domains.",
});
export const portalRefusalUnverified = defineMessage({
  id: "portal.refusal.unverified",
  defaultMessage:
    "Your sign-in provider hasn't verified your email address. Verify it there, then sign in again.",
  description:
    "Developer portal: refusal when the IdP gave an unverified email.",
});
export const portalRefusalKeyLimit = defineMessage({
  id: "portal.refusal.keyLimit",
  defaultMessage:
    "You already have {max} API keys, the most you can hold. Delete one, or rotate an existing key, to make room.",
  description:
    "Developer portal: refusal when the developer is at the per-consumer key limit.",
});
export const portalLandingStartTitle = defineMessage({
  id: "portal.landing.start.title",
  defaultMessage: "Get going",
  description:
    "Developer portal landing page: heading of the three first steps.",
});
export const portalLandingStepSignIn = defineMessage({
  id: "portal.landing.step.signIn",
  defaultMessage: "1. Sign in",
  description: "Developer portal landing page: first step's title.",
});
export const portalLandingStepSignInText = defineMessage({
  id: "portal.landing.step.signInText",
  defaultMessage: "Sign in with the account your organization gave you.",
  description: "Developer portal landing page: first step, signing in.",
});
export const portalLandingStepKey = defineMessage({
  id: "portal.landing.step.key",
  defaultMessage: "2. Create a key",
  description: "Developer portal landing page: second step's title.",
});
export const portalLandingStepKeyText = defineMessage({
  id: "portal.landing.step.keyText",
  defaultMessage:
    "Create an API key and copy it: it is shown in full only once.",
  description: "Developer portal landing page: second step, creating a key.",
});
export const portalLandingStepRequest = defineMessage({
  id: "portal.landing.step.request",
  defaultMessage: "3. Make a request",
  description: "Developer portal landing page: third step's title.",
});
export const portalLandingStepRequestText = defineMessage({
  id: "portal.landing.step.requestText",
  defaultMessage: "Send your key in the apikey header of every request.",
  description:
    "Developer portal landing page: third step, calling the API with the key (apikey is the header name, not translated).",
});
export const portalLandingFirstRequest = defineMessage({
  id: "portal.landing.firstRequest",
  defaultMessage: "Your first request",
  description: "Developer portal landing page: heading of the curl example.",
});
export const portalLandingCurl = defineMessage({
  id: "portal.landing.curl",
  defaultMessage: 'curl -H "apikey: {key}" {url}',
  description:
    "Developer portal landing page: the first-request command. Keep it as is: only {key} and {url} change.",
});
export const portalLandingKeyPlaceholder = defineMessage({
  id: "portal.landing.keyPlaceholder",
  defaultMessage: "$API_KEY",
  description:
    "Developer portal landing page: the shell variable that holds the developer's key in the curl example (keep it as is).",
});
export const portalLandingGatewayPlaceholder = defineMessage({
  id: "portal.landing.gatewayPlaceholder",
  defaultMessage: "https://api.example.com/",
  description:
    "Developer portal landing page: an example address in the curl example when the portal wasn't built with the gateway's.",
});
export const portalUsageChart = defineMessage({
  id: "portal.usage.chart",
  defaultMessage: "Requests and server errors per day",
  description: "Developer portal usage panel: the chart's accessible label.",
});
export const portalUsageShowTable = defineMessage({
  id: "portal.usage.showTable",
  defaultMessage: "Show as a table",
  description:
    "Developer portal usage panel: disclosure that shows the numbers as a table.",
});
export const uiPublishWarningAlgorithm = defineMessage({
  id: "ui.config.warning.algorithm",
  defaultMessage:
    "Upstream {name} uses {algorithm}, which runs as {runsAs} on Workers.",
  description:
    "Admin UI publish: a published upstream's balancing algorithm runs as round-robin.",
});
export const uiPublishWarningRawSecret = defineMessage({
  id: "ui.config.warning.rawSecret",
  defaultMessage:
    "Plugin {name} keeps {fields} as plain text. Store it as a vault reference, such as '{vault://env/vault-name}', to keep it out of the database.",
  description:
    "Admin UI publish: a plugin secret stored raw where a vault reference would do.",
});
export const cliPublishWarningAlgorithm = defineMessage({
  id: "cli.publish.warning.algorithm",
  defaultMessage:
    "Warning: upstream {name} uses {algorithm}, which runs as {runsAs} on Workers.",
  description:
    "CLI publish: a published upstream's balancing algorithm runs as round-robin.",
});
export const cliPublishWarningRawSecret = defineMessage({
  id: "cli.publish.warning.rawSecret",
  defaultMessage:
    "Warning: plugin {name} keeps {fields} as plain text. Store it as a vault reference, such as '{vault://env/vault-name}', to keep it out of the database.",
  description:
    "CLI publish: a plugin secret stored raw where a vault reference would do.",
});
export const kongValidatePluginNotEnabled = defineMessage({
  id: "kong.validate.pluginNotEnabled",
  defaultMessage: "plugin ''{name}'' is not enabled in this gateway",
  description:
    "Kong-compatible schema validation: a plugin the gateway doesn't bundle.",
});
export const adminRoutePath = defineMessage({
  id: "admin.routes.path",
  defaultMessage: 'must start with "/", or "~" for a regular expression',
  description:
    "Admin API: a route path that Kong wouldn't accept, shown under the path field.",
});
export const adminSandboxLimit = defineMessage({
  id: "admin.sandbox.limit",
  defaultMessage: "must be between 1 and {max}",
  description:
    "Admin API: an uploaded plugin's CPU time or subrequest limit outside the sandbox's, shown under that field. {max} is the sandbox's limit.",
});
export const kongValidateVaultOnly = defineMessage({
  id: "kong.validate.vaultOnly",
  defaultMessage:
    "must be a vault reference ('{vault://...}'): Edgway never stores this secret",
  description:
    "Kong-compatible schema validation: a secret field that only takes a vault reference.",
});
export const kongValidateUnknownEntity = defineMessage({
  id: "kong.validate.unknownEntity",
  defaultMessage: "No entity named ''{name}''",
  description:
    "Kong-compatible schema validation: an entity type Edgway doesn't have, in Kong's words.",
});
export const kongValidateViolations = defineMessage({
  id: "kong.validate.violations",
  defaultMessage:
    "{count, plural, one {schema violation} other {# schema violations}} ({details})",
  description:
    "Kong-compatible schema validation: the error message, as Kong words it.",
});
export const registryMessageId = defineMessage({
  id: "registry.messageId",
  defaultMessage:
    'The plugin {plugin} has a message with id "{id}": a plugin\'s message ids must start with "{prefix}".',
  description:
    "Registry codegen error: a plugin's message id outside its own namespace.",
});
export const portalUsageTitle = defineMessage({
  id: "portal.usage.title",
  defaultMessage: "Your usage, last {days} days",
  description: "Developer portal API keys page: heading of the usage panel.",
});
export const portalUsageNone = defineMessage({
  id: "portal.usage.none",
  defaultMessage: "No requests with your keys in the last {days} days.",
  description:
    "Developer portal usage panel: the developer made no requests in the window.",
});
export const portalUsageDay = defineMessage({
  id: "portal.usage.day",
  defaultMessage: "Day",
  description: "Developer portal usage panel: the date column.",
});
export const portalUsageRequests = defineMessage({
  id: "portal.usage.requests",
  defaultMessage: "Requests",
  description: "Developer portal usage panel: the request count column.",
});
export const portalUsageErrors = defineMessage({
  id: "portal.usage.errors",
  defaultMessage: "Server errors",
  description: "Developer portal usage panel: the 5xx count column.",
});
export const portalKeysHelp = defineMessage({
  id: "portal.keys.help",
  defaultMessage:
    "A key is shown in full only when you create or rotate it, so copy it then. Rotating a key replaces that key alone: its old value stops working within a few seconds, and your other keys keep working.",
  description:
    "Developer portal API keys page: explains the one-time display and what rotating a key does.",
});
export const portalKeyUnnamed = defineMessage({
  id: "portal.key.unnamed",
  defaultMessage: "Key {prefix}",
  description:
    "Developer portal: the label of a key with no name; prefix is the key's first characters.",
});
export const portalKeyStartsWith = defineMessage({
  id: "portal.key.startsWith",
  defaultMessage:
    "Starts with {prefix}. The full key was shown once, when it was created or rotated.",
  description:
    "Developer portal: under a key after the page reloads; prefix is the key's first characters.",
});
// BEGIN framework strings (scripts/ra-messages.mjs)
// react-admin's (`ra.*`) and react-jsonschema-form's (`rjsf.*`) strings,
// first written from ra-language-english and @rjsf/utils. Ids are the
// libraries' own keys, so their translate calls find them.
export const raActionAddFilter = defineMessage({
  id: "ra.action.add_filter",
  defaultMessage: "Add filter",
  description: "react-admin (ra-core) string: ra.action.add_filter.",
});
export const raActionAdd = defineMessage({
  id: "ra.action.add",
  defaultMessage: "Add",
  description: "react-admin (ra-core) string: ra.action.add.",
});
export const raActionBack = defineMessage({
  id: "ra.action.back",
  defaultMessage: "Go Back",
  description: "react-admin (ra-core) string: ra.action.back.",
});
export const raActionBulkActions = defineMessage({
  id: "ra.action.bulk_actions",
  defaultMessage:
    "{smart_count, plural, one {# item selected} other {# items selected}}",
  description: "react-admin (ra-core) string: ra.action.bulk_actions.",
});
export const raActionCancel = defineMessage({
  id: "ra.action.cancel",
  defaultMessage: "Cancel",
  description: "react-admin (ra-core) string: ra.action.cancel.",
});
export const raActionClearArrayInput = defineMessage({
  id: "ra.action.clear_array_input",
  defaultMessage: "Clear the list",
  description: "react-admin (ra-core) string: ra.action.clear_array_input.",
});
export const raActionClearInputValue = defineMessage({
  id: "ra.action.clear_input_value",
  defaultMessage: "Clear value",
  description: "react-admin (ra-core) string: ra.action.clear_input_value.",
});
export const raActionClone = defineMessage({
  id: "ra.action.clone",
  defaultMessage: "Clone",
  description: "react-admin (ra-core) string: ra.action.clone.",
});
export const raActionConfirm = defineMessage({
  id: "ra.action.confirm",
  defaultMessage: "Confirm",
  description: "react-admin (ra-core) string: ra.action.confirm.",
});
export const raActionCreate = defineMessage({
  id: "ra.action.create",
  defaultMessage: "Create",
  description: "react-admin (ra-core) string: ra.action.create.",
});
export const raActionCreateItem = defineMessage({
  id: "ra.action.create_item",
  defaultMessage: "Create {item}",
  description: "react-admin (ra-core) string: ra.action.create_item.",
});
export const raActionDelete = defineMessage({
  id: "ra.action.delete",
  defaultMessage: "Delete",
  description: "react-admin (ra-core) string: ra.action.delete.",
});
export const raActionEdit = defineMessage({
  id: "ra.action.edit",
  defaultMessage: "Edit",
  description: "react-admin (ra-core) string: ra.action.edit.",
});
export const raActionExport = defineMessage({
  id: "ra.action.export",
  defaultMessage: "Export",
  description: "react-admin (ra-core) string: ra.action.export.",
});
export const raActionList = defineMessage({
  id: "ra.action.list",
  defaultMessage: "List",
  description: "react-admin (ra-core) string: ra.action.list.",
});
export const raActionRefresh = defineMessage({
  id: "ra.action.refresh",
  defaultMessage: "Refresh",
  description: "react-admin (ra-core) string: ra.action.refresh.",
});
export const raActionRemoveFilter = defineMessage({
  id: "ra.action.remove_filter",
  defaultMessage: "Remove this filter",
  description: "react-admin (ra-core) string: ra.action.remove_filter.",
});
export const raActionRemoveAllFilters = defineMessage({
  id: "ra.action.remove_all_filters",
  defaultMessage: "Remove all filters",
  description: "react-admin (ra-core) string: ra.action.remove_all_filters.",
});
export const raActionRemove = defineMessage({
  id: "ra.action.remove",
  defaultMessage: "Remove",
  description: "react-admin (ra-core) string: ra.action.remove.",
});
export const raActionReset = defineMessage({
  id: "ra.action.reset",
  defaultMessage: "Reset",
  description: "react-admin (ra-core) string: ra.action.reset.",
});
export const raActionSave = defineMessage({
  id: "ra.action.save",
  defaultMessage: "Save",
  description: "react-admin (ra-core) string: ra.action.save.",
});
export const raActionSearch = defineMessage({
  id: "ra.action.search",
  defaultMessage: "Search",
  description: "react-admin (ra-core) string: ra.action.search.",
});
export const raActionSearchColumns = defineMessage({
  id: "ra.action.search_columns",
  defaultMessage: "Search columns",
  description: "react-admin (ra-core) string: ra.action.search_columns.",
});
export const raActionSelectAll = defineMessage({
  id: "ra.action.select_all",
  defaultMessage: "Select all",
  description: "react-admin (ra-core) string: ra.action.select_all.",
});
export const raActionSelectAllButton = defineMessage({
  id: "ra.action.select_all_button",
  defaultMessage: "Select all",
  description: "react-admin (ra-core) string: ra.action.select_all_button.",
});
export const raActionSelectRow = defineMessage({
  id: "ra.action.select_row",
  defaultMessage: "Select this row",
  description: "react-admin (ra-core) string: ra.action.select_row.",
});
export const raActionShow = defineMessage({
  id: "ra.action.show",
  defaultMessage: "Show",
  description: "react-admin (ra-core) string: ra.action.show.",
});
export const raActionSort = defineMessage({
  id: "ra.action.sort",
  defaultMessage: "Sort",
  description: "react-admin (ra-core) string: ra.action.sort.",
});
export const raActionUndo = defineMessage({
  id: "ra.action.undo",
  defaultMessage: "Undo",
  description: "react-admin (ra-core) string: ra.action.undo.",
});
export const raActionUnselect = defineMessage({
  id: "ra.action.unselect",
  defaultMessage: "Unselect",
  description: "react-admin (ra-core) string: ra.action.unselect.",
});
export const raActionExpand = defineMessage({
  id: "ra.action.expand",
  defaultMessage: "Expand",
  description: "react-admin (ra-core) string: ra.action.expand.",
});
export const raActionClose = defineMessage({
  id: "ra.action.close",
  defaultMessage: "Close",
  description: "react-admin (ra-core) string: ra.action.close.",
});
export const raActionOpenMenu = defineMessage({
  id: "ra.action.open_menu",
  defaultMessage: "Open menu",
  description: "react-admin (ra-core) string: ra.action.open_menu.",
});
export const raActionCloseMenu = defineMessage({
  id: "ra.action.close_menu",
  defaultMessage: "Close menu",
  description: "react-admin (ra-core) string: ra.action.close_menu.",
});
export const raActionUpdate = defineMessage({
  id: "ra.action.update",
  defaultMessage: "Update",
  description: "react-admin (ra-core) string: ra.action.update.",
});
export const raActionMoveUp = defineMessage({
  id: "ra.action.move_up",
  defaultMessage: "Move up",
  description: "react-admin (ra-core) string: ra.action.move_up.",
});
export const raActionMoveDown = defineMessage({
  id: "ra.action.move_down",
  defaultMessage: "Move down",
  description: "react-admin (ra-core) string: ra.action.move_down.",
});
export const raActionOpen = defineMessage({
  id: "ra.action.open",
  defaultMessage: "Open",
  description: "react-admin (ra-core) string: ra.action.open.",
});
export const raActionToggleTheme = defineMessage({
  id: "ra.action.toggle_theme",
  defaultMessage: "Toggle light/dark mode",
  description: "react-admin (ra-core) string: ra.action.toggle_theme.",
});
export const raActionSelectColumns = defineMessage({
  id: "ra.action.select_columns",
  defaultMessage: "Columns",
  description: "react-admin (ra-core) string: ra.action.select_columns.",
});
export const raActionUpdateApplication = defineMessage({
  id: "ra.action.update_application",
  defaultMessage: "Reload Application",
  description: "react-admin (ra-core) string: ra.action.update_application.",
});
export const raBooleanTrue = defineMessage({
  id: "ra.boolean.true",
  defaultMessage: "Yes",
  description: "react-admin (ra-core) string: ra.boolean.true.",
});
export const raBooleanFalse = defineMessage({
  id: "ra.boolean.false",
  defaultMessage: "No",
  description: "react-admin (ra-core) string: ra.boolean.false.",
});
export const raPageCreate = defineMessage({
  id: "ra.page.create",
  defaultMessage: "Create {name}",
  description: "react-admin (ra-core) string: ra.page.create.",
});
export const raPageDashboard = defineMessage({
  id: "ra.page.dashboard",
  defaultMessage: "Dashboard",
  description: "react-admin (ra-core) string: ra.page.dashboard.",
});
export const raPageEdit = defineMessage({
  id: "ra.page.edit",
  defaultMessage: "{name} {recordRepresentation}",
  description: "react-admin (ra-core) string: ra.page.edit.",
});
export const raPageError = defineMessage({
  id: "ra.page.error",
  defaultMessage: "Something went wrong",
  description: "react-admin (ra-core) string: ra.page.error.",
});
export const raPageLoading = defineMessage({
  id: "ra.page.loading",
  defaultMessage: "Loading",
  description: "react-admin (ra-core) string: ra.page.loading.",
});
export const raPageNotFound = defineMessage({
  id: "ra.page.not_found",
  defaultMessage: "Not Found",
  description: "react-admin (ra-core) string: ra.page.not_found.",
});
export const raPageShow = defineMessage({
  id: "ra.page.show",
  defaultMessage: "{name} {recordRepresentation}",
  description: "react-admin (ra-core) string: ra.page.show.",
});
export const raPageEmpty = defineMessage({
  id: "ra.page.empty",
  defaultMessage: "No {name} yet.",
  description: "react-admin (ra-core) string: ra.page.empty.",
});
export const raPageInvite = defineMessage({
  id: "ra.page.invite",
  defaultMessage: "Do you want to add one?",
  description: "react-admin (ra-core) string: ra.page.invite.",
});
export const raPageAccessDenied = defineMessage({
  id: "ra.page.access_denied",
  defaultMessage: "Access denied",
  description: "react-admin (ra-core) string: ra.page.access_denied.",
});
export const raPageAuthenticationError = defineMessage({
  id: "ra.page.authentication_error",
  defaultMessage: "Authentication error",
  description: "react-admin (ra-core) string: ra.page.authentication_error.",
});
export const raInputFileUploadSeveral = defineMessage({
  id: "ra.input.file.upload_several",
  defaultMessage: "Drop some files to upload, or click to select one.",
  description: "react-admin (ra-core) string: ra.input.file.upload_several.",
});
export const raInputFileUploadSingle = defineMessage({
  id: "ra.input.file.upload_single",
  defaultMessage: "Drop a file to upload, or click to select it.",
  description: "react-admin (ra-core) string: ra.input.file.upload_single.",
});
export const raInputImageUploadSeveral = defineMessage({
  id: "ra.input.image.upload_several",
  defaultMessage: "Drop some pictures to upload, or click to select one.",
  description: "react-admin (ra-core) string: ra.input.image.upload_several.",
});
export const raInputImageUploadSingle = defineMessage({
  id: "ra.input.image.upload_single",
  defaultMessage: "Drop a picture to upload, or click to select it.",
  description: "react-admin (ra-core) string: ra.input.image.upload_single.",
});
export const raInputReferencesAllMissing = defineMessage({
  id: "ra.input.references.all_missing",
  defaultMessage: "Unable to find references data.",
  description: "react-admin (ra-core) string: ra.input.references.all_missing.",
});
export const raInputReferencesManyMissing = defineMessage({
  id: "ra.input.references.many_missing",
  defaultMessage:
    "At least one of the associated references no longer appears to be available.",
  description:
    "react-admin (ra-core) string: ra.input.references.many_missing.",
});
export const raInputReferencesSingleMissing = defineMessage({
  id: "ra.input.references.single_missing",
  defaultMessage: "Associated reference no longer appears to be available.",
  description:
    "react-admin (ra-core) string: ra.input.references.single_missing.",
});
export const raInputPasswordToggleVisible = defineMessage({
  id: "ra.input.password.toggle_visible",
  defaultMessage: "Hide password",
  description:
    "react-admin (ra-core) string: ra.input.password.toggle_visible.",
});
export const raInputPasswordToggleHidden = defineMessage({
  id: "ra.input.password.toggle_hidden",
  defaultMessage: "Show password",
  description: "react-admin (ra-core) string: ra.input.password.toggle_hidden.",
});
export const raMessageAbout = defineMessage({
  id: "ra.message.about",
  defaultMessage: "About",
  description: "react-admin (ra-core) string: ra.message.about.",
});
export const raMessageAccessDenied = defineMessage({
  id: "ra.message.access_denied",
  defaultMessage: "You don’t have the right permissions to access this page",
  description: "react-admin (ra-core) string: ra.message.access_denied.",
});
export const raMessageAreYouSure = defineMessage({
  id: "ra.message.are_you_sure",
  defaultMessage: "Are you sure?",
  description: "react-admin (ra-core) string: ra.message.are_you_sure.",
});
export const raMessageAuthenticationError = defineMessage({
  id: "ra.message.authentication_error",
  defaultMessage:
    "The authentication server returned an error and your credentials could not be checked.",
  description: "react-admin (ra-core) string: ra.message.authentication_error.",
});
export const raMessageAuthError = defineMessage({
  id: "ra.message.auth_error",
  defaultMessage:
    "An error occurred while validating the authentication token.",
  description: "react-admin (ra-core) string: ra.message.auth_error.",
});
export const raMessageBulkDeleteContent = defineMessage({
  id: "ra.message.bulk_delete_content",
  defaultMessage:
    "{smart_count, plural, one {Are you sure you want to delete this {name}?} other {Are you sure you want to delete these # items?}}",
  description: "react-admin (ra-core) string: ra.message.bulk_delete_content.",
});
export const raMessageBulkDeleteTitle = defineMessage({
  id: "ra.message.bulk_delete_title",
  defaultMessage:
    "{smart_count, plural, one {Delete {name}} other {Delete # {name}}}",
  description: "react-admin (ra-core) string: ra.message.bulk_delete_title.",
});
export const raMessageBulkUpdateContent = defineMessage({
  id: "ra.message.bulk_update_content",
  defaultMessage:
    "{smart_count, plural, one {Are you sure you want to update {name} {recordRepresentation}?} other {Are you sure you want to update these # items?}}",
  description: "react-admin (ra-core) string: ra.message.bulk_update_content.",
});
export const raMessageBulkUpdateTitle = defineMessage({
  id: "ra.message.bulk_update_title",
  defaultMessage:
    "{smart_count, plural, one {Update {name} {recordRepresentation}} other {Update # {name}}}",
  description: "react-admin (ra-core) string: ra.message.bulk_update_title.",
});
export const raMessageClearArrayInput = defineMessage({
  id: "ra.message.clear_array_input",
  defaultMessage: "Are you sure you want to clear the whole list?",
  description: "react-admin (ra-core) string: ra.message.clear_array_input.",
});
export const raMessageDeleteContent = defineMessage({
  id: "ra.message.delete_content",
  defaultMessage: "Are you sure you want to delete this {name}?",
  description: "react-admin (ra-core) string: ra.message.delete_content.",
});
export const raMessageDeleteTitle = defineMessage({
  id: "ra.message.delete_title",
  defaultMessage: "Delete {name} {recordRepresentation}",
  description: "react-admin (ra-core) string: ra.message.delete_title.",
});
export const raMessageDetails = defineMessage({
  id: "ra.message.details",
  defaultMessage: "Details",
  description: "react-admin (ra-core) string: ra.message.details.",
});
export const raMessageError = defineMessage({
  id: "ra.message.error",
  defaultMessage:
    "A client error occurred and your request couldn’t be completed.",
  description: "react-admin (ra-core) string: ra.message.error.",
});
export const raMessageInvalidForm = defineMessage({
  id: "ra.message.invalid_form",
  defaultMessage: "The form is not valid. Please check for errors",
  description: "react-admin (ra-core) string: ra.message.invalid_form.",
});
export const raMessageLoading = defineMessage({
  id: "ra.message.loading",
  defaultMessage: "Please wait",
  description: "react-admin (ra-core) string: ra.message.loading.",
});
export const raMessageNo = defineMessage({
  id: "ra.message.no",
  defaultMessage: "No",
  description: "react-admin (ra-core) string: ra.message.no.",
});
export const raMessageNotFound = defineMessage({
  id: "ra.message.not_found",
  defaultMessage: "Either you typed a wrong URL, or you followed a bad link.",
  description: "react-admin (ra-core) string: ra.message.not_found.",
});
export const raMessageSelectAllLimitReached = defineMessage({
  id: "ra.message.select_all_limit_reached",
  defaultMessage:
    "There are too many elements to select them all. Only the first {max} elements were selected.",
  description:
    "react-admin (ra-core) string: ra.message.select_all_limit_reached.",
});
export const raMessageUnsavedChanges = defineMessage({
  id: "ra.message.unsaved_changes",
  defaultMessage:
    "Some of your changes weren’t saved. Are you sure you want to ignore them?",
  description: "react-admin (ra-core) string: ra.message.unsaved_changes.",
});
export const raMessageYes = defineMessage({
  id: "ra.message.yes",
  defaultMessage: "Yes",
  description: "react-admin (ra-core) string: ra.message.yes.",
});
export const raMessagePlaceholderDataWarning = defineMessage({
  id: "ra.message.placeholder_data_warning",
  defaultMessage: "Network issue: Data refresh failed.",
  description:
    "react-admin (ra-core) string: ra.message.placeholder_data_warning.",
});
export const raNavigationClearFilters = defineMessage({
  id: "ra.navigation.clear_filters",
  defaultMessage: "Clear filters",
  description: "react-admin (ra-core) string: ra.navigation.clear_filters.",
});
export const raNavigationNoFilteredResults = defineMessage({
  id: "ra.navigation.no_filtered_results",
  defaultMessage: "No {name} found using the current filters.",
  description:
    "react-admin (ra-core) string: ra.navigation.no_filtered_results.",
});
export const raNavigationNoResults = defineMessage({
  id: "ra.navigation.no_results",
  defaultMessage: "No {name} found",
  description: "react-admin (ra-core) string: ra.navigation.no_results.",
});
export const raNavigationNoMoreResults = defineMessage({
  id: "ra.navigation.no_more_results",
  defaultMessage:
    "The page number {page} is out of boundaries. Try the previous page.",
  description: "react-admin (ra-core) string: ra.navigation.no_more_results.",
});
export const raNavigationPageOutOfBoundaries = defineMessage({
  id: "ra.navigation.page_out_of_boundaries",
  defaultMessage: "Page number {page} out of boundaries",
  description:
    "react-admin (ra-core) string: ra.navigation.page_out_of_boundaries.",
});
export const raNavigationPageOutFromEnd = defineMessage({
  id: "ra.navigation.page_out_from_end",
  defaultMessage: "Cannot go after last page",
  description: "react-admin (ra-core) string: ra.navigation.page_out_from_end.",
});
export const raNavigationPageOutFromBegin = defineMessage({
  id: "ra.navigation.page_out_from_begin",
  defaultMessage: "Cannot go before page 1",
  description:
    "react-admin (ra-core) string: ra.navigation.page_out_from_begin.",
});
export const raNavigationPageRangeInfo = defineMessage({
  id: "ra.navigation.page_range_info",
  defaultMessage: "{offsetBegin}-{offsetEnd} of {total}",
  description: "react-admin (ra-core) string: ra.navigation.page_range_info.",
});
export const raNavigationPartialPageRangeInfo = defineMessage({
  id: "ra.navigation.partial_page_range_info",
  defaultMessage: "{offsetBegin}-{offsetEnd} of more than {offsetEnd}",
  description:
    "react-admin (ra-core) string: ra.navigation.partial_page_range_info.",
});
export const raNavigationCurrentPage = defineMessage({
  id: "ra.navigation.current_page",
  defaultMessage: "Page {page}",
  description: "react-admin (ra-core) string: ra.navigation.current_page.",
});
export const raNavigationPage = defineMessage({
  id: "ra.navigation.page",
  defaultMessage: "Go to page {page}",
  description: "react-admin (ra-core) string: ra.navigation.page.",
});
export const raNavigationFirst = defineMessage({
  id: "ra.navigation.first",
  defaultMessage: "Go to first page",
  description: "react-admin (ra-core) string: ra.navigation.first.",
});
export const raNavigationLast = defineMessage({
  id: "ra.navigation.last",
  defaultMessage: "Go to last page",
  description: "react-admin (ra-core) string: ra.navigation.last.",
});
export const raNavigationNext = defineMessage({
  id: "ra.navigation.next",
  defaultMessage: "Go to next page",
  description: "react-admin (ra-core) string: ra.navigation.next.",
});
export const raNavigationPrevious = defineMessage({
  id: "ra.navigation.previous",
  defaultMessage: "Go to previous page",
  description: "react-admin (ra-core) string: ra.navigation.previous.",
});
export const raNavigationPageRowsPerPage = defineMessage({
  id: "ra.navigation.page_rows_per_page",
  defaultMessage: "Rows per page:",
  description:
    "react-admin (ra-core) string: ra.navigation.page_rows_per_page.",
});
export const raNavigationSkipNav = defineMessage({
  id: "ra.navigation.skip_nav",
  defaultMessage: "Skip to content",
  description: "react-admin (ra-core) string: ra.navigation.skip_nav.",
});
export const raSortSortBy = defineMessage({
  id: "ra.sort.sort_by",
  defaultMessage: "Sort by {field_lower_first} {order}",
  description: "react-admin (ra-core) string: ra.sort.sort_by.",
});
export const raSortASC = defineMessage({
  id: "ra.sort.ASC",
  defaultMessage: "ascending",
  description: "react-admin (ra-core) string: ra.sort.ASC.",
});
export const raSortDESC = defineMessage({
  id: "ra.sort.DESC",
  defaultMessage: "descending",
  description: "react-admin (ra-core) string: ra.sort.DESC.",
});
export const raAuthAuthCheckError = defineMessage({
  id: "ra.auth.auth_check_error",
  defaultMessage: "Please login to continue",
  description: "react-admin (ra-core) string: ra.auth.auth_check_error.",
});
export const raAuthUserMenu = defineMessage({
  id: "ra.auth.user_menu",
  defaultMessage: "Profile",
  description: "react-admin (ra-core) string: ra.auth.user_menu.",
});
export const raAuthUsername = defineMessage({
  id: "ra.auth.username",
  defaultMessage: "Username",
  description: "react-admin (ra-core) string: ra.auth.username.",
});
export const raAuthPassword = defineMessage({
  id: "ra.auth.password",
  defaultMessage: "Password",
  description: "react-admin (ra-core) string: ra.auth.password.",
});
export const raAuthEmail = defineMessage({
  id: "ra.auth.email",
  defaultMessage: "Email",
  description: "react-admin (ra-core) string: ra.auth.email.",
});
export const raAuthSignIn = defineMessage({
  id: "ra.auth.sign_in",
  defaultMessage: "Sign in",
  description: "react-admin (ra-core) string: ra.auth.sign_in.",
});
export const raAuthSignInError = defineMessage({
  id: "ra.auth.sign_in_error",
  defaultMessage: "Authentication failed, please retry",
  description: "react-admin (ra-core) string: ra.auth.sign_in_error.",
});
export const raAuthLogout = defineMessage({
  id: "ra.auth.logout",
  defaultMessage: "Logout",
  description: "react-admin (ra-core) string: ra.auth.logout.",
});
export const raNotificationUpdated = defineMessage({
  id: "ra.notification.updated",
  defaultMessage:
    "{smart_count, plural, one {Element updated} other {# elements updated}}",
  description: "react-admin (ra-core) string: ra.notification.updated.",
});
export const raNotificationCreated = defineMessage({
  id: "ra.notification.created",
  defaultMessage: "Element created",
  description: "react-admin (ra-core) string: ra.notification.created.",
});
export const raNotificationDeleted = defineMessage({
  id: "ra.notification.deleted",
  defaultMessage:
    "{smart_count, plural, one {Element deleted} other {# elements deleted}}",
  description: "react-admin (ra-core) string: ra.notification.deleted.",
});
export const raNotificationBadItem = defineMessage({
  id: "ra.notification.bad_item",
  defaultMessage: "Incorrect element",
  description: "react-admin (ra-core) string: ra.notification.bad_item.",
});
export const raNotificationItemDoesntExist = defineMessage({
  id: "ra.notification.item_doesnt_exist",
  defaultMessage: "Element does not exist",
  description:
    "react-admin (ra-core) string: ra.notification.item_doesnt_exist.",
});
export const raNotificationHttpError = defineMessage({
  id: "ra.notification.http_error",
  defaultMessage: "Server communication error",
  description: "react-admin (ra-core) string: ra.notification.http_error.",
});
export const raNotificationDataProviderError = defineMessage({
  id: "ra.notification.data_provider_error",
  defaultMessage: "dataProvider error. Check the console for details.",
  description:
    "react-admin (ra-core) string: ra.notification.data_provider_error.",
});
export const raNotificationI18nError = defineMessage({
  id: "ra.notification.i18n_error",
  defaultMessage: "Cannot load the translations for the specified language",
  description: "react-admin (ra-core) string: ra.notification.i18n_error.",
});
export const raNotificationCanceled = defineMessage({
  id: "ra.notification.canceled",
  defaultMessage: "Action cancelled",
  description: "react-admin (ra-core) string: ra.notification.canceled.",
});
export const raNotificationLoggedOut = defineMessage({
  id: "ra.notification.logged_out",
  defaultMessage: "Your session has ended, please reconnect.",
  description: "react-admin (ra-core) string: ra.notification.logged_out.",
});
export const raNotificationNotAuthorized = defineMessage({
  id: "ra.notification.not_authorized",
  defaultMessage: "You’re not authorized to access this resource.",
  description: "react-admin (ra-core) string: ra.notification.not_authorized.",
});
export const raNotificationApplicationUpdateAvailable = defineMessage({
  id: "ra.notification.application_update_available",
  defaultMessage: "A new version is available.",
  description:
    "react-admin (ra-core) string: ra.notification.application_update_available.",
});
export const raNotificationOffline = defineMessage({
  id: "ra.notification.offline",
  defaultMessage: "No connectivity. Could not fetch data.",
  description: "react-admin (ra-core) string: ra.notification.offline.",
});
export const raValidationRequired = defineMessage({
  id: "ra.validation.required",
  defaultMessage: "Required",
  description: "react-admin (ra-core) string: ra.validation.required.",
});
export const raValidationMinLength = defineMessage({
  id: "ra.validation.minLength",
  defaultMessage: "Must be {min} characters at least",
  description: "react-admin (ra-core) string: ra.validation.minLength.",
});
export const raValidationMaxLength = defineMessage({
  id: "ra.validation.maxLength",
  defaultMessage: "Must be {max} characters or less",
  description: "react-admin (ra-core) string: ra.validation.maxLength.",
});
export const raValidationMinValue = defineMessage({
  id: "ra.validation.minValue",
  defaultMessage: "Must be at least {min}",
  description: "react-admin (ra-core) string: ra.validation.minValue.",
});
export const raValidationMaxValue = defineMessage({
  id: "ra.validation.maxValue",
  defaultMessage: "Must be {max} or less",
  description: "react-admin (ra-core) string: ra.validation.maxValue.",
});
export const raValidationNumber = defineMessage({
  id: "ra.validation.number",
  defaultMessage: "Must be a number",
  description: "react-admin (ra-core) string: ra.validation.number.",
});
export const raValidationEmail = defineMessage({
  id: "ra.validation.email",
  defaultMessage: "Must be a valid email",
  description: "react-admin (ra-core) string: ra.validation.email.",
});
export const raValidationOneOf = defineMessage({
  id: "ra.validation.oneOf",
  defaultMessage: "Must be one of: {options}",
  description: "react-admin (ra-core) string: ra.validation.oneOf.",
});
export const raValidationRegex = defineMessage({
  id: "ra.validation.regex",
  defaultMessage: "Must match a specific format (regexp): {pattern}",
  description: "react-admin (ra-core) string: ra.validation.regex.",
});
export const raValidationUnique = defineMessage({
  id: "ra.validation.unique",
  defaultMessage: "Must be unique",
  description: "react-admin (ra-core) string: ra.validation.unique.",
});
export const raSavedQueriesLabel = defineMessage({
  id: "ra.saved_queries.label",
  defaultMessage: "Saved queries",
  description: "react-admin (ra-core) string: ra.saved_queries.label.",
});
export const raSavedQueriesQueryName = defineMessage({
  id: "ra.saved_queries.query_name",
  defaultMessage: "Query name",
  description: "react-admin (ra-core) string: ra.saved_queries.query_name.",
});
export const raSavedQueriesNewLabel = defineMessage({
  id: "ra.saved_queries.new_label",
  defaultMessage: "Save current query...",
  description: "react-admin (ra-core) string: ra.saved_queries.new_label.",
});
export const raSavedQueriesNewDialogTitle = defineMessage({
  id: "ra.saved_queries.new_dialog_title",
  defaultMessage: "Save current query as",
  description:
    "react-admin (ra-core) string: ra.saved_queries.new_dialog_title.",
});
export const raSavedQueriesRemoveLabel = defineMessage({
  id: "ra.saved_queries.remove_label",
  defaultMessage: "Remove saved query",
  description: "react-admin (ra-core) string: ra.saved_queries.remove_label.",
});
export const raSavedQueriesRemoveLabelWithName = defineMessage({
  id: "ra.saved_queries.remove_label_with_name",
  defaultMessage: 'Remove query "{name}"',
  description:
    "react-admin (ra-core) string: ra.saved_queries.remove_label_with_name.",
});
export const raSavedQueriesRemoveDialogTitle = defineMessage({
  id: "ra.saved_queries.remove_dialog_title",
  defaultMessage: "Remove saved query?",
  description:
    "react-admin (ra-core) string: ra.saved_queries.remove_dialog_title.",
});
export const raSavedQueriesRemoveMessage = defineMessage({
  id: "ra.saved_queries.remove_message",
  defaultMessage:
    "Are you sure you want to remove that item from your list of saved queries?",
  description: "react-admin (ra-core) string: ra.saved_queries.remove_message.",
});
export const raSavedQueriesHelp = defineMessage({
  id: "ra.saved_queries.help",
  defaultMessage: "Filter the list and save this query for later",
  description: "react-admin (ra-core) string: ra.saved_queries.help.",
});
export const raGuesserEmptyTitle = defineMessage({
  id: "ra.guesser.empty.title",
  defaultMessage: "No data to display",
  description: "react-admin (ra-core) string: ra.guesser.empty.title.",
});
export const raGuesserEmptyMessage = defineMessage({
  id: "ra.guesser.empty.message",
  defaultMessage: "Please check your data provider",
  description: "react-admin (ra-core) string: ra.guesser.empty.message.",
});
export const raConfigurableCustomize = defineMessage({
  id: "ra.configurable.customize",
  defaultMessage: "Customize",
  description: "react-admin (ra-core) string: ra.configurable.customize.",
});
export const raConfigurableConfigureMode = defineMessage({
  id: "ra.configurable.configureMode",
  defaultMessage: "Configure this page",
  description: "react-admin (ra-core) string: ra.configurable.configureMode.",
});
export const raConfigurableInspectorTitle = defineMessage({
  id: "ra.configurable.inspector.title",
  defaultMessage: "Inspector",
  description: "react-admin (ra-core) string: ra.configurable.inspector.title.",
});
export const raConfigurableInspectorContent = defineMessage({
  id: "ra.configurable.inspector.content",
  defaultMessage: "Hover the application UI elements to configure them",
  description:
    "react-admin (ra-core) string: ra.configurable.inspector.content.",
});
export const raConfigurableInspectorReset = defineMessage({
  id: "ra.configurable.inspector.reset",
  defaultMessage: "Reset Settings",
  description: "react-admin (ra-core) string: ra.configurable.inspector.reset.",
});
export const raConfigurableInspectorHideAll = defineMessage({
  id: "ra.configurable.inspector.hideAll",
  defaultMessage: "Hide All",
  description:
    "react-admin (ra-core) string: ra.configurable.inspector.hideAll.",
});
export const raConfigurableInspectorShowAll = defineMessage({
  id: "ra.configurable.inspector.showAll",
  defaultMessage: "Show All",
  description:
    "react-admin (ra-core) string: ra.configurable.inspector.showAll.",
});
export const raConfigurableDatagridTitle = defineMessage({
  id: "ra.configurable.Datagrid.title",
  defaultMessage: "Datagrid",
  description: "react-admin (ra-core) string: ra.configurable.Datagrid.title.",
});
export const raConfigurableDatagridUnlabeled = defineMessage({
  id: "ra.configurable.Datagrid.unlabeled",
  defaultMessage: "Unlabeled column #{column}",
  description:
    "react-admin (ra-core) string: ra.configurable.Datagrid.unlabeled.",
});
export const raConfigurableSimpleFormTitle = defineMessage({
  id: "ra.configurable.SimpleForm.title",
  defaultMessage: "Form",
  description:
    "react-admin (ra-core) string: ra.configurable.SimpleForm.title.",
});
export const raConfigurableSimpleFormUnlabeled = defineMessage({
  id: "ra.configurable.SimpleForm.unlabeled",
  defaultMessage: "Unlabeled input #{input}",
  description:
    "react-admin (ra-core) string: ra.configurable.SimpleForm.unlabeled.",
});
export const raConfigurableSimpleListTitle = defineMessage({
  id: "ra.configurable.SimpleList.title",
  defaultMessage: "List",
  description:
    "react-admin (ra-core) string: ra.configurable.SimpleList.title.",
});
export const raConfigurableSimpleListPrimaryText = defineMessage({
  id: "ra.configurable.SimpleList.primaryText",
  defaultMessage: "Primary text",
  description:
    "react-admin (ra-core) string: ra.configurable.SimpleList.primaryText.",
});
export const raConfigurableSimpleListSecondaryText = defineMessage({
  id: "ra.configurable.SimpleList.secondaryText",
  defaultMessage: "Secondary text",
  description:
    "react-admin (ra-core) string: ra.configurable.SimpleList.secondaryText.",
});
export const raConfigurableSimpleListTertiaryText = defineMessage({
  id: "ra.configurable.SimpleList.tertiaryText",
  defaultMessage: "Tertiary text",
  description:
    "react-admin (ra-core) string: ra.configurable.SimpleList.tertiaryText.",
});
export const rjsfArrayItemTitle = defineMessage({
  id: "rjsf.ArrayItemTitle",
  defaultMessage: "Item",
  description:
    "react-jsonschema-form string: TranslatableString.ArrayItemTitle (placeholders p1, p2).",
});
export const rjsfMissingItems = defineMessage({
  id: "rjsf.MissingItems",
  defaultMessage: "Missing items definition",
  description:
    "react-jsonschema-form string: TranslatableString.MissingItems (placeholders p1, p2).",
});
export const rjsfEmptyArray = defineMessage({
  id: "rjsf.EmptyArray",
  defaultMessage: "No items yet. Use the button below to add some.",
  description:
    "react-jsonschema-form string: TranslatableString.EmptyArray (placeholders p1, p2).",
});
export const rjsfYesLabel = defineMessage({
  id: "rjsf.YesLabel",
  defaultMessage: "Yes",
  description:
    "react-jsonschema-form string: TranslatableString.YesLabel (placeholders p1, p2).",
});
export const rjsfNoLabel = defineMessage({
  id: "rjsf.NoLabel",
  defaultMessage: "No",
  description:
    "react-jsonschema-form string: TranslatableString.NoLabel (placeholders p1, p2).",
});
export const rjsfCloseLabel = defineMessage({
  id: "rjsf.CloseLabel",
  defaultMessage: "Close",
  description:
    "react-jsonschema-form string: TranslatableString.CloseLabel (placeholders p1, p2).",
});
export const rjsfErrorsLabel = defineMessage({
  id: "rjsf.ErrorsLabel",
  defaultMessage: "Errors",
  description:
    "react-jsonschema-form string: TranslatableString.ErrorsLabel (placeholders p1, p2).",
});
export const rjsfNewStringDefault = defineMessage({
  id: "rjsf.NewStringDefault",
  defaultMessage: "New Value",
  description:
    "react-jsonschema-form string: TranslatableString.NewStringDefault (placeholders p1, p2).",
});
export const rjsfAddButton = defineMessage({
  id: "rjsf.AddButton",
  defaultMessage: "Add",
  description:
    "react-jsonschema-form string: TranslatableString.AddButton (placeholders p1, p2).",
});
export const rjsfAddItemButton = defineMessage({
  id: "rjsf.AddItemButton",
  defaultMessage: "Add Item",
  description:
    "react-jsonschema-form string: TranslatableString.AddItemButton (placeholders p1, p2).",
});
export const rjsfCopyButton = defineMessage({
  id: "rjsf.CopyButton",
  defaultMessage: "Copy",
  description:
    "react-jsonschema-form string: TranslatableString.CopyButton (placeholders p1, p2).",
});
export const rjsfExpandButton = defineMessage({
  id: "rjsf.ExpandButton",
  defaultMessage: "Expand Cycle",
  description:
    "react-jsonschema-form string: TranslatableString.ExpandButton (placeholders p1, p2).",
});
export const rjsfMoveDownButton = defineMessage({
  id: "rjsf.MoveDownButton",
  defaultMessage: "Move down",
  description:
    "react-jsonschema-form string: TranslatableString.MoveDownButton (placeholders p1, p2).",
});
export const rjsfMoveUpButton = defineMessage({
  id: "rjsf.MoveUpButton",
  defaultMessage: "Move up",
  description:
    "react-jsonschema-form string: TranslatableString.MoveUpButton (placeholders p1, p2).",
});
export const rjsfRemoveButton = defineMessage({
  id: "rjsf.RemoveButton",
  defaultMessage: "Remove",
  description:
    "react-jsonschema-form string: TranslatableString.RemoveButton (placeholders p1, p2).",
});
export const rjsfNowLabel = defineMessage({
  id: "rjsf.NowLabel",
  defaultMessage: "Now",
  description:
    "react-jsonschema-form string: TranslatableString.NowLabel (placeholders p1, p2).",
});
export const rjsfClearLabel = defineMessage({
  id: "rjsf.ClearLabel",
  defaultMessage: "Clear",
  description:
    "react-jsonschema-form string: TranslatableString.ClearLabel (placeholders p1, p2).",
});
export const rjsfAriaDateLabel = defineMessage({
  id: "rjsf.AriaDateLabel",
  defaultMessage: "Select a date",
  description:
    "react-jsonschema-form string: TranslatableString.AriaDateLabel (placeholders p1, p2).",
});
export const rjsfPreviewLabel = defineMessage({
  id: "rjsf.PreviewLabel",
  defaultMessage: "Preview",
  description:
    "react-jsonschema-form string: TranslatableString.PreviewLabel (placeholders p1, p2).",
});
export const rjsfDecrementAriaLabel = defineMessage({
  id: "rjsf.DecrementAriaLabel",
  defaultMessage: "Decrease value by 1",
  description:
    "react-jsonschema-form string: TranslatableString.DecrementAriaLabel (placeholders p1, p2).",
});
export const rjsfIncrementAriaLabel = defineMessage({
  id: "rjsf.IncrementAriaLabel",
  defaultMessage: "Increase value by 1",
  description:
    "react-jsonschema-form string: TranslatableString.IncrementAriaLabel (placeholders p1, p2).",
});
export const rjsfOptionalObjectAdd = defineMessage({
  id: "rjsf.OptionalObjectAdd",
  defaultMessage: "Add data for optional field",
  description:
    "react-jsonschema-form string: TranslatableString.OptionalObjectAdd (placeholders p1, p2).",
});
export const rjsfOptionalObjectRemove = defineMessage({
  id: "rjsf.OptionalObjectRemove",
  defaultMessage: "Remove data for optional field",
  description:
    "react-jsonschema-form string: TranslatableString.OptionalObjectRemove (placeholders p1, p2).",
});
export const rjsfOptionalObjectEmptyMsg = defineMessage({
  id: "rjsf.OptionalObjectEmptyMsg",
  defaultMessage: "No data for optional field",
  description:
    "react-jsonschema-form string: TranslatableString.OptionalObjectEmptyMsg (placeholders p1, p2).",
});
export const rjsfType = defineMessage({
  id: "rjsf.Type",
  defaultMessage: "Type",
  description:
    "react-jsonschema-form string: TranslatableString.Type (placeholders p1, p2).",
});
export const rjsfValue = defineMessage({
  id: "rjsf.Value",
  defaultMessage: "Value",
  description:
    "react-jsonschema-form string: TranslatableString.Value (placeholders p1, p2).",
});
export const rjsfClearButton = defineMessage({
  id: "rjsf.ClearButton",
  defaultMessage: "clear input",
  description:
    "react-jsonschema-form string: TranslatableString.ClearButton (placeholders p1, p2).",
});
export const rjsfUnknownFieldType = defineMessage({
  id: "rjsf.UnknownFieldType",
  defaultMessage: "Unknown field type {p1}",
  description:
    "react-jsonschema-form string: TranslatableString.UnknownFieldType (placeholders p1, p2).",
});
export const rjsfOptionPrefix = defineMessage({
  id: "rjsf.OptionPrefix",
  defaultMessage: "Option {p1}",
  description:
    "react-jsonschema-form string: TranslatableString.OptionPrefix (placeholders p1, p2).",
});
export const rjsfTitleOptionPrefix = defineMessage({
  id: "rjsf.TitleOptionPrefix",
  defaultMessage: "{p1} option {p2}",
  description:
    "react-jsonschema-form string: TranslatableString.TitleOptionPrefix (placeholders p1, p2).",
});
export const rjsfKeyLabel = defineMessage({
  id: "rjsf.KeyLabel",
  defaultMessage: "{p1} Key",
  description:
    "react-jsonschema-form string: TranslatableString.KeyLabel (placeholders p1, p2).",
});
export const rjsfDeprecatedLabel = defineMessage({
  id: "rjsf.DeprecatedLabel",
  defaultMessage: "{p1} (deprecated)",
  description:
    "react-jsonschema-form string: TranslatableString.DeprecatedLabel (placeholders p1, p2).",
});
export const rjsfCycleDetected = defineMessage({
  id: "rjsf.CycleDetected",
  defaultMessage:
    'Circular reference ($ref cycle) detected for field "{p1}". You may choose to expand to the next cycle break',
  description:
    "react-jsonschema-form string: TranslatableString.CycleDetected (placeholders p1, p2).",
});
export const rjsfInvalidObjectField = defineMessage({
  id: "rjsf.InvalidObjectField",
  defaultMessage: 'Invalid "{p1}" object field configuration: _{p2}_.',
  description:
    "react-jsonschema-form string: TranslatableString.InvalidObjectField (placeholders p1, p2).",
});
export const rjsfUnsupportedField = defineMessage({
  id: "rjsf.UnsupportedField",
  defaultMessage: "Unsupported field schema.",
  description:
    "react-jsonschema-form string: TranslatableString.UnsupportedField (placeholders p1, p2).",
});
export const rjsfUnsupportedFieldWithId = defineMessage({
  id: "rjsf.UnsupportedFieldWithId",
  defaultMessage: "Unsupported field schema for field `{p1}`.",
  description:
    "react-jsonschema-form string: TranslatableString.UnsupportedFieldWithId (placeholders p1, p2).",
});
export const rjsfUnsupportedFieldWithReason = defineMessage({
  id: "rjsf.UnsupportedFieldWithReason",
  defaultMessage: "Unsupported field schema: _{p1}_.",
  description:
    "react-jsonschema-form string: TranslatableString.UnsupportedFieldWithReason (placeholders p1, p2).",
});
export const rjsfUnsupportedFieldWithIdAndReason = defineMessage({
  id: "rjsf.UnsupportedFieldWithIdAndReason",
  defaultMessage: "Unsupported field schema for field `{p1}`: _{p2}_.",
  description:
    "react-jsonschema-form string: TranslatableString.UnsupportedFieldWithIdAndReason (placeholders p1, p2).",
});
export const rjsfFilesInfo = defineMessage({
  id: "rjsf.FilesInfo",
  defaultMessage: "**{p1}** ({p2}, {p3} bytes)",
  description:
    "react-jsonschema-form string: TranslatableString.FilesInfo (placeholders p1, p2).",
});
// END framework strings

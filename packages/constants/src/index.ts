/**
 * The single home for Edgway's shared values (CLAUDE.md §2): header names,
 * KV key formats, limits and defaults. Pure data: nothing to reuse from npm.
 */

export const PRODUCT = {
  name: "edgway",
  adminService: "edgway-admin",
} as const;

/**
 * The gateway's own endpoints, under a prefix no route should use (Drew):
 * every other path, `/` and `/health` included, is the data plane's.
 */
export const GATEWAY_ENDPOINTS = {
  info: "/__edgway/",
  health: "/__edgway/health",
} as const;

/** HTTP header names, lower-case (Headers lookups are case-insensitive). */
export const HEADER = {
  // Edgway's own response and request headers.
  route: "x-edgway-route",
  // The route tester: a signed request for a trace, and the trace.
  traceToken: "x-edgway-trace-token",
  trace: "x-edgway-trace",
  cache: "x-edgway-cache",
  cacheTtl: "x-edgway-cache-ttl",
  cacheAuthVary: "x-edgway-auth-vary",
  requestId: "x-edgway-request-id",
  // Credentials and client identity.
  apiKey: "x-api-key",
  /** Anthropic's API version header (ai-proxy). */
  anthropicVersion: "anthropic-version",
  adminToken: "x-admin-token",
  authorization: "authorization",
  wwwAuthenticate: "www-authenticate",
  proxyAuthorization: "proxy-authorization",
  // Kong's upstream consumer headers, set by auth plugins.
  consumerId: "x-consumer-id",
  consumerCustomId: "x-consumer-custom-id",
  consumerUsername: "x-consumer-username",
  credentialIdentifier: "x-credential-identifier",
  anonymousConsumer: "x-anonymous-consumer",
  consumerGroups: "x-consumer-groups",
  authenticatedGroups: "x-authenticated-groups",
  authenticatedUserid: "x-authenticated-userid",
  authenticatedScope: "x-authenticated-scope",
  clientIp: "cf-connecting-ip",
  forwardedFor: "x-forwarded-for",
  forwardedBy: "x-forwarded-by",
  // Kong's other forwarding headers, set on every proxied request.
  forwardedProto: "x-forwarded-proto",
  forwardedHost: "x-forwarded-host",
  forwardedPort: "x-forwarded-port",
  realIp: "x-real-ip",
  host: "host",
  // Cloudflare Access service token (Tunnel fallback for Workers VPC).
  cfAccessClientId: "cf-access-client-id",
  cfAccessClientSecret: "cf-access-client-secret",
  /** The Cloudflare Access JWT on requests to an Access-protected app. */
  cfAccessJwtAssertion: "cf-access-jwt-assertion",
  /** A user's Access token (`cloudflared access token`), which Access checks at the edge. */
  cfAccessToken: "cf-access-token",
  /** decK's and Terraform's token for the Kong-compatible admin mount. */
  kongAdminToken: "kong-admin-token",
  // Rate limiting.
  rateLimitLimit: "x-ratelimit-limit",
  rateLimitRemaining: "x-ratelimit-remaining",
  // IETF draft RateLimit headers, as Kong sends them for the tightest window.
  rateLimitStandardLimit: "ratelimit-limit",
  rateLimitStandardRemaining: "ratelimit-remaining",
  rateLimitStandardReset: "ratelimit-reset",
  retryAfter: "retry-after",
  // Caching.
  cacheControl: "cache-control",
  cacheTag: "cache-tag",
  // Kong's proxy-cache diagnostic headers.
  cacheStatus: "x-cache-status",
  cacheKey: "x-cache-key",
  age: "age",
  // Stored alongside a cached response, never sent to clients.
  cachedAt: "x-edgway-cached-at",
  cachedTtl: "x-edgway-cached-ttl",
  expires: "expires",
  cachedCacheControl: "x-edgway-cached-cache-control",
  setCookie: "set-cookie",
  /** A client's cookies: proxy-cache never shares a response to them. */
  cookie: "cookie",
  contentType: "content-type",
  contentLength: "content-length",
  transferEncoding: "transfer-encoding",
  vary: "vary",
  acceptEncoding: "accept-encoding",
  acceptLanguage: "accept-language",
  // CORS (hono/cors sets the rest).
  origin: "origin",
  /** Sent by browsers on every request (Fetch Metadata); CSRF checks. */
  secFetchSite: "sec-fetch-site",
  accessControlAllowOrigin: "access-control-allow-origin",
  accessControlAllowCredentials: "access-control-allow-credentials",
  accessControlExposeHeaders: "access-control-expose-headers",
  accessControlRequestMethod: "access-control-request-method",
  accessControlRequestPrivateNetwork: "access-control-request-private-network",
  accessControlAllowPrivateNetwork: "access-control-allow-private-network",
  /** The LLM that answered: `<provider>/<model>` (ai-proxy; Kong's X-Kong-LLM-Model). */
  llmModel: "x-edgway-llm-model",
} as const;

/** Values of the `x-edgway-cache` response header. */
export const CACHE_STATUS = {
  hit: "HIT",
  miss: "MISS",
  bypass: "BYPASS",
  store: "STORE",
} as const;

/** Authorization header schemes. */
export const AUTH_SCHEME = {
  bearer: "Bearer",
  apiKey: "ApiKey",
  /** Kong key-auth's WWW-Authenticate scheme. */
  key: "Key",
  basic: "Basic",
} as const;

/** `WWW-Authenticate` challenge values, as Kong sends them. */
export const WWW_AUTHENTICATE = {
  /** key-auth: `Key realm="<realm>"`, or just `Key` without a realm. */
  key: (realm?: string) =>
    realm ? `${AUTH_SCHEME.key} realm="${realm}"` : AUTH_SCHEME.key,
  /** jwt: `Bearer realm="<realm>"`, or just `Bearer` without a realm. */
  bearer: (realm?: string) =>
    realm ? `${AUTH_SCHEME.bearer} realm="${realm}"` : AUTH_SCHEME.bearer,
  /** basic-auth: `Basic realm="<realm>"` (Kong's default realm is "service"). */
  basic: (realm: string) => `${AUTH_SCHEME.basic} realm="${realm}"`,
  /** jwt, for a token that was sent but rejected (Kong's `invalid_token`). */
  bearerInvalidToken: (realm?: string) =>
    `${realm ? `${AUTH_SCHEME.bearer} realm="${realm}"` : AUTH_SCHEME.bearer} error="invalid_token"`,
} as const;

/** Authorization header values. */
export const AUTHORIZATION = {
  /** `Basic <base64(user:password)>`. */
  basic: (base64Credentials: string) =>
    `${AUTH_SCHEME.basic} ${base64Credentials}`,
  /** `Bearer <token>`. */
  bearer: (token: string) => `${AUTH_SCHEME.bearer} ${token}`,
} as const;

/** Media types. */
export const MEDIA_TYPE = {
  problemJson: "application/problem+json",
  json: "application/json",
  formUrlencoded: "application/x-www-form-urlencoded",
  /** Kong request-termination's default for a raw `body`. */
  jsonUtf8: "application/json; charset=utf-8",
  /** Server-sent events (streamed LLM answers). */
  eventStream: "text/event-stream",
} as const;

/** Config snapshot loading (ConfigStore adapter). */
export const CONFIG = {
  /** How often an isolate asks the ConfigVersion Durable Object for the live version. */
  versionCheckMs: 1_000,
  /** The ConfigVersion Durable Object instance every gateway reads. */
  versionObjectName: "global",
  /** Tries a publish makes when concurrent publishes keep claiming first. */
  publishAttempts: 3,
  /**
   * Extra attempts an admin publish gets when it loses only to portal
   * batches: those publish at most once per PORTAL.publishBatchMs,
   * so an admin publish retries rather than failing.
   */
  portalConflictRetries: 10,
  /** Published versions always kept, newest first. */
  retainVersions: 100,
  /** Versions published this recently are kept too. */
  retainSeconds: 7 * 24 * 60 * 60,
  /** Versions pruned per publish at most: a bound on KV deletes. */
  pruneBatch: 50,
} as const;

/** KV key formats for the published config snapshot (PRD "Control plane"). */
export const KV_KEY = {
  configCurrent: "config:current",
  configVersion: (version: number) => `config:v${version}`,
} as const;

/** Credential formats. */
export const API_KEY = {
  prefix: "edg_",
  /** Characters of the raw key kept for display and lookup. */
  displayPrefixLength: 8,
  /**
   * A key shorter than this shows no prefix: 8 characters of a short
   * user-supplied key would reveal most of it.
   */
  minPrefixedLength: 32,
  /** Random bytes in a generated key. */
  randomBytes: 24,
  /** nanoid characters in a generated key (6 bits each: 192 bits). */
  randomChars: 32,
} as const;

/** Browser storage keys used by the admin UI. */
export const STORAGE_KEY = {
  adminToken: "edgway_admin_token",
} as const;

/** Defaults applied when a policy omits a value. */
export const DEFAULTS = {
  rateLimitStrategy: "sliding",
  rateLimitBy: "ip",
  unknownClientIp: "unknown",
  /** Kong's default `jwt_secrets.algorithm`. */
  jwtAlgorithm: "HS256",
} as const;

/**
 * Identity headers only the gateway may set: a client's copies are
 * removed on every route before any plugin runs, so the upstream never sees
 * a spoofed identity.
 */
export const IDENTITY_HEADERS: readonly string[] = [
  HEADER.consumerId,
  HEADER.consumerCustomId,
  HEADER.consumerUsername,
  HEADER.credentialIdentifier,
  HEADER.anonymousConsumer,
  HEADER.consumerGroups,
  HEADER.authenticatedGroups,
  HEADER.authenticatedUserid,
  HEADER.authenticatedScope,
];

/** Third-party plugins in Dynamic Worker sandboxes. */
export const SANDBOX = {
  /** CPU time per invocation when a sandbox plugin sets none. */
  cpuMs: 50,
  /** Subrequests per invocation when a sandbox plugin sets none (the network is off; these reach bindings). */
  subRequests: 10,
  /** The most CPU time an uploaded plugin may ask for per invocation. */
  maxCpuMs: 500,
  /** The most subrequests an uploaded plugin may ask for per invocation. */
  maxSubRequests: 50,
  /** Largest uploaded plugin source, in bytes. */
  maxCodeBytes: 1_048_576,
  /** Compatibility date of the sandbox's harness and plugin modules. */
  compatibilityDate: "2025-04-14",
  /** Module names inside the Dynamic Worker. */
  harnessModule: "harness.js",
  pluginModule: "plugin.js",
} as const;

/** Plugin runner limits (@edgway/core): per-plugin timeout and circuit breaker. */
export const PLUGIN_RUNNER = {
  /** Longest a plugin's own work in one phase may take. */
  timeoutMs: 3000,
  /** Consecutive failures that open a plugin's circuit. */
  breakerFailures: 5,
  /** How long an open circuit waits before letting one call through. */
  breakerHalfOpenMs: 30_000,
} as const;

/** OpenID Connect (openid-connect plugin). */
export const OIDC = {
  /** The discovery document path, which Kong's `issuer` may already include. */
  wellKnownPath: "/.well-known/openid-configuration",
  /** RFC 6750 query parameter for bearer tokens. */
  accessTokenQuery: "access_token",
  /** Separator in scope strings and in Kong's `*_required` entries (AND). */
  listSeparator: " ",
  /** Separator in `upstream_access_token_header` ("authorization:bearer"). */
  headerTypeSeparator: ":",
  /** Separator for multi-valued claims sent upstream in one header. */
  claimJoin: ",",
  /** Signature algorithms accepted for bearer tokens (JWKS keys are asymmetric). */
  algorithms: [
    "RS256",
    "RS384",
    "RS512",
    "PS256",
    "PS384",
    "PS512",
    "ES256",
    "ES384",
    "ES512",
    "EdDSA",
  ],
} as const;

/** acl plugin. */
export const ACL = {
  /** How Kong joins groups in `X-Consumer-Groups` and `X-Authenticated-Groups`. */
  groupsJoin: ", ",
} as const;

/** Milliseconds in a second: Date.now() against Unix-second columns. */
export const MS_PER_SECOND = 1_000;

/** rate-limiting: each Kong window's length (stores that count by duration). */
export const RATE_LIMIT_WINDOW_MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  /** Approximate: 30 days (the DO counter uses calendar months). */
  month: 2_592_000_000,
  /** Approximate: 365 days (the DO counter uses calendar years). */
  year: 31_536_000_000,
} as const;

/** request-size-limiting: Kong's `size_unit` in bytes (binary multiples, as Kong). */
export const SIZE_UNIT_BYTES = {
  bytes: 1,
  kilobytes: 1_024,
  megabytes: 1_048_576,
} as const;

/** request-/response-transformer (bounded body buffer). */
export const TRANSFORMER = {
  /** Largest body the transformers read to rewrite; bigger ones pass through. */
  maxBodyBytes: 1_048_576,
  /** Kong's `name:value` entries. */
  pairSeparator: ":",
} as const;

/** Kong's proxy-cache `X-Cache-Status` values. */
export const KONG_CACHE_STATUS = {
  hit: "Hit",
  miss: "Miss",
  refresh: "Refresh",
  bypass: "Bypass",
} as const;

/** Cache-Control directives proxy-cache reads (RFC 9111). */
export const CACHE_DIRECTIVE = {
  noStore: "no-store",
  noCache: "no-cache",
  private: "private",
  maxAge: "max-age",
  sMaxAge: "s-maxage",
  maxStale: "max-stale",
  minFresh: "min-fresh",
} as const;

/** correlation-id: separators in Kong's generated ids. */
export const CORRELATION_ID = {
  /** `uuid#counter`: the isolate's uuid, `#`, then a counter. */
  counterSeparator: "#",
  /** `tracker`: its parts are joined with `-`. */
  trackerSeparator: "-",
  /** `tracker` without a Cloudflare colo (e.g. local dev). */
  unknownColo: "edge",
} as const;

/** http-log: Kong's log entry. */
export const HTTP_LOG = {
  /**
   * Headers whose values never reach a log endpoint: credentials, including
   * key-auth's default key names and response cookies.
   */
  redactedHeaders: [
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "apikey",
    "x-api-key",
  ],
  /**
   * Query parameters redacted in logged URLs: the auth plugins' default
   * credential names (key-auth `apikey`, jwt `jwt`) and common token names.
   */
  redactedQueryParams: [
    "apikey",
    "api_key",
    "x-api-key",
    "jwt",
    "access_token",
  ],
  /**
   * The auth plugins' config fields naming where they read credentials, so
   * a config's own names are redacted too: Kong's key-auth looks
   * for `key_names` in headers and the query; jwt has one field for each.
   */
  credentialFields: {
    "key-auth": { headers: ["key_names"], query: ["key_names"] },
    jwt: { headers: ["header_names"], query: ["uri_param_names"] },
  } as Readonly<
    Record<string, { headers: readonly string[]; query: readonly string[] }>
  >,
  redacted: "REDACTED",
  /** Latency Edgway cannot measure (Kong's `proxy` time is the upstream's). */
  unknownLatency: -1,
  /** The retry queue consumer's per-delivery timeout (Kong's default `timeout`). */
  retryTimeoutMs: 10_000,
  /** Queue retry backoff: doubles per attempt from the base, up to the cap. */
  retryBaseDelaySeconds: 2,
  retryMaxDelaySeconds: 300,
} as const;

/** Per-isolate caches kept by plugins. */
export const PLUGIN_CACHE = {
  /** Imported jwt public keys (PEM + algorithm) kept per isolate. */
  jwtPublicKeys: 256,
  /** Discovered OpenID Connect issuers kept per isolate. */
  oidcIssuers: 64,
} as const;

/** Upstream balancing defaults (Kong target weight; passive-health recovery). */
export const BALANCER = {
  /** Kong's default target weight. */
  targetWeight: 100,
  /** How long a target marked unhealthy waits before one trial request. */
  unhealthyRetryMs: 10_000,
} as const;

/** Upstream defaults, as Kong's service defaults (retries, timeouts in ms). */
export const UPSTREAM = {
  /**
   * The balancer algorithms the gateway runs. Kong's others
   * (`least-connections`, `latency`) are accepted and run as `fallback`, and
   * every publish says so.
   */
  algorithms: ["round-robin", "consistent-hashing"] as readonly string[],
  fallbackAlgorithm: "round-robin",
  retries: 5,
  connectTimeoutMs: 60_000,
  readTimeoutMs: 60_000,
  /** A service tag naming the gateway's Service Binding to send to. */
  bindingTag: "edgway-binding:",
  /** A service tag naming the gateway's Workers VPC service binding. */
  tunnelTag: "edgway-tunnel:",
  /**
   * A service tag may name only a binding whose name starts with this, so
   * the gateway's own bindings can never be selected.
   */
  bindingPrefix: "UPSTREAM_",
} as const;

/**
 * Kong's route `https_redirect_status_code` values that redirect plain HTTP
 * to HTTPS; any other value (Kong's default, 426) refuses it.
 */
export const HTTPS_REDIRECT = {
  statuses: [301, 302, 307, 308] as readonly number[],
} as const;

/** The developer portal's self-serve keys. */
export const PORTAL = {
  /**
   * How a list var (PORTAL_CONNECT_SRC, PORTAL_ALLOWED_EMAIL_DOMAINS) is
   * split: spaces or commas.
   */
  listSeparator: /[\s,]+/,
  /**
   * The detail of the 403 a developer outside PORTAL_ALLOWED_EMAIL_DOMAINS
   * gets.
   */
  notAllowedDetail: "portal_not_allowed",
  /**
   * The detail of the 403 a developer gets when the IdP gives an email it
   * hasn't verified: they can fix it, so it isn't "not allowed".
   */
  unverifiedDetail: "portal_email_unverified",
  /** The detail of the 403 a developer an admin blocked gets. */
  blockedDetail: "portal_blocked",
  /** API keys one developer's consumer may hold. */
  maxKeysPerConsumer: 5,
  /**
   * How long one isolate keeps a developer's usage before asking Analytics
   * Engine again, and how many developers' usage it keeps.
   */
  usageCacheMs: 60_000,
  usageCacheEntries: 1000,
  /** A key's name, as the portal's label field allows. */
  maxKeyNameLength: 32,
  /**
   * How long the admin gathers developers' key changes before one publish
   *: a burst is one publish, and portal publishes run at most
   * once per window.
   */
  publishBatchMs: 1_000,
  /** The admin's single PortalPublisher Durable Object, by name. */
  publisherObjectName: "portal",
  /** Who the audit log names for a portal batch publish. */
  actor: "portal",
  /**
   * Developers (portal consumers) one install may have: each one's
   * keys are in every published snapshot, which must stay under KV's value
   * limit.
   */
  maxDevelopers: 10_000,
  /**
   * Key writes (create, roll, delete) one developer may make per minute
   *, enforced by the PORTAL_WRITES Rate Limiting binding, whose
   * wrangler config must match.
   */
  writesPerMinute: 10,
  /** The Rate Limiting binding's period, in seconds (10 or 60). */
  writesPeriodSeconds: 60,
  /**
   * How long the portal waits after a failed OIDC discovery before its
   * pages' CSP tries discovery again: an IdP that is down, or a
   * mistyped issuer, is asked once a minute per isolate, not on every page
   * and asset request.
   */
  discoveryRetryMs: 60_000,
  /** How long that discovery may take before it counts as failed. */
  discoveryTimeoutMs: 5_000,
} as const;

/** Admin API list paging (Kong's Admin API defaults). */
export const ADMIN_PAGE = {
  defaultSize: 100,
  maxSize: 1000,
} as const;

/** The audit log's pages: newest first, a cursor per page. */
export const AUDIT_PAGE = {
  defaultSize: 50,
  maxSize: 200,
} as const;

/** Placeholders for secret fields in the admin's staged-changes diff. */
export const ADMIN_DIFF = {
  redacted: "REDACTED",
  /** The secret differs from the published one (e.g. a rotated key). */
  redactedChanged: "REDACTED:changed",
} as const;

export const ADMIN = {
  /** The workspace a self-hosted install uses when none is configured. */
  defaultWorkspaceId: "00000000-0000-7000-8000-000000000000",
} as const;

/** What the Kong-compatible admin mount reports about itself (Kong 3.9). */
export const KONG_COMPAT = {
  version: "3.9.0",
  /** "postgres" makes decK use the per-entity endpoints (not DB-less /config). */
  database: "postgres",
  tagline: "Welcome to kong",
  hostname: "edgway",
  /** Kong's default workspace: `/default/...` paths are served too (Kong's Terraform provider uses them). */
  defaultWorkspace: "default",
  /**
   * Kong's answers to `POST /schemas/{entity}/validate`, which decK
   * `gateway validate` calls: its success message, and its schema-violation
   * error (code 2, as Kong's `Errors.codes.SCHEMA_VIOLATION`).
   */
  validation: {
    ok: "schema validation successful",
    violation: "schema violation",
    violationCode: 2,
  },
  /** Stands in for a reference's id when validating: validation never looks it up. */
  validationReferenceId: "00000000-0000-4000-8000-000000000000",
} as const;

/** Kong's secret reference syntax, `{vault://<prefix>/<key>}` (never a raw secret in D1). */
export const VAULT_REFERENCE = { prefix: "{vault://", suffix: "}" } as const;

/** TLS certificates in the admin UI. */
export const CERTIFICATES = {
  /** A certificate expiring within this many days is flagged. */
  expiryWarningDays: 14,
} as const;

/**
 * The vaults the gateway resolves (PRD "Vault"): Kong's `env` vault
 * (`{vault://env/vault-my-secret}` reads VAULT_MY_SECRET) and Cloudflare Secrets Store
 * (`{vault://cf-secrets-store/VAULT_NAME}` reads the Secrets Store binding VAULT_NAME).
 */
export const VAULTS = {
  env: "env",
  secretsStore: "cf-secrets-store",
  separator: "/",
  /**
   * Both vaults read only names starting with this, so a reference can't
   * read the Worker's own secrets, vars or bindings (the
   * Secrets Store too since an earlier release).
   */
  namePrefix: "VAULT_",
  /**
   * In a published plugin's `vault_paths`, a path step that stands for every
   * item of an array.
   */
  anyItem: "[]",
  /** A snapshot with unresolved secrets is retried after this long (a vault outage). */
  retryMs: 10_000,
} as const;

/**
 * Secrets the admin never shows unless they are vault references:
 * entity columns by table, and config fields at any depth of a plugin's config.
 */
export const SECRETS = {
  /** Hash columns: always masked (never references). */
  hashFields: {
    keyauth_credentials: ["key_hash"],
    basicauth_credentials: ["password"],
  } as Readonly<Record<string, readonly string[]>>,
  entityFields: {
    jwt_secrets: ["secret"],
    certificates: ["key", "key_alt"],
  } as Readonly<Record<string, readonly string[]>>,
  /**
   * How Kong's plugin schemas mark a secret field (its description); masked
   * fields come from the schemas.
   */
  kongEncryptedMarker: "[encrypted]",
  /** How Kong's plugin schemas mark a field that may hold a vault reference. */
  kongReferenceableMarker: "[referenceable]",
  /** Config fields masked when a config has no Kong schema (uploaded plugins). */
  configFields: [
    "secret",
    "client_secret",
    "session_secret",
    "password",
    "header_value",
    "param_value",
    "api_key",
    "private_key",
  ] as readonly string[],
} as const;

/** Kong's default upstream port for a service `url` without one. */
export const SERVICE_URL_PORT: Readonly<Record<string, number>> = {
  http: 80,
  https: 443,
  grpc: 80,
  grpcs: 443,
  ws: 80,
  wss: 443,
};

/**
 * The `key` the Kong-compatible admin returns for a key-auth credential: keys
 * are stored hashed, and decK needs a unique value. Writing it back keeps the key.
 */
export const KONG_HIDDEN_KEY = { prefix: "edgway-hashed:" } as const;

/** The `edgway` CLI's defaults: its config file, the Workers it drives, and its env vars. */
export const CLI = {
  /** c12 config name: `edgway.config.ts` (or .js, .json, …). */
  configName: "edgway",
  configFile: "edgway.config.ts",
  adminConfig: "apps/admin/wrangler.jsonc",
  gatewayConfig: "apps/gateway/wrangler.jsonc",
  portalConfig: "apps/portal/wrangler.jsonc",
  /** The admin's D1 binding, which `import-deck` writes through. */
  adminDatabaseBinding: "DB",
  /** The published-snapshot KV namespace: its binding (every Worker) and title. */
  kvBinding: "CONFIG_KV",
  kvTitle: "edgway-config",
  /** Worker secrets `edgway deploy` installs: two Ed25519 pairs. */
  secrets: {
    snapshotSigning: "CONFIG_SIGNING_KEY",
    snapshotPublic: "CONFIG_PUBLIC_KEY",
    traceSigning: "TRACE_SIGNING_KEY",
    tracePublic: "TRACE_PUBLIC_KEY",
  },
  /** The admin's deploy-time copy without its GATEWAY binding, beside its config. */
  bootstrapConfig: ".deploy-bootstrap.wrangler.json",
  /** Where `edgway plugin new` creates packages. */
  pluginDir: "plugins",
  env: {
    adminUrl: "EDGWAY_ADMIN_URL",
    accessClientId: "CF_ACCESS_CLIENT_ID",
    accessClientSecret: "CF_ACCESS_CLIENT_SECRET",
    accessToken: "CF_ACCESS_TOKEN",
    /** A Kong-Admin-Token, for `import-deck --remote`. */
    kongToken: "EDGWAY_KONG_TOKEN",
    /**
     * Set by Workers Builds for the Worker a build is connected to. `edgway
     * deploy` deploys three Workers by their own names, so its wrangler runs
     * never see them.
     */
    workersBuildsName: "WRANGLER_CI_OVERRIDE_NAME",
    workersBuildsTag: "WRANGLER_CI_MATCH_TAG",
  },
  /** Hosts where the admin runs without Cloudflare Access in front (local dev). */
  localHosts: ["localhost", "127.0.0.1", "[::1]"],
} as const;

/** The admin UI (apps/ui), served by the admin Worker under this path. */
export const ADMIN_UI = { basePath: "/ui" } as const;

/**
 * Response headers for the admin UI and the developer portal: a
 * Content-Security-Policy that keeps both out of frames and limits scripts
 * to their own origin, plus nosniff and a referrer policy. Directives are in
 * hono/secure-headers' shape.
 */
export const SECURITY_HEADERS = {
  contentTypeOptions: "nosniff",
  frameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  /** The admin UI (React, ra-core, Monaco's same-origin workers). */
  adminUiCsp: {
    defaultSrc: ["'self'"],
    // The plugin forms' validator (RJSF's ajv8) compiles each JSON Schema
    // with `new Function`. Inline and other origins' scripts stay blocked.
    scriptSrc: ["'self'", "'unsafe-eval'"],
    // Libraries (Monaco, Radix) set inline styles.
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    workerSrc: ["'self'", "blob:"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
  /**
   * The portal (Zudoku). At run time connectSrc also gets the OIDC issuer's
   * origin, the origins of the endpoints its discovery document names (the
   * browser signs in against them) and PORTAL_CONNECT_SRC's origins (the
   * API reference playground's API).
   */
  portalCsp: {
    defaultSrc: ["'self'"],
    // Zudoku's pages carry an inline bootstrap script.
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    fontSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    workerSrc: ["'self'", "blob:"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
} as const;

/** The route tester's trace: a short-lived token the admin signs with its snapshot key. */
export const TRACE = {
  audience: "edgway-trace",
  tokenTtl: "60s",
  /** The tester returns at most this much of the response body. */
  maxBodyBytes: 65536,
  /** The trace entry for the upstream call, when it was made. */
  upstream: "upstream",
} as const;

/** The overview dashboard's Analytics Engine reads. */
export const ANALYTICS = {
  /** Cloudflare's Analytics Engine SQL API for an account. */
  sqlApi: (accountId: string) =>
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`,
  /** The overview covers this many hours, in hourly buckets. */
  overviewHours: 24,
  /** The overview's time ranges, in hours: an hour, a day, a week. */
  overviewRanges: [1, 24, 168],
  /** Routes listed in the overview's busiest-routes table. */
  topRoutes: 10,
  /** Consumers listed in the overview's top-consumers table. */
  topConsumers: 10,
  /** Days of usage a portal developer sees. */
  portalUsageDays: 7,
  /**
   * Plugin timing data points written per request at most.
   * Analytics Engine accepts 250 per invocation, and the request's own
   * data point needs one.
   */
  pluginPointsPerRequest: 50,
  /**
   * The overview's queries (Analytics Engine SQL), over the column names
   * @edgway/telemetry assigns. Rows count with their sampling weight.
   */
  sql: {
    /** Hourly requests, server errors and mean latency. */
    series: (q: {
      dataset: string;
      status: string;
      durationMs: string;
      hours: number;
    }) =>
      `SELECT toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS hour, SUM(_sample_interval) AS requests, SUM(IF(${q.status} >= 500, _sample_interval, 0)) AS errors, SUM(_sample_interval * ${q.durationMs}) / SUM(_sample_interval) AS mean_ms FROM ${q.dataset} WHERE timestamp > NOW() - INTERVAL '${Math.trunc(q.hours)}' HOUR GROUP BY hour ORDER BY hour`,
    /** The busiest routes. */
    routes: (q: {
      dataset: string;
      route: string;
      status: string;
      hours: number;
      limit: number;
    }) =>
      `SELECT ${q.route} AS route, SUM(_sample_interval) AS requests, SUM(IF(${q.status} >= 500, _sample_interval, 0)) AS errors FROM ${q.dataset} WHERE timestamp > NOW() - INTERVAL '${Math.trunc(q.hours)}' HOUR GROUP BY route ORDER BY requests DESC LIMIT ${Math.trunc(q.limit)}`,
    /** p50 and p99 latency over the window, weighted by sampling. */
    latency: (q: { dataset: string; durationMs: string; hours: number }) =>
      `SELECT quantileExactWeighted(0.5)(${q.durationMs}, _sample_interval) AS p50_ms, quantileExactWeighted(0.99)(${q.durationMs}, _sample_interval) AS p99_ms FROM ${q.dataset} WHERE timestamp > NOW() - INTERVAL '${Math.trunc(q.hours)}' HOUR`,
    /** The busiest consumers; anonymous traffic is left out. */
    consumers: (q: {
      dataset: string;
      consumer: string;
      status: string;
      hours: number;
      limit: number;
    }) =>
      `SELECT ${q.consumer} AS consumer, SUM(_sample_interval) AS requests, SUM(IF(${q.status} >= 500, _sample_interval, 0)) AS errors FROM ${q.dataset} WHERE timestamp > NOW() - INTERVAL '${Math.trunc(q.hours)}' HOUR AND ${q.consumer} != '' GROUP BY consumer ORDER BY requests DESC LIMIT ${Math.trunc(q.limit)}`,
    /**
     * One consumer's requests and errors per day (the portal's usage panel).
     * `consumerId` must already be checked as a UUID: it is quoted
     * into the query.
     */
    consumerDaily: (q: {
      dataset: string;
      consumer: string;
      status: string;
      consumerId: string;
      days: number;
    }) =>
      `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, SUM(_sample_interval) AS requests, SUM(IF(${q.status} >= 500, _sample_interval, 0)) AS errors FROM ${q.dataset} WHERE timestamp > NOW() - INTERVAL '${Math.trunc(q.days)}' DAY AND ${q.consumer} = '${q.consumerId}' GROUP BY day ORDER BY day`,
  },
} as const;

/**
 * What a publish warns about without refusing it: the `code` of each
 * entry in a publish answer's `warnings`.
 */
export const PUBLISH_WARNING = {
  /** An upstream's algorithm runs as UPSTREAM.fallbackAlgorithm. */
  upstreamAlgorithm: "upstream_algorithm",
  /** A plugin keeps a secret as plain text where a vault reference would do. */
  rawSecret: "plugin_secret_not_referenced",
} as const;

/** The AI plugins. */
export const AI = {
  /** Provider endpoints when `model.options.upstream_url` doesn't override them. */
  openaiUrl: {
    chat: "https://api.openai.com/v1/chat/completions",
    completions: "https://api.openai.com/v1/completions",
  },
  /** `upstream_url` scheme that selects the gateway's Workers AI binding. */
  workersAiScheme: "workers-ai:",
  /** The Workers AI model ai-proxy falls back to when its provider fails. */
  fallbackModel: "@cf/meta/llama-3.1-8b-instruct",
  /** Kong's default provider name in `X-Kong-LLM-Model`-style headers. */
  workersAiProvider: "workers-ai",
  /** How long ai-proxy waits for a provider's answer before falling back, without a service `read_timeout` (Kong's default). */
  timeoutMs: 60_000,
  /** ai-proxy's plugin-runner timeout: above `timeoutMs`, so the provider deadline always ends first. */
  runnerTimeoutMs: 65_000,
  /** The last server-sent event of a streamed answer (OpenAI's). */
  sseDone: "data: [DONE]\n\n",
  /** ai-rate-limiting-advanced reads at most this much of an answer to find its token usage. */
  usageScanBytes: 1_048_576,
  /** ai-rate-limiting-advanced's response headers (`<prefix>-<window>-<provider>`), as Kong names them. */
  rateLimitLimit: "x-ai-ratelimit-limit",
  rateLimitRemaining: "x-ai-ratelimit-remaining",
} as const;

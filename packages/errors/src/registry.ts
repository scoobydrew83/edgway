/**
 * Edgway's error catalog: one registry of stable, documented codes
 * (PRD "Error catalog"). Code ranges are split by domain:
 * AUTH (authentication), RL (rate limiting), UP (upstreams),
 * CFG (routing/config and gateway runtime), PLG (plugins), ADM (admin API).
 *
 * `message` is the catalog descriptor from @edgway/i18n; `t(message)` renders
 * the RFC 9457 `title` in the request's locale.
 */

import type { MessageDescriptor } from "@edgway/i18n";
import {
  errorsAdminAnalyticsFailed,
  errorsAdminConflict,
  errorsAdminDisabled,
  errorsAdminForbidden,
  errorsAdminInvalidRequest,
  errorsAdminKeyLimit,
  errorsAdminNotFound,
  errorsAdminPluginNotEnabled,
  errorsAdminPublishConflict,
  errorsAdminPublishDisabled,
  errorsAdminPublishedInvalid,
  errorsAdminRoleRequired,
  errorsAdminTesterBadRequest,
  errorsAdminTesterUnconfigured,
  errorsAdminUnauthenticated,
  errorsAdminVersionPruned,
  errorsAiPromptBlocked,
  errorsAiProviderFailed,
  errorsAiRateLimited,
  errorsAiRequestInvalid,
  errorsAiStreamingDenied,
  errorsAuthAclForbidden,
  errorsAuthForbidden,
  errorsAuthInvalidCredentials,
  errorsAuthIpNotAllowed,
  errorsAuthIpUnknown,
  errorsAuthKeyDuplicate,
  errorsAuthKeyMissing,
  errorsAuthRequired,
  errorsAuthTokenBad,
  errorsAuthTokenClaimNotNumber,
  errorsAuthTokenConsumerNotFound,
  errorsAuthTokenExpirationTooLong,
  errorsAuthTokenExpired,
  errorsAuthTokenInvalidAlgorithm,
  errorsAuthTokenInvalidSecret,
  errorsAuthTokenInvalidSignature,
  errorsAuthTokenKeyClaimInvalid,
  errorsAuthTokenKeyClaimMissing,
  errorsAuthTokenMultiple,
  errorsAuthTokenNoCredentials,
  errorsAuthTokenNotYetValid,
  errorsConfigHttpsRequired,
  errorsConfigInternal,
  errorsConfigNoRoute,
  errorsConfigPluginUnavailable,
  errorsConfigUnavailable,
  errorsConfigUnknownUpstreamType,
  errorsPluginBodyUntransformable,
  errorsPluginContentLengthRequired,
  errorsPluginHeaderInvalid,
  errorsPluginRequestTerminated,
  errorsPluginRequestTooLarge,
  errorsPortalDeveloperLimit,
  errorsPortalSignInDisabled,
  errorsRateLimitExceeded,
  errorsUpstreamBindingMissing,
  errorsUpstreamUnreachable,
} from "@edgway/i18n";

export interface EdgwayError {
  /** Stable public code, e.g. EDG-RL-001. Never reused or renumbered. */
  readonly code: `EDG-${"AUTH" | "RL" | "UP" | "CFG" | "PLG" | "ADM"}-${string}`;
  readonly status: number;
  /** Catalog message; rendered with t() as the title in the current locale. */
  readonly message: MessageDescriptor;
}

export const ERR = {
  AUTH_REQUIRED: {
    code: "EDG-AUTH-001",
    status: 401,
    message: errorsAuthRequired,
  },
  AUTH_KEY_MISSING: {
    code: "EDG-AUTH-002",
    status: 401,
    message: errorsAuthKeyMissing,
  },
  AUTH_KEY_DUPLICATE: {
    code: "EDG-AUTH-003",
    status: 401,
    message: errorsAuthKeyDuplicate,
  },
  AUTH_INVALID_CREDENTIALS: {
    code: "EDG-AUTH-004",
    status: 401,
    message: errorsAuthInvalidCredentials,
  },
  AUTH_TOKEN_MULTIPLE: {
    code: "EDG-AUTH-005",
    status: 401,
    message: errorsAuthTokenMultiple,
  },
  AUTH_TOKEN_BAD: {
    code: "EDG-AUTH-006",
    status: 401,
    message: errorsAuthTokenBad,
  },
  AUTH_TOKEN_KEY_CLAIM_MISSING: {
    code: "EDG-AUTH-007",
    status: 401,
    message: errorsAuthTokenKeyClaimMissing,
  },
  AUTH_TOKEN_KEY_CLAIM_INVALID: {
    code: "EDG-AUTH-008",
    status: 401,
    message: errorsAuthTokenKeyClaimInvalid,
  },
  AUTH_TOKEN_NO_CREDENTIALS: {
    code: "EDG-AUTH-009",
    status: 401,
    message: errorsAuthTokenNoCredentials,
  },
  AUTH_TOKEN_INVALID_ALGORITHM: {
    code: "EDG-AUTH-010",
    status: 401,
    message: errorsAuthTokenInvalidAlgorithm,
  },
  AUTH_TOKEN_INVALID_SECRET: {
    code: "EDG-AUTH-011",
    status: 401,
    message: errorsAuthTokenInvalidSecret,
  },
  AUTH_TOKEN_INVALID_SIGNATURE: {
    code: "EDG-AUTH-012",
    status: 401,
    message: errorsAuthTokenInvalidSignature,
  },
  AUTH_TOKEN_EXPIRED: {
    code: "EDG-AUTH-013",
    status: 401,
    message: errorsAuthTokenExpired,
  },
  AUTH_TOKEN_NOT_YET_VALID: {
    code: "EDG-AUTH-014",
    status: 401,
    message: errorsAuthTokenNotYetValid,
  },
  AUTH_TOKEN_EXPIRATION_TOO_LONG: {
    code: "EDG-AUTH-015",
    status: 401,
    message: errorsAuthTokenExpirationTooLong,
  },
  AUTH_TOKEN_CLAIM_NOT_NUMBER: {
    code: "EDG-AUTH-016",
    status: 401,
    message: errorsAuthTokenClaimNotNumber,
  },
  AUTH_TOKEN_CONSUMER_NOT_FOUND: {
    code: "EDG-AUTH-017",
    status: 401,
    message: errorsAuthTokenConsumerNotFound,
  },
  AUTH_FORBIDDEN: {
    code: "EDG-AUTH-018",
    status: 403,
    message: errorsAuthForbidden,
  },
  ACL_FORBIDDEN: {
    code: "EDG-AUTH-019",
    status: 403,
    message: errorsAuthAclForbidden,
  },
  IP_NOT_ALLOWED: {
    code: "EDG-AUTH-020",
    status: 403,
    message: errorsAuthIpNotAllowed,
  },
  IP_UNKNOWN: {
    code: "EDG-AUTH-021",
    status: 403,
    message: errorsAuthIpUnknown,
  },
  RATE_LIMITED: {
    code: "EDG-RL-001",
    status: 429,
    message: errorsRateLimitExceeded,
  },
  UPSTREAM_BINDING_MISSING: {
    code: "EDG-UP-001",
    status: 502,
    message: errorsUpstreamBindingMissing,
  },
  UPSTREAM_UNREACHABLE: {
    code: "EDG-UP-003",
    status: 502,
    message: errorsUpstreamUnreachable,
  },
  ROUTE_NOT_FOUND: {
    code: "EDG-CFG-001",
    status: 404,
    message: errorsConfigNoRoute,
  },
  UPSTREAM_TYPE_UNKNOWN: {
    code: "EDG-CFG-002",
    status: 500,
    message: errorsConfigUnknownUpstreamType,
  },
  PLUGIN_UNAVAILABLE: {
    code: "EDG-CFG-003",
    status: 500,
    message: errorsConfigPluginUnavailable,
  },
  CONFIG_UNAVAILABLE: {
    code: "EDG-CFG-004",
    status: 503,
    message: errorsConfigUnavailable,
  },
  ROUTE_HTTPS_REQUIRED: {
    code: "EDG-CFG-005",
    // Kong's https_redirect_status_code default.
    status: 426,
    message: errorsConfigHttpsRequired,
  },
  INTERNAL: {
    code: "EDG-CFG-500",
    status: 500,
    message: errorsConfigInternal,
  },
  REQUEST_TOO_LARGE: {
    code: "EDG-PLG-001",
    status: 413,
    message: errorsPluginRequestTooLarge,
  },
  CONTENT_LENGTH_REQUIRED: {
    code: "EDG-PLG-002",
    status: 411,
    message: errorsPluginContentLengthRequired,
  },
  REQUEST_TERMINATED: {
    code: "EDG-PLG-003",
    status: 503,
    message: errorsPluginRequestTerminated,
  },
  ADMIN_FORBIDDEN: {
    code: "EDG-ADM-001",
    status: 403,
    message: errorsAdminForbidden,
  },
  ADMIN_DISABLED: {
    code: "EDG-ADM-002",
    status: 503,
    message: errorsAdminDisabled,
  },
  ADMIN_NOT_FOUND: {
    code: "EDG-ADM-003",
    status: 404,
    message: errorsAdminNotFound,
  },
  ADMIN_INVALID_REQUEST: {
    code: "EDG-ADM-004",
    status: 400,
    message: errorsAdminInvalidRequest,
  },
  ADMIN_CONFLICT: {
    code: "EDG-ADM-005",
    status: 409,
    message: errorsAdminConflict,
  },
  ADMIN_ROLE_REQUIRED: {
    code: "EDG-ADM-006",
    status: 403,
    message: errorsAdminRoleRequired,
  },
  ADMIN_UNAUTHENTICATED: {
    code: "EDG-ADM-007",
    status: 401,
    message: errorsAdminUnauthenticated,
  },
  ADMIN_PLUGIN_NOT_ENABLED: {
    code: "EDG-ADM-008",
    status: 400,
    message: errorsAdminPluginNotEnabled,
  },
  ADMIN_TESTER_UNCONFIGURED: {
    code: "EDG-ADM-009",
    status: 503,
    message: errorsAdminTesterUnconfigured,
  },
  ADMIN_ANALYTICS_FAILED: {
    code: "EDG-ADM-010",
    status: 502,
    message: errorsAdminAnalyticsFailed,
  },
  ADMIN_TESTER_BAD_REQUEST: {
    code: "EDG-ADM-011",
    status: 400,
    message: errorsAdminTesterBadRequest,
  },
  ADMIN_PUBLISH_CONFLICT: {
    code: "EDG-ADM-012",
    status: 409,
    message: errorsAdminPublishConflict,
  },
  ADMIN_PUBLISHED_INVALID: {
    code: "EDG-ADM-013",
    status: 409,
    message: errorsAdminPublishedInvalid,
  },
  ADMIN_KEY_LIMIT: {
    code: "EDG-ADM-014",
    status: 409,
    message: errorsAdminKeyLimit,
  },
  /** ADMIN_DISABLED split: publishing has no signing key or binding. */
  ADMIN_PUBLISH_DISABLED: {
    code: "EDG-ADM-015",
    status: 503,
    message: errorsAdminPublishDisabled,
  },
  /** ADMIN_DISABLED split: the portal's OIDC settings are missing. */
  PORTAL_SIGN_IN_DISABLED: {
    code: "EDG-ADM-016",
    status: 503,
    message: errorsPortalSignInDisabled,
  },
  /** The install's cap on portal developers. */
  PORTAL_DEVELOPER_LIMIT: {
    code: "EDG-ADM-017",
    status: 403,
    message: errorsPortalDeveloperLimit,
  },
  /** A rollback to a version retention has pruned. */
  ADMIN_VERSION_PRUNED: {
    code: "EDG-ADM-018",
    status: 410,
    message: errorsAdminVersionPruned,
  },
  AI_PROMPT_BLOCKED: {
    code: "EDG-PLG-004",
    status: 400,
    message: errorsAiPromptBlocked,
  },
  AI_REQUEST_INVALID: {
    code: "EDG-PLG-005",
    status: 400,
    message: errorsAiRequestInvalid,
  },
  AI_PROVIDER_FAILED: {
    code: "EDG-PLG-006",
    status: 502,
    message: errorsAiProviderFailed,
  },
  AI_RATE_LIMITED: {
    code: "EDG-PLG-007",
    status: 429,
    message: errorsAiRateLimited,
  },
  AI_STREAMING_DENIED: {
    code: "EDG-PLG-008",
    status: 400,
    message: errorsAiStreamingDenied,
  },
  REQUEST_HEADER_INVALID: {
    code: "EDG-PLG-009",
    status: 400,
    message: errorsPluginHeaderInvalid,
  },
  REQUEST_BODY_UNTRANSFORMABLE: {
    code: "EDG-PLG-010",
    status: 400,
    message: errorsPluginBodyUntransformable,
  },
} as const satisfies Record<string, EdgwayError>;

export type ErrorName = keyof typeof ERR;

/** Success statuses used by the gateway and admin API. */
export const STATUS = {
  ok: 200,
  created: 201,
  noContent: 204,
} as const;

/** RFC 9457 `type` URI for an error code (a URN, so no hosted docs are implied). */
export const problemType = (error: EdgwayError) =>
  `urn:edgway:problem:${error.code}`;

/** Path of the generated docs page for an error code. */
export const docsPath = (error: { code: string }) => `/errors/${error.code}`;

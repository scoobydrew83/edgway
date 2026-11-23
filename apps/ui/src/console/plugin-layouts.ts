/**
 * Each catalog plugin's form layout (the PluginForm board): its
 * common fields first, in titled groups and labelled from @edgway/i18n, the
 * rest under a closed "Advanced". `whatCallersSee` names the error a refused
 * caller gets. A plugin missing here falls back to its required fields
 * first (`layoutOf`). `plugin-layouts.spec.ts` checks every field is in the
 * plugin's Kong schema.
 */
import { type EdgwayError, ERR } from "@edgway/errors";
import {
  uiPluginFieldAdd,
  uiPluginFieldAllow,
  uiPluginFieldAllowedPayloadSize,
  uiPluginFieldAllowPatterns,
  uiPluginFieldAnonymous,
  uiPluginFieldAppend,
  uiPluginFieldAuth,
  uiPluginFieldAuthMethods,
  uiPluginFieldBody,
  uiPluginFieldCacheTtl,
  uiPluginFieldClaimsToVerify,
  uiPluginFieldClientId,
  uiPluginFieldClientSecret,
  uiPluginFieldContentType,
  uiPluginFieldCredentials,
  uiPluginFieldDay,
  uiPluginFieldDeny,
  uiPluginFieldDenyPatterns,
  uiPluginFieldEchoDownstream,
  uiPluginFieldFaultTolerant,
  uiPluginFieldGenerator,
  uiPluginFieldHeaderName,
  uiPluginFieldHeaderNames,
  uiPluginFieldHeaders,
  uiPluginFieldHideClientHeaders,
  uiPluginFieldHideCredentials,
  uiPluginFieldHideGroupsHeader,
  uiPluginFieldHour,
  uiPluginFieldHttpEndpoint,
  uiPluginFieldIssuer,
  uiPluginFieldKeyClaimName,
  uiPluginFieldKeyInBody,
  uiPluginFieldKeyInHeader,
  uiPluginFieldKeyInQuery,
  uiPluginFieldKeyNames,
  uiPluginFieldLimitBy,
  uiPluginFieldLlmProviders,
  uiPluginFieldMaxAge,
  uiPluginFieldMessage,
  uiPluginFieldMethod,
  uiPluginFieldMethods,
  uiPluginFieldMinute,
  uiPluginFieldModel,
  uiPluginFieldOrigins,
  uiPluginFieldPolicy,
  uiPluginFieldRealm,
  uiPluginFieldRemove,
  uiPluginFieldRename,
  uiPluginFieldReplace,
  uiPluginFieldRequestMethod,
  uiPluginFieldRequireContentLength,
  uiPluginFieldResponseCode,
  uiPluginFieldRouteType,
  uiPluginFieldScopes,
  uiPluginFieldSecond,
  uiPluginFieldSizeUnit,
  uiPluginFieldStatus,
  uiPluginFieldStatusCode,
  uiPluginFieldStrategy,
  uiPluginFieldUriParamNames,
  uiPluginFieldWindowType,
  uiPluginGroupAddresses,
  uiPluginGroupCaching,
  uiPluginGroupChanges,
  uiPluginGroupCredentials,
  uiPluginGroupDestination,
  uiPluginGroupGroups,
  uiPluginGroupKeys,
  uiPluginGroupLimits,
  uiPluginGroupModel,
  uiPluginGroupOrigins,
  uiPluginGroupPatterns,
  uiPluginGroupProvider,
  uiPluginGroupRequestId,
  uiPluginGroupResponse,
  uiPluginGroupSize,
  uiPluginGroupTokens,
  uiPluginsLimitsHint,
  uiPluginsPolicyHint,
  uiPluginsSettings,
} from "@edgway/i18n/messages";
import type { MessageDescriptor } from "react-intl";

interface FieldGroup {
  title: MessageDescriptor;
  hint?: MessageDescriptor;
  /** Rows of fields; a row's fields sit side by side on wide screens. */
  rows: string[][];
}

export interface PluginLayout {
  groups: FieldGroup[];
  /** The error a refused caller gets, when the plugin refuses callers. */
  whatCallersSee?: EdgwayError;
  /** A line under a field, instead of Kong's description. */
  fieldHints?: Record<string, MessageDescriptor>;
}

/** Labels of the fields layouts put first. */
export const PLUGIN_FIELD_LABELS: Record<string, MessageDescriptor> = {
  allow: uiPluginFieldAllow,
  deny: uiPluginFieldDeny,
  hide_groups_header: uiPluginFieldHideGroupsHeader,
  allow_patterns: uiPluginFieldAllowPatterns,
  deny_patterns: uiPluginFieldDenyPatterns,
  route_type: uiPluginFieldRouteType,
  model: uiPluginFieldModel,
  auth: uiPluginFieldAuth,
  llm_providers: uiPluginFieldLlmProviders,
  window_type: uiPluginFieldWindowType,
  strategy: uiPluginFieldStrategy,
  hide_credentials: uiPluginFieldHideCredentials,
  anonymous: uiPluginFieldAnonymous,
  realm: uiPluginFieldRealm,
  header_name: uiPluginFieldHeaderName,
  generator: uiPluginFieldGenerator,
  echo_downstream: uiPluginFieldEchoDownstream,
  origins: uiPluginFieldOrigins,
  methods: uiPluginFieldMethods,
  headers: uiPluginFieldHeaders,
  credentials: uiPluginFieldCredentials,
  max_age: uiPluginFieldMaxAge,
  http_endpoint: uiPluginFieldHttpEndpoint,
  method: uiPluginFieldMethod,
  content_type: uiPluginFieldContentType,
  status: uiPluginFieldStatus,
  message: uiPluginFieldMessage,
  key_claim_name: uiPluginFieldKeyClaimName,
  claims_to_verify: uiPluginFieldClaimsToVerify,
  header_names: uiPluginFieldHeaderNames,
  uri_param_names: uiPluginFieldUriParamNames,
  key_names: uiPluginFieldKeyNames,
  key_in_header: uiPluginFieldKeyInHeader,
  key_in_query: uiPluginFieldKeyInQuery,
  key_in_body: uiPluginFieldKeyInBody,
  issuer: uiPluginFieldIssuer,
  client_id: uiPluginFieldClientId,
  client_secret: uiPluginFieldClientSecret,
  auth_methods: uiPluginFieldAuthMethods,
  scopes: uiPluginFieldScopes,
  cache_ttl: uiPluginFieldCacheTtl,
  response_code: uiPluginFieldResponseCode,
  request_method: uiPluginFieldRequestMethod,
  second: uiPluginFieldSecond,
  minute: uiPluginFieldMinute,
  hour: uiPluginFieldHour,
  day: uiPluginFieldDay,
  limit_by: uiPluginFieldLimitBy,
  policy: uiPluginFieldPolicy,
  fault_tolerant: uiPluginFieldFaultTolerant,
  hide_client_headers: uiPluginFieldHideClientHeaders,
  allowed_payload_size: uiPluginFieldAllowedPayloadSize,
  size_unit: uiPluginFieldSizeUnit,
  require_content_length: uiPluginFieldRequireContentLength,
  status_code: uiPluginFieldStatusCode,
  body: uiPluginFieldBody,
  add: uiPluginFieldAdd,
  remove: uiPluginFieldRemove,
  rename: uiPluginFieldRename,
  replace: uiPluginFieldReplace,
  append: uiPluginFieldAppend,
};

export const PLUGIN_LAYOUTS: Record<string, PluginLayout> = {
  acl: {
    groups: [
      {
        title: uiPluginGroupGroups,
        rows: [["allow"], ["deny"], ["hide_groups_header"]],
      },
    ],
    whatCallersSee: ERR.ACL_FORBIDDEN,
  },
  "ai-prompt-guard": {
    groups: [
      {
        title: uiPluginGroupPatterns,
        rows: [["allow_patterns"], ["deny_patterns"]],
      },
    ],
  },
  "ai-proxy": {
    groups: [
      {
        title: uiPluginGroupModel,
        rows: [["route_type"], ["model"], ["auth"]],
      },
    ],
  },
  "ai-rate-limiting-advanced": {
    groups: [
      {
        title: uiPluginGroupLimits,
        rows: [["llm_providers"], ["window_type"], ["strategy"]],
      },
    ],
  },
  "basic-auth": {
    groups: [
      {
        title: uiPluginGroupCredentials,
        rows: [["hide_credentials"], ["anonymous"], ["realm"]],
      },
    ],
    whatCallersSee: ERR.AUTH_INVALID_CREDENTIALS,
  },
  "correlation-id": {
    groups: [
      {
        title: uiPluginGroupRequestId,
        rows: [["header_name", "generator", "echo_downstream"]],
      },
    ],
  },
  cors: {
    groups: [
      {
        title: uiPluginGroupOrigins,
        rows: [
          ["origins"],
          ["methods"],
          ["headers"],
          ["credentials"],
          ["max_age"],
        ],
      },
    ],
  },
  "http-log": {
    groups: [
      {
        title: uiPluginGroupDestination,
        rows: [["http_endpoint"], ["method"], ["content_type"]],
      },
    ],
  },
  "ip-restriction": {
    groups: [
      {
        title: uiPluginGroupAddresses,
        rows: [["allow"], ["deny"], ["status"], ["message"]],
      },
    ],
    whatCallersSee: ERR.IP_NOT_ALLOWED,
  },
  jwt: {
    groups: [
      {
        title: uiPluginGroupTokens,
        rows: [
          ["key_claim_name"],
          ["claims_to_verify"],
          ["header_names"],
          ["uri_param_names"],
        ],
      },
    ],
    whatCallersSee: ERR.AUTH_TOKEN_BAD,
  },
  "key-auth": {
    groups: [
      {
        title: uiPluginGroupKeys,
        rows: [
          ["key_names"],
          ["hide_credentials"],
          ["key_in_header"],
          ["key_in_query"],
          ["key_in_body"],
        ],
      },
    ],
    whatCallersSee: ERR.AUTH_KEY_MISSING,
  },
  "openid-connect": {
    groups: [
      {
        title: uiPluginGroupProvider,
        rows: [
          ["issuer"],
          ["client_id"],
          ["client_secret"],
          ["auth_methods"],
          ["scopes"],
        ],
      },
    ],
  },
  "proxy-cache": {
    groups: [
      {
        title: uiPluginGroupCaching,
        rows: [
          ["strategy"],
          ["cache_ttl"],
          ["response_code"],
          ["request_method"],
          ["content_type"],
        ],
      },
    ],
  },
  "rate-limiting": {
    groups: [
      {
        title: uiPluginGroupLimits,
        hint: uiPluginsLimitsHint,
        rows: [
          ["second", "minute", "hour", "day"],
          ["limit_by", "policy"],
          ["fault_tolerant"],
          ["hide_client_headers"],
        ],
      },
    ],
    whatCallersSee: ERR.RATE_LIMITED,
    fieldHints: { policy: uiPluginsPolicyHint },
  },
  "request-size-limiting": {
    groups: [
      {
        title: uiPluginGroupSize,
        rows: [
          ["allowed_payload_size"],
          ["size_unit"],
          ["require_content_length"],
        ],
      },
    ],
    whatCallersSee: ERR.REQUEST_TOO_LARGE,
  },
  "request-termination": {
    groups: [
      {
        title: uiPluginGroupResponse,
        rows: [["status_code"], ["message"], ["body"], ["content_type"]],
      },
    ],
  },
  "request-transformer": {
    groups: [
      {
        title: uiPluginGroupChanges,
        rows: [["add"], ["remove"], ["rename"], ["replace"], ["append"]],
      },
    ],
  },
  "response-transformer": {
    groups: [
      {
        title: uiPluginGroupChanges,
        rows: [["add"], ["remove"], ["rename"], ["replace"], ["append"]],
      },
    ],
  },
};

/**
 * A plugin's layout: its own, or its required fields first (a plugin
 * without one, such as an uploaded plugin's or a newly bundled one).
 */
export function layoutOf(
  name: string,
  required: readonly string[] = [],
): PluginLayout {
  return (
    PLUGIN_LAYOUTS[name] ?? {
      groups:
        required.length > 0
          ? [{ title: uiPluginsSettings, rows: required.map((f) => [f]) }]
          : [],
    }
  );
}

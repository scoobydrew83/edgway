/**
 * The Kong route and service fields the router reads. They are the matching
 * columns of @edgway/schema's `routes` and `services` tables (a type test keeps
 * them in step), so a snapshot row can be passed as is.
 */
export interface KongRoute {
  id: string;
  service_id?: string | null;
  methods?: string[] | null;
  hosts?: string[] | null;
  paths?: string[] | null;
  headers?: Record<string, string[]> | null;
  snis?: string[] | null;
  sources?: unknown[] | null;
  destinations?: unknown[] | null;
  expression?: string | null;
  strip_path?: boolean;
  preserve_host?: boolean;
  regex_priority?: number;
  path_handling?: string;
  /** Kong's `protocols`: an https-only route answers 426 to plain HTTP. */
  protocols?: string[] | null;
  /** 301, 302, 307 or 308 redirect that plain HTTP to HTTPS; else 426. */
  https_redirect_status_code?: number | null;
}

export interface KongService {
  id: string;
  protocol?: string;
  host: string;
  port?: number;
  path?: string | null;
}

/** The route a request matched, and where it goes upstream. */
export interface RouteMatch {
  route: KongRoute;
  service?: KongService;
  /** Path (and query) to send upstream, per Kong's path handling (v0). */
  upstreamPath: string;
  /** The client's Host header when `preserve_host` is set. */
  upstreamHost?: string;
  /** Regex path captures: numbered and named. */
  captures?: { groups: string[]; named: Record<string, string> };
}

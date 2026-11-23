/**
 * Vendors Kong's machine-readable schemas at pinned commits (PRD "Schemas:
 * from Kong, not by hand"):
 *   - plugin config JSON Schemas for Kong Gateway 3.9, from
 *     Kong/developer.konghq.com (MIT);
 *   - the decK declarative file schema, from Kong/go-database-reconciler
 *     (Apache-2.0).
 * Files are written byte-for-byte as fetched, never reformatted.
 *
 * Usage:
 *   tsx tools/vendor-kong-schemas.ts           # write vendor/kong-schemas
 *   tsx tools/vendor-kong-schemas.ts --check   # re-fetch and diff; exit 1 on drift
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const KONG_VERSION = "3.9";
const DOCS_REPO = {
  repo: "Kong/developer.konghq.com",
  sha: "8cf54cb5f437df50f89d37192fb17a8af71cf1a4",
};
const DECK_REPO = {
  repo: "Kong/go-database-reconciler",
  sha: "04b4e6a01d4a182cc432406d708f8c3220b9125e",
};

/** Every PRD v1 plugin: Kong plugin name → schema file name in the docs repo. */
const PLUGINS: Record<string, string> = {
  "key-auth": "KeyAuth",
  jwt: "Jwt",
  "basic-auth": "BasicAuth",
  "openid-connect": "OpenidConnect",
  acl: "Acl",
  cors: "Cors",
  "ip-restriction": "IpRestriction",
  "rate-limiting": "RateLimiting",
  "request-size-limiting": "RequestSizeLimiting",
  "request-transformer": "RequestTransformer",
  "response-transformer": "ResponseTransformer",
  "proxy-cache": "ProxyCache",
  "request-termination": "RequestTermination",
  "correlation-id": "CorrelationId",
  "http-log": "HttpLog",
  "ai-proxy": "AiProxy",
  // The PRD's "ai-rate-limiting" is Kong's ai-rate-limiting-advanced (see SOURCE.md).
  "ai-rate-limiting-advanced": "AiRateLimitingAdvanced",
  "ai-prompt-guard": "AiPromptGuard",
};

const OUT = "vendor/kong-schemas";
const raw = (repo: { repo: string; sha: string }, file: string) =>
  `https://raw.githubusercontent.com/${repo.repo}/${repo.sha}/${file}`;

const sources: { url: string; out: string }[] = [
  ...Object.entries(PLUGINS).map(([name, file]) => ({
    url: raw(
      DOCS_REPO,
      `app/_schemas/gateway/plugins/${KONG_VERSION}/${file}.json`,
    ),
    out: path.join(OUT, KONG_VERSION, "plugins", `${name}.json`),
  })),
  {
    url: raw(DECK_REPO, "pkg/file/kong_json_schema.json"),
    out: path.join(OUT, "deck", "kong_json_schema.json"),
  },
];

const check = process.argv.includes("--check");
let drift = 0;

for (const { url, out } of sources) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vendor: ${res.status} for ${url}`);
  const body = await res.text();
  JSON.parse(body); // must be valid JSON
  if (check) {
    let current = "";
    try {
      current = readFileSync(out, "utf8");
    } catch {}
    if (current !== body) {
      drift++;
      console.error(`vendor: ${out} differs from ${url}`);
    }
  } else {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, body);
  }
}

if (drift) process.exit(1);
console.log(
  `vendor: ${sources.length} schemas ${check ? "match their pinned sources" : "written"}`,
);

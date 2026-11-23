/** the migration that redacts raw jwt secrets in older audit rows. */
import { env } from "cloudflare:test";
import { ADMIN_DIFF } from "@edgway/constants";
import { describe, expect, it } from "vitest";

const redaction = env.TEST_MIGRATIONS.find((m) =>
  m.name.includes("redact_legacy_jwt_audit"),
);

/** An audit row as the admin wrote it before an earlier release (raw secrets in the diff). */
async function seed(id: string, entityType: string, diff: unknown[]) {
  await env.DB.prepare(
    "INSERT INTO audit_events (id, workspace_id, actor, action, entity_type, entity_id, diff, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      "0199a3c0-0000-7000-a000-000000000001",
      "legacy@example.com",
      "update",
      entityType,
      "j1",
      JSON.stringify(diff),
      Date.now(),
    )
    .run();
}

const diffOf = async (id: string) =>
  JSON.parse(
    (
      await env.DB.prepare("SELECT diff FROM audit_events WHERE id = ?")
        .bind(id)
        .first<{ diff: string }>()
    )?.diff ?? "null",
  ) as unknown[];

describe("0004_redact_legacy_jwt_audit", () => {
  it("redacts raw jwt secrets in legacy audit diffs, and nothing else", async () => {
    expect(redaction).toBeDefined();
    await seed("legacy-create", "jwt_secrets", [
      { type: "CREATE", path: ["key"], value: "iss-1" },
      { type: "CREATE", path: ["secret"], value: "raw-secret-1" },
    ]);
    await seed("legacy-change", "jwt_secrets", [
      {
        type: "CHANGE",
        path: ["secret"],
        value: "raw-secret-2",
        oldValue: "raw-secret-1",
      },
    ]);
    await seed("legacy-remove", "jwt_secrets", [
      { type: "REMOVE", path: ["secret"], oldValue: "raw-secret-2" },
    ]);
    await seed("vault", "jwt_secrets", [
      {
        type: "CHANGE",
        path: ["secret"],
        value: "{vault://env/vault-jwt}",
        oldValue: ADMIN_DIFF.redacted,
      },
    ]);
    // Another entity's `secret` field isn't a jwt secret row.
    const other = [{ type: "CREATE", path: ["secret"], value: "not-jwt" }];
    await seed("other", "plugins", other);

    for (const query of redaction?.queries ?? []) {
      await env.DB.prepare(query).run();
    }

    expect(await diffOf("legacy-create")).toEqual([
      { type: "CREATE", path: ["key"], value: "iss-1" },
      { type: "CREATE", path: ["secret"], value: ADMIN_DIFF.redacted },
    ]);
    expect(await diffOf("legacy-change")).toEqual([
      {
        type: "CHANGE",
        path: ["secret"],
        value: ADMIN_DIFF.redactedChanged,
        oldValue: ADMIN_DIFF.redacted,
      },
    ]);
    expect(await diffOf("legacy-remove")).toEqual([
      { type: "REMOVE", path: ["secret"], oldValue: ADMIN_DIFF.redacted },
    ]);
    expect(await diffOf("vault")).toEqual([
      {
        type: "CHANGE",
        path: ["secret"],
        value: "{vault://env/vault-jwt}",
        oldValue: ADMIN_DIFF.redacted,
      },
    ]);
    expect(await diffOf("other")).toEqual(other);
    const all = JSON.stringify(
      (await env.DB.prepare("SELECT diff FROM audit_events").all()).results,
    );
    expect(all).not.toContain("raw-secret");
  });
});

/** portal labels move out of the Kong username; an admin's stay. */
describe("0009_portal_display_names", () => {
  const relabel = env.TEST_MIGRATIONS.find((m) =>
    m.name.includes("portal_display_names"),
  );
  const ws = "0199a3c0-0000-7000-a000-000000000009";

  async function consumer(id: string, username: string, subject: string) {
    await env.DB.prepare(
      "INSERT INTO consumers (id, workspace_id, username, portal_subject) VALUES (?, ?, ?, ?)",
    )
      .bind(id, ws, username, subject)
      .run();
  }

  /** An audit event that set `username` (audit ids are uuidv7: they sort by time). */
  async function renamed(auditId: string, consumerId: string, actor: string) {
    await env.DB.prepare(
      "INSERT INTO audit_events (id, workspace_id, actor, action, entity_type, entity_id, diff) VALUES (?, ?, ?, 'update', 'consumers', ?, ?)",
    )
      .bind(
        auditId,
        ws,
        actor,
        consumerId,
        JSON.stringify([
          { type: "CHANGE", path: ["username"], value: "x", oldValue: null },
        ]),
      )
      .run();
  }

  const row = (id: string) =>
    env.DB.prepare("SELECT username, display_name FROM consumers WHERE id = ?")
      .bind(id)
      .first<{ username: string | null; display_name: string | null }>();

  it("moves only usernames the portal itself set", async () => {
    expect(relabel).toBeDefined();
    // Labelled by the portal: moved.
    await consumer("c-portal", "dev@example.com", "sub-1");
    await renamed(
      "0199a3c0-0000-7000-a000-000000000a01",
      "c-portal",
      "oidc:sub-1",
    );
    // Labelled by the portal, then renamed by an admin: kept.
    await consumer("c-admin", "billing-team", "sub-2");
    await renamed(
      "0199a3c0-0000-7000-a000-000000000a02",
      "c-admin",
      "oidc:sub-2",
    );
    await renamed(
      "0199a3c0-0000-7000-a000-000000000a03",
      "c-admin",
      "ops@example.com",
    );
    // No audit event for its username: kept.
    await consumer("c-unknown", "legacy", "sub-3");
    // Another developer's event doesn't count as this one's.
    await consumer("c-other", "someone", "sub-4");
    await renamed(
      "0199a3c0-0000-7000-a000-000000000a04",
      "c-other",
      "oidc:sub-1",
    );

    for (const query of relabel?.queries ?? []) {
      await env.DB.prepare(query).run();
    }

    expect(await row("c-portal")).toEqual({
      username: null,
      display_name: "dev@example.com",
    });
    expect(await row("c-admin")).toEqual({
      username: "billing-team",
      display_name: null,
    });
    expect(await row("c-unknown")).toEqual({
      username: "legacy",
      display_name: null,
    });
    expect(await row("c-other")).toEqual({
      username: "someone",
      display_name: null,
    });
  });
});

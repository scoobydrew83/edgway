/**
 * Developer-portal publishing. The portal never holds the
 * snapshot signing key: it asks the admin, over a Service Binding to the
 * `PortalPublish` entrypoint (reachable only through a binding, never over
 * HTTP), to put a developer's keys live. The request is queued in the
 * `PortalPublisher` Durable Object, whose alarm publishes every queued
 * consumer in one credential-only publish per `PORTAL.publishBatchMs`. A
 * failed publish keeps the queue and is retried by the alarm.
 *
 * `ConfigVersionReader` is the gateway's read-only view of the live version:
 * it can read it, never move it.
 */

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { versionReader } from "@edgway/adapters-cf";
import { createAdminCore } from "@edgway/admin-core";
import { ADMIN, PORTAL } from "@edgway/constants";
import { PLUGINS } from "./plugins";
import { type PublishEnv, publishTargetOf } from "./publish";

/** What portal publishing needs from the admin's env. */
export interface PortalPublishEnv extends PublishEnv {
  DB: D1Database;
  /** Batches developers' key changes into publishes. */
  PORTAL_PUBLISHER: DurableObjectNamespace<PortalPublisher>;
  /** The workspace this install serves; the default workspace when empty. */
  WORKSPACE_ID?: string;
}

/** A queued consumer's storage key. */
const PENDING = "pending:";
/** The last request's sequence number (a queued entry's value). */
const SEQUENCE = "sequence";

export class PortalPublisher extends DurableObject<PortalPublishEnv> {
  /**
   * Queue a consumer for the next batch, starting the batch if needed. Each
   * request stores the next sequence number, so a batch already in flight
   * can tell a change it never read (see `dequeue`).
   */
  async request(consumerId: string): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const sequence =
        ((await this.ctx.storage.get<number>(SEQUENCE)) ?? 0) + 1;
      await this.ctx.storage.put({
        [SEQUENCE]: sequence,
        [`${PENDING}${consumerId}`]: sequence,
      });
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + PORTAL.publishBatchMs);
      }
    });
  }

  /** Publish every queued consumer at once; dequeue them only on success. */
  override async alarm(): Promise<void> {
    const queued = await this.ctx.storage.list<number>({ prefix: PENDING });
    if (queued.size === 0) return;
    const ids = [...queued.keys()].map((key) => key.slice(PENDING.length));
    const core = createAdminCore(this.env.DB, {
      plugins: PLUGINS,
      workspaceId: this.env.WORKSPACE_ID || ADMIN.defaultWorkspaceId,
      actor: PORTAL.actor,
    });
    // A throw keeps the queue: the runtime retries the alarm.
    await core.config.publishConsumers(await publishTargetOf(this.env), ids);
    await this.dequeue(queued);
  }

  /**
   * Drop the entries a batch published, unless they were queued again while
   * it ran (a change it may not have read): those stay for the next batch.
   */
  async dequeue(published: Map<string, number>): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const now = await this.ctx.storage.get<number>([...published.keys()]);
      await this.ctx.storage.delete(
        [...published]
          .filter(([key, sequence]) => now.get(key) === sequence)
          .map(([key]) => key),
      );
      const left = await this.ctx.storage.list({ prefix: PENDING, limit: 1 });
      if (left.size > 0 && (await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + PORTAL.publishBatchMs);
      }
    });
  }
}

/** The portal's way in: queue a developer's consumer for publishing. */
export class PortalPublish extends WorkerEntrypoint<PortalPublishEnv> {
  async requestPublish(consumerId: string): Promise<void> {
    const namespace = this.env.PORTAL_PUBLISHER;
    await namespace
      .get(namespace.idFromName(PORTAL.publisherObjectName))
      .request(consumerId);
  }
}

/** The gateway's read-only view of the live config version. */
export class ConfigVersionReader extends WorkerEntrypoint<PortalPublishEnv> {
  async current(): Promise<number | undefined> {
    const namespace = this.env.CONFIG_VERSION;
    return namespace ? versionReader(namespace).current() : undefined;
  }
}

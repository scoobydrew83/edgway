/**
 * The portal batch: a consumer queued again while a batch is in
 * flight stays queued, since the batch may not have read that change.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const publisher = (name: string) =>
  env.PORTAL_PUBLISHER.get(env.PORTAL_PUBLISHER.idFromName(name));

/** The object's queue and alarm, read inside it. */
const inside = <R>(
  stub: ReturnType<typeof publisher>,
  read: (storage: DurableObjectStorage) => Promise<R>,
) => runInDurableObject(stub, (_instance, state) => read(state.storage));

const queue = (storage: DurableObjectStorage) =>
  storage.list<number>({ prefix: "pending:" });

describe("PortalPublisher", () => {
  it("keeps a consumer queued again while its batch was in flight", async () => {
    const stub = publisher("in-flight");
    await stub.request("a");
    await stub.request("b");
    // What a batch read before it published.
    const batch = await inside(stub, queue);
    // A developer's change lands while the batch publishes.
    await stub.request("a");
    await inside(stub, (storage) => storage.deleteAlarm());
    await stub.dequeue(batch);

    expect([...(await inside(stub, queue)).keys()]).toEqual(["pending:a"]);
    // The next batch is armed for it.
    expect(await inside(stub, (storage) => storage.getAlarm())).not.toBeNull();
  });

  it("drops everything the batch published when nothing changed", async () => {
    const stub = publisher("settled");
    await stub.request("a");
    await stub.request("b");
    const batch = await inside(stub, queue);
    await inside(stub, (storage) => storage.deleteAlarm());
    await stub.dequeue(batch);

    expect((await inside(stub, queue)).size).toBe(0);
    expect(await inside(stub, (storage) => storage.getAlarm())).toBeNull();
  });
});

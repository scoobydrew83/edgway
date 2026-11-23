/**
 * http-log's delivery: `fetch` with a timeout, and the Cloudflare Queues
 * consumer that re-sends deliveries the plugin buffered after a failure,
 * backing off exponentially between attempts.
 */
import { HTTP_LOG } from "@edgway/constants";

/** One log entry to send (the plugin's `HttpLogDelivery`). */
export interface HttpLogDelivery {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpLogTransport {
  deliver(delivery: HttpLogDelivery, timeoutMs: number): Promise<boolean>;
}

/** Sends a delivery; resolves to whether the endpoint answered 2xx. */
export const fetchTransport: HttpLogTransport = {
  async deliver(delivery, timeoutMs) {
    const res = await fetch(delivery.endpoint, {
      method: delivery.method,
      headers: delivery.headers,
      body: delivery.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    return res.ok;
  },
};

/** Seconds before the next attempt: doubles per attempt, capped. */
export const retryDelaySeconds = (attempts: number) =>
  Math.min(
    HTTP_LOG.retryBaseDelaySeconds * 2 ** Math.max(0, attempts - 1),
    HTTP_LOG.retryMaxDelaySeconds,
  );

/** The retry queue's consumer (the Worker's `queue` handler). */
export async function retryHttpLog(
  batch: MessageBatch<HttpLogDelivery>,
  transport: HttpLogTransport = fetchTransport,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      let delivered = false;
      try {
        delivered = await transport.deliver(
          message.body,
          HTTP_LOG.retryTimeoutMs,
        );
      } catch {
        // Unreachable or timed out: retried below.
      }
      if (delivered) message.ack();
      else message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    }),
  );
}

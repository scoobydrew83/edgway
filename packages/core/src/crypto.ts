/**
 * Hashing helpers, the one place Edgway hashes (the centralization gate's
 * `no-raw-crypto` rule). Built on Hono's WebCrypto helpers.
 */
import { sha1, sha256 } from "hono/utils/crypto";

/** SHA-256 of a string (UTF-8), as lower-case hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await sha256(text);
  // Hono returns null only when WebCrypto is missing, which Workers never is.
  if (digest === null) throw new TypeError();
  return digest;
}

/** SHA-1 of a string (UTF-8), as lower-case hex: Kong's basic-auth password format. */
export async function sha1Hex(text: string): Promise<string> {
  const digest = await sha1(text);
  if (digest === null) throw new TypeError();
  return digest;
}

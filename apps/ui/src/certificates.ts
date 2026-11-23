/**
 * A certificate's subject and expiry, read with @peculiar/x509, and
 * whether it has expired or soon will (`CERTIFICATES.expiryWarningDays`).
 * Pure, so its unit test runs without a browser.
 */
// @peculiar/x509 needs a Reflect polyfill loaded first (its README).
import "reflect-metadata";
import { CERTIFICATES } from "@edgway/constants";
import { X509Certificate } from "@peculiar/x509";

export interface CertificateInfo {
  subject: string;
  issuer: string;
  notAfter: Date;
  /** The public key's algorithm, as people say it: RSA, ECDSA. */
  keyType: string;
}

/** WebCrypto's algorithm names, as the certificate list says them. */
const KEY_TYPES: Record<string, string> = {
  "RSASSA-PKCS1-v1_5": "RSA",
  "RSA-PSS": "RSA",
  ECDSA: "ECDSA",
  Ed25519: "Ed25519",
};

/** The PEM's subject and expiry; undefined when it doesn't parse. */
export function readCertificate(pem: unknown): CertificateInfo | undefined {
  if (typeof pem !== "string" || !pem.trim()) return undefined;
  try {
    const cert = new X509Certificate(pem);
    const algorithm = cert.publicKey.algorithm.name;
    return {
      subject: cert.subject,
      issuer: cert.issuer,
      notAfter: cert.notAfter,
      keyType: KEY_TYPES[algorithm] ?? algorithm,
    };
  } catch {
    return undefined;
  }
}

const DAY_MS = 86_400_000;

export type Expiry = "expired" | "soon" | "ok";

export function expiryOf(notAfter: Date, now = new Date()): Expiry {
  const left = notAfter.getTime() - now.getTime();
  if (left <= 0) return "expired";
  return left <= CERTIFICATES.expiryWarningDays * DAY_MS ? "soon" : "ok";
}

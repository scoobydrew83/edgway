/** a certificate's subject and expiry from a fixture PEM (no browser). */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expiryOf, readCertificate } from "../src/certificates";

const pem = readFileSync(
  new URL("./fixture-cert.pem", import.meta.url),
  "utf8",
);

test("reads the subject and expiry from a PEM", () => {
  const info = readCertificate(pem);
  expect(info?.subject).toBe("CN=certs.e2e.example.test, O=Edgway e2e");
  expect(info?.notAfter.toISOString()).toBe("2036-10-08T01:29:58.000Z");
  expect(readCertificate("not a certificate")).toBeUndefined();
});

test("flags expired and soon-expiring certificates", () => {
  const notAfter = new Date("2036-10-08T01:29:58Z");
  expect(expiryOf(notAfter, new Date("2036-10-09T00:00:00Z"))).toBe("expired");
  expect(expiryOf(notAfter, new Date("2036-09-30T00:00:00Z"))).toBe("soon");
  expect(expiryOf(notAfter, new Date("2036-08-01T00:00:00Z"))).toBe("ok");
});

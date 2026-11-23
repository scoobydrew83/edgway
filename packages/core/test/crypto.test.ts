import { describe, expect, it } from "vitest";
import { sha1Hex, sha256Hex } from "../src/index";

describe("sha256Hex", () => {
  it("matches the standard test vectors", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the UTF-8 bytes", async () => {
    // "é" is c3 a9 in UTF-8.
    expect(await sha256Hex("é")).toBe(
      "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
    );
  });
});

describe("sha1Hex", () => {
  it("matches the standard test vectors", async () => {
    expect(await sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(await sha1Hex("abc")).toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d",
    );
  });
});

import { describe, expect, it } from "vitest";
import { decryptImageArrayBufferWithFallback, isPngArrayBuffer } from "../player-runtime/bridge/encryptionFallback";

const pngHeader = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const rpgMakerHeader = Uint8Array.from([
  0x52, 0x50, 0x47, 0x4d, 0x56, 0x00, 0x00, 0x00,
  0x00, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function encryptedImageWithScrambledPngHeader(): ArrayBuffer {
  const bytes = new Uint8Array(64);
  bytes.set(rpgMakerHeader, 0);
  bytes.set(pngHeader.map((byte) => byte ^ 0x5a), 16);
  bytes.set([1, 2, 3, 4], 32);
  return bytes.buffer;
}

describe("RPG Maker image encryption fallback", () => {
  it("keeps normal decrypted PNG results", () => {
    const encrypted = encryptedImageWithScrambledPngHeader();
    const result = decryptImageArrayBufferWithFallback(encrypted, () => pngHeader.buffer);

    expect(new Uint8Array(result)).toEqual(pngHeader);
  });

  it("repairs nonstandard encrypted image first blocks", () => {
    const encrypted = encryptedImageWithScrambledPngHeader();
    const result = decryptImageArrayBufferWithFallback(encrypted, (source: ArrayBuffer) => source.slice(16));
    const resultBytes = new Uint8Array(result);

    expect(isPngArrayBuffer(result)).toBe(true);
    expect(resultBytes.slice(0, 16)).toEqual(pngHeader);
    expect(Array.from(resultBytes.slice(16, 20))).toEqual([1, 2, 3, 4]);
  });
});

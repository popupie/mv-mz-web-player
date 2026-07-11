import { describe, expect, it } from "vitest";
import {
  decryptImageArrayBufferWithFallback,
  imageMimeTypeForArrayBuffer,
  isPngArrayBuffer,
} from "../player-runtime/bridge/encryptionFallback";

const pngHeader = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const rpgMakerHeader = Uint8Array.from([
  0x52, 0x50, 0x47, 0x4d, 0x56, 0x00, 0x00, 0x00,
  0x00, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const jpegHeader = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
]);
const rpgMakerKey = Uint8Array.from([
  0xa8, 0x84, 0xa4, 0xd4, 0xd0, 0x45, 0xc3, 0x79,
  0x61, 0x5d, 0xfc, 0x56, 0xf1, 0xc1, 0xef, 0x92,
]);

function encryptedImageWithScrambledPngHeader(): ArrayBuffer {
  const bytes = new Uint8Array(64);
  bytes.set(rpgMakerHeader, 0);
  bytes.set(pngHeader.map((byte) => byte ^ 0x5a), 16);
  bytes.set([1, 2, 3, 4], 32);
  return bytes.buffer;
}

function encryptedJpegImage(): ArrayBuffer {
  const bytes = new Uint8Array(64);
  bytes.set(rpgMakerHeader, 0);
  bytes.set(jpegHeader.map((byte, index) => byte ^ rpgMakerKey[index]), 16);
  bytes.set([1, 2, 3, 4], 32);
  return bytes.buffer;
}

function decryptRpgMakerImage(source: ArrayBuffer): ArrayBuffer {
  const body = new Uint8Array(source.slice(16));
  for (let index = 0; index < Math.min(16, body.byteLength); index += 1) {
    body[index] ^= rpgMakerKey[index];
  }
  return body.buffer;
}

describe("RPG Maker image encryption fallback", () => {
  it("keeps normal decrypted PNG results", () => {
    const encrypted = encryptedImageWithScrambledPngHeader();
    const result = decryptImageArrayBufferWithFallback(encrypted, () => pngHeader.buffer);

    expect(new Uint8Array(result)).toEqual(pngHeader);
  });

  it("accepts already-plain PNG bytes served for encrypted image URLs", () => {
    const result = decryptImageArrayBufferWithFallback(pngHeader.buffer, () => {
      throw new Error("Header is wrong");
    });

    expect(result).toBe(pngHeader.buffer);
    expect(isPngArrayBuffer(result)).toBe(true);
  });

  it("keeps decrypted JPEG images instead of rewriting them as PNG", () => {
    const result = decryptImageArrayBufferWithFallback(encryptedJpegImage(), decryptRpgMakerImage);
    const resultBytes = new Uint8Array(result);

    expect(resultBytes.slice(0, jpegHeader.byteLength)).toEqual(jpegHeader);
    expect(imageMimeTypeForArrayBuffer(result)).toBe("image/jpeg");
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

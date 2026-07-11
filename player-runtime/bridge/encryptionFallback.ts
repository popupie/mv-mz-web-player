// @ts-nocheck

const RPG_MAKER_HEADER_HEX = "5250474d560000000003010000000000";
const PNG_HEADER_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG_HEADER_BYTES = new Uint8Array([0xff, 0xd8, 0xff]);
const GIF87A_HEADER_BYTES = new TextEncoder().encode("GIF87a");
const GIF89A_HEADER_BYTES = new TextEncoder().encode("GIF89a");
const WEBP_RIFF_HEADER_BYTES = new TextEncoder().encode("RIFF");
const WEBP_WEBP_HEADER_BYTES = new TextEncoder().encode("WEBP");

function bytesToHex(bytes) {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function startsWithBytes(bytes, expected) {
  if (!bytes || bytes.byteLength < expected.byteLength) return false;
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (bytes[index] !== expected[index]) return false;
  }
  return true;
}

function hasRpgMakerHeader(bytes) {
  if (!bytes || bytes.byteLength < 32) return false;
  return bytesToHex(bytes.slice(0, 16)) === RPG_MAKER_HEADER_HEX;
}

export function isPngArrayBuffer(arrayBuffer) {
  if (!arrayBuffer) return false;
  return startsWithBytes(new Uint8Array(arrayBuffer), PNG_HEADER_BYTES);
}

export function imageMimeTypeForArrayBuffer(arrayBuffer) {
  if (!arrayBuffer) return undefined;
  const bytes = new Uint8Array(arrayBuffer);
  if (startsWithBytes(bytes, PNG_HEADER_BYTES)) return "image/png";
  if (startsWithBytes(bytes, JPEG_HEADER_BYTES)) return "image/jpeg";
  if (startsWithBytes(bytes, GIF87A_HEADER_BYTES) || startsWithBytes(bytes, GIF89A_HEADER_BYTES)) {
    return "image/gif";
  }
  if (
    bytes.byteLength >= 12 &&
    startsWithBytes(bytes, WEBP_RIFF_HEADER_BYTES) &&
    startsWithBytes(bytes.slice(8, 12), WEBP_WEBP_HEADER_BYTES)
  ) {
    return "image/webp";
  }
  return undefined;
}

function createImageBlobUrl(arrayBuffer) {
  const mimeType = imageMimeTypeForArrayBuffer(arrayBuffer);
  if (
    mimeType &&
    typeof Blob !== "undefined" &&
    window.URL &&
    typeof window.URL.createObjectURL === "function"
  ) {
    return window.URL.createObjectURL(new Blob([arrayBuffer], { type: mimeType }));
  }
  return Decrypter.createBlobUrl(arrayBuffer);
}

export function decryptImageArrayBufferWithFallback(arrayBuffer, defaultDecrypt) {
  if (imageMimeTypeForArrayBuffer(arrayBuffer)) return arrayBuffer;

  let defaultResult;
  try {
    defaultResult = defaultDecrypt(arrayBuffer);
  } catch (error) {
    defaultResult = undefined;
  }

  if (imageMimeTypeForArrayBuffer(defaultResult)) return defaultResult;

  const encryptedBytes = new Uint8Array(arrayBuffer || new ArrayBuffer(0));
  if (!hasRpgMakerHeader(encryptedBytes)) {
    if (defaultResult) return defaultResult;
    throw new Error("Header is wrong");
  }

  const body = new Uint8Array(arrayBuffer.slice(16));
  for (let index = 0; index < PNG_HEADER_BYTES.byteLength; index += 1) {
    body[index] = PNG_HEADER_BYTES[index];
  }

  return body.buffer;
}

export function installRpgMakerEncryptionFallback() {
  if (window.__mzPlayerEncryptionFallbackInstalled) return;

  const install = () => {
    if (window.__mzPlayerEncryptionFallbackInstalled) return true;
    const decrypter = window.Decrypter;
    if (!decrypter || typeof decrypter.decryptImg !== "function" || typeof decrypter.decryptArrayBuffer !== "function") {
      return false;
    }

    decrypter.decryptImg = function (url, bitmap) {
      url = this.extToEncryptExt(url);

      const requestFile = new XMLHttpRequest();
      requestFile.open("GET", url);
      requestFile.responseType = "arraybuffer";
      requestFile.send();

      requestFile.onload = function () {
        if (this.status < Decrypter._xhrOk) {
          const arrayBuffer = decryptImageArrayBufferWithFallback(requestFile.response, (source) => {
            return Decrypter.decryptArrayBuffer(source);
          });
          bitmap._image.addEventListener("load", bitmap._loadListener = Bitmap.prototype._onLoad.bind(bitmap));
          bitmap._image.addEventListener(
            "error",
            bitmap._errorListener = bitmap._loader || Bitmap.prototype._onError.bind(bitmap),
          );
          bitmap._image.src = createImageBlobUrl(arrayBuffer);
        }
      };

      requestFile.onerror = function () {
        if (bitmap._loader) {
          bitmap._loader();
        } else {
          bitmap._onError();
        }
      };
    };
    window.__mzPlayerEncryptionFallbackInstalled = true;
    return true;
  };

  if (install()) return;
  setTimeout(installRpgMakerEncryptionFallback, 250);
}

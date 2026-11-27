/**
 * Pure magic-byte content type detection (`05` §3.2.3 step 6).
 * Safe to import from credential-isolated `oaparse/**` (zero Node I/O, HTTP, or Firebase imports).
 */

export type DetectedDocMagic = "PDF" | "XML" | null;

const XML_PREFIX_BYTES = [0x3c, 0x3f, 0x78, 0x6d, 0x6c]; // "<?xml"
const ARTICLE_PREFIX_BYTES = [0x3c, 0x61, 0x72, 0x74, 0x69, 0x63, 0x6c, 0x65]; // "<article"

function toAsciiLowerByte(b: number): number {
  return b >= 0x41 && b <= 0x5a ? b + 32 : b;
}

function matchesAsciiCaseInsensitiveAt(
  bytes: Uint8Array,
  offset: number,
  targetLower: readonly number[]
): boolean {
  if (offset + targetLower.length > bytes.length) return false;
  for (let i = 0; i < targetLower.length; i += 1) {
    if (toAsciiLowerByte(bytes[offset + i]!) !== targetLower[i]!) {
      return false;
    }
  }
  return true;
}

/**
 * Ignores HTTP `Content-Type` (`05` §3.2.3 step 6):
 * - `%PDF-` at offset 0 -> `"PDF"`
 * - `<?xml` or `<article` within the first 1,024 bytes -> `"XML"`
 * - anything else -> `null`
 */
export function detectMagicBytes(bytes: Uint8Array): DetectedDocMagic {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  ) {
    return "PDF";
  }

  let start = 0;
  // Skip UTF-8 BOM if present
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }

  const scanLimit = Math.min(bytes.length, 1024);
  for (let i = start; i < scanLimit; i += 1) {
    if (bytes[i] !== 0x3c /* '<' */) continue;
    if (matchesAsciiCaseInsensitiveAt(bytes, i, XML_PREFIX_BYTES)) {
      return "XML";
    }
    if (matchesAsciiCaseInsensitiveAt(bytes, i, ARTICLE_PREFIX_BYTES)) {
      const nextOffset = i + ARTICLE_PREFIX_BYTES.length;
      if (nextOffset >= bytes.length) {
        return "XML";
      }
      const nextByte = bytes[nextOffset]!;
      // `<article>` or `<article ...>` or `<article/>`
      if (
        nextByte === 0x3e ||
        nextByte === 0x2f ||
        nextByte === 0x20 ||
        nextByte === 0x09 ||
        nextByte === 0x0a ||
        nextByte === 0x0d
      ) {
        return "XML";
      }
    }
  }

  return null;
}

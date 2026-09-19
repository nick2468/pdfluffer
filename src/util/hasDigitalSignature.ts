// Spec 12.4. A signed PDF always stores the /ByteRange key uncompressed, so a plain byte
// scan finds it. The bytes are scanned directly, never decoded to a string.

const NEEDLE = Array.from("/ByteRange", (ch) => ch.charCodeAt(0));

export function hasDigitalSignature(bytes: Uint8Array): boolean {
  const first = NEEDLE[0];
  const last = bytes.length - NEEDLE.length;
  for (let i = bytes.indexOf(first); i !== -1 && i <= last; i = bytes.indexOf(first, i + 1)) {
    let j = 1;
    while (j < NEEDLE.length && bytes[i + j] === NEEDLE[j]) j++;
    if (j === NEEDLE.length) return true;
  }
  return false;
}

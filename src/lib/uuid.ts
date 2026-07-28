/**
 * A client-generated UUID v4.
 *
 * Counter writes are identified by one from the moment they exist: the queue may
 * deliver a bill more than once, and the same id has to store it exactly once.
 * That makes this a correctness dependency rather than a convenience, which is
 * why it does not simply assume `crypto.randomUUID` — that is unavailable on
 * pages served over plain HTTP and in some older Android WebViews, and a counter
 * tablet is exactly the device that would find out.
 *
 * `crypto.getRandomValues` is the fallback, and it is the same source of
 * randomness; only the formatting is done here.
 */
export function newUuid(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  const bytes = new Uint8Array(16)
  webCrypto.getRandomValues(bytes)
  // Version 4, variant 1 — the two fields a v4 UUID pins.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

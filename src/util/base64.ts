/**
 * Encode binary data as URL-safe base64 with padding, matching the wire format
 * of Gmail API response fields like `payload.body.data` and attachment `data`.
 *
 * Gmail API documents these fields as "base64url" (RFC 4648 §5). Empirically,
 * real Gmail responses include the `=` padding, and widely-used clients
 * (e.g. google-workspace-cli) assume padding is present when decoding. Node's
 * built-in `Buffer.toString('base64url')` strips padding, which is still RFC
 * compliant but diverges from real Gmail behavior and breaks those clients.
 *
 * Use this helper for any field fws returns that is supposed to mirror a
 * Gmail API response. For request bodies (e.g. the `raw` field on
 * users.messages.send), either form is acceptable and we decode both.
 */
export function encodeGmailBase64(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

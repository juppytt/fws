import { describe, it, expect } from 'vitest';
import { encodeGmailBase64 } from '../src/util/base64.js';

describe('encodeGmailBase64', () => {
  it('preserves padding (length always a multiple of 4)', () => {
    for (let len = 1; len <= 16; len++) {
      const s = 'x'.repeat(len);
      const encoded = encodeGmailBase64(s);
      expect(encoded.length % 4).toBe(0);
    }
  });

  it('round-trips through standard base64url decode', () => {
    const cases = [
      Buffer.from('hello'),
      Buffer.alloc(0),
      Buffer.from('a'),
      Buffer.from('abcd'),
      Buffer.from('abcde'),
      Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]),
    ];
    for (const buf of cases) {
      const encoded = encodeGmailBase64(buf);
      const decoded = Buffer.from(encoded, 'base64url');
      expect(Buffer.compare(decoded, buf)).toBe(0);
    }
  });

  it('uses URL-safe alphabet (no + or /)', () => {
    // Pick inputs that produce '+' or '/' in standard base64 output.
    const plus = encodeGmailBase64(Buffer.from([0xfb, 0xff]));   // standard: '+/8='
    const slash = encodeGmailBase64(Buffer.from([0xff, 0xff])); // standard: '//8='
    expect(plus).not.toContain('+');
    expect(plus).not.toContain('/');
    expect(slash).not.toContain('+');
    expect(slash).not.toContain('/');
    expect(plus).toBe('-_8=');
    expect(slash).toBe('__8=');
  });

  it('matches padded RFC 4648 §5 output exactly', () => {
    // Precomputed URL-safe padded base64 for common strings.
    expect(encodeGmailBase64('f')).toBe('Zg==');
    expect(encodeGmailBase64('fo')).toBe('Zm8=');
    expect(encodeGmailBase64('foo')).toBe('Zm9v');
    expect(encodeGmailBase64('foob')).toBe('Zm9vYg==');
    expect(encodeGmailBase64('fooba')).toBe('Zm9vYmE=');
    expect(encodeGmailBase64('foobar')).toBe('Zm9vYmFy');
  });

  it('accepts Buffer input', () => {
    expect(encodeGmailBase64(Buffer.from('foo'))).toBe('Zm9v');
  });
});

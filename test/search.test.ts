import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

describe('Search (Custom Search JSON API mock)', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await createTestHarness();
  });

  afterAll(async () => {
    await h.cleanup();
  });

  it('returns 400 when q is missing', async () => {
    const res = await h.fetch('/customsearch/v1?cx=abc');
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toMatch(/q/);
  });

  it('returns fixture results for matching keyword', async () => {
    const res = await h.fetch('/customsearch/v1?q=learn+typescript&cx=abc');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.kind).toBe('customsearch#search');
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0].link).toContain('typescriptlang.org');
    expect(data.items[0].kind).toBe('customsearch#result');
    expect(data.searchInformation.totalResults).toBe(String(data.items.length));
    expect(data.queries.request[0].searchTerms).toBe('learn typescript');
  });

  it('matches case-insensitively', async () => {
    const res = await h.fetch('/customsearch/v1?q=PYTHON+tutorial&cx=abc');
    const data = await res.json();
    expect(data.items[0].displayLink).toBe('www.python.org');
  });

  it('falls back to default results when no keyword matches', async () => {
    const res = await h.fetch('/customsearch/v1?q=zzz_no_match_xyz&cx=abc');
    const data = await res.json();
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0].displayLink).toBe('example.com');
  });

  it('respects num parameter', async () => {
    const res = await h.fetch('/customsearch/v1?q=typescript&cx=abc&num=1');
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.queries.request[0].count).toBe(1);
  });

  it('respects start parameter for pagination', async () => {
    const res1 = await h.fetch('/customsearch/v1?q=typescript&cx=abc&num=1&start=1');
    const res2 = await h.fetch('/customsearch/v1?q=typescript&cx=abc&num=1&start=2');
    const d1 = await res1.json();
    const d2 = await res2.json();
    expect(d1.items[0].link).not.toBe(d2.items[0].link);
    expect(d1.queries.nextPage[0].startIndex).toBe(2);
    expect(d2.queries.previousPage[0].startIndex).toBe(1);
  });

  it('accepts a runtime fixture via setup endpoint', async () => {
    const setupRes = await h.fetch('/__fws/setup/search/fixture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords: ['fwsmagic'],
        results: [{
          title: 'Magic',
          link: 'https://magic.test/',
          displayLink: 'magic.test',
          snippet: 'fws magic snippet',
        }],
      }),
    });
    expect(setupRes.status).toBe(200);

    const res = await h.fetch('/customsearch/v1?q=fwsmagic&cx=abc');
    const data = await res.json();
    expect(data.items[0].link).toBe('https://magic.test/');
    expect(data.items[0].snippet).toBe('fws magic snippet');
  });
});

import { Router } from 'express';
import { getStore } from '../../store/index.js';
import type { SearchResult } from '../../store/types.js';

/**
 * Mocks the Google Custom Search JSON API.
 * https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list
 *
 * Endpoint: GET /customsearch/v1?q=...&cx=...&num=...&start=...
 * Routed via the MITM proxy because `www.googleapis.com` is intercepted.
 */
export function searchRoutes(): Router {
  const r = Router();

  r.get('/customsearch/v1', (req, res) => {
    const q = String(req.query.q ?? '');
    const cx = String(req.query.cx ?? 'fws-default-cx');
    const num = clamp(parseInt(String(req.query.num ?? '10')) || 10, 1, 10);
    const start = Math.max(1, parseInt(String(req.query.start ?? '1')) || 1);

    if (!q) {
      return res.status(400).json({
        error: {
          code: 400,
          message: "Required parameter: q",
          errors: [{ message: 'Required parameter: q', domain: 'global', reason: 'required' }],
        },
      });
    }

    const all = matchResults(q);
    const total = all.length;
    const items = all.slice(start - 1, start - 1 + num);

    const t0 = Date.now();
    const searchTime = (Date.now() - t0) / 1000 + 0.05;

    const queriesRequest = [{
      title: 'Google Custom Search - ' + q,
      totalResults: String(total),
      searchTerms: q,
      count: items.length,
      startIndex: start,
      inputEncoding: 'utf8',
      outputEncoding: 'utf8',
      safe: 'off',
      cx,
    }];

    const response: any = {
      kind: 'customsearch#search',
      url: {
        type: 'application/json',
        template:
          'https://www.googleapis.com/customsearch/v1?q={searchTerms}&num={count?}&start={startIndex?}&cx={cx?}',
      },
      queries: { request: queriesRequest } as any,
      context: { title: 'fws mock search' },
      searchInformation: {
        searchTime,
        formattedSearchTime: searchTime.toFixed(2),
        totalResults: String(total),
        formattedTotalResults: String(total),
      },
      items: items.map(formatItem),
    };

    if (start - 1 + num < total) {
      (response.queries as any).nextPage = [{
        ...queriesRequest[0],
        startIndex: start + num,
      }];
    }
    if (start > 1) {
      (response.queries as any).previousPage = [{
        ...queriesRequest[0],
        startIndex: Math.max(1, start - num),
      }];
    }

    res.json(response);
  });

  // Setup helper: add a search fixture at runtime
  r.post('/__fws/setup/search/fixture', (req, res) => {
    const store = getStore();
    const { keywords, results } = req.body || {};
    if (!Array.isArray(keywords) || !Array.isArray(results)) {
      return res.status(400).json({ error: 'keywords and results arrays required' });
    }
    store.search.fixtures.push({ keywords, results });
    res.json({ status: 'added', count: store.search.fixtures.length });
  });

  return r;
}

function matchResults(query: string): SearchResult[] {
  const store = getStore();
  const lower = query.toLowerCase();
  for (const fix of store.search.fixtures) {
    if (fix.keywords.some(k => lower.includes(k.toLowerCase()))) {
      return fix.results;
    }
  }
  return store.search.defaultResults;
}

function formatItem(r: SearchResult) {
  return {
    kind: 'customsearch#result',
    title: r.title,
    htmlTitle: r.title,
    link: r.link,
    displayLink: r.displayLink,
    snippet: r.snippet,
    htmlSnippet: r.snippet,
    formattedUrl: r.link,
    htmlFormattedUrl: r.link,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

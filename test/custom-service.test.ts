import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTestHarness, type TestHarness } from './helpers/harness.js';

const BANK_SERVICE = {
  host: 'bank.test',
  state: {
    balance: 1000,
    transfers: [],
  },
  routes: [
    {
      method: 'GET',
      path: '/balance',
      response: {
        body: { balance: '$state.balance' },
      },
    },
    {
      method: 'POST',
      path: '/accounts/:account/transfers',
      transitions: [
        { op: 'append', path: 'transfers', value: '$request.body' },
        { op: 'increment', path: 'balance', value: '$request.body.amount', multiplier: -1 },
      ],
      response: {
        status: 201,
        body: {
          account: '$request.params.account',
          balance: '$state.balance',
          message: 'sent {{ $request.body.amount }}',
        },
      },
    },
  ],
};

describe('custom services', () => {
  let h: TestHarness;
  let tempDir: string;

  beforeAll(async () => {
    h = await createTestHarness();
    tempDir = await mkdtemp(path.join(process.cwd(), '.tmp-fws-python-handler-'));
  });

  afterAll(async () => {
    await h.cleanup();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('registers a service and serves dynamic reads', async () => {
    const setup = await registerBank(h);
    expect(setup.status).toBe(200);
    expect(await setup.json()).toEqual({ status: 'registered', host: 'bank.test' });

    const response = await serviceFetch(h, '/balance');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ balance: 1000 });
  });

  it('applies request-derived transitions and returns post-transition state', async () => {
    await registerBank(h);
    const response = await serviceFetch(h, '/accounts/checking/transfers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: 'GB12TEST', amount: 125 }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      account: 'checking',
      balance: 875,
      message: 'sent 125',
    });

    const state = await h.fetch('/__fws/service/bank.test/state');
    expect(await state.json()).toEqual({
      balance: 875,
      transfers: [{ recipient: 'GB12TEST', amount: 125 }],
    });
  });

  it('records requests and snapshots service state', async () => {
    await registerBank(h);
    await serviceFetch(h, '/balance?currency=USD', { headers: { authorization: 'Bearer fake' } });

    const log = await h.fetch('/__fws/service/bank.test/requests');
    const entries = (await log.json()).requests;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      method: 'GET',
      path: '/balance',
      query: { currency: 'USD' },
      headers: { authorization: 'Bearer fake' },
    });

    const snapshot = await h.fetch('/__fws/snapshot/save', { method: 'POST' });
    const data = await snapshot.json();
    expect(data.customServices.services['bank.test'].requests).toHaveLength(1);
  });

  it('rejects built-in hosts and unsafe state paths', async () => {
    const builtIn = await h.fetch('/__fws/setup/service/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BANK_SERVICE, host: 'gmail.googleapis.com' }),
    });
    expect(builtIn.status).toBe(400);

    const unsafe = await h.fetch('/__fws/setup/service/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...BANK_SERVICE,
        routes: [{
          method: 'POST',
          path: '/unsafe',
          transitions: [{ op: 'set', path: '__proto__.polluted', value: true }],
        }],
      }),
    });
    expect(unsafe.status).toBe(400);

    const port = await h.fetch('/__fws/setup/service/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BANK_SERVICE, host: 'bank.test:8443' }),
    });
    expect(port.status).toBe(400);
  });

  it('does not commit partial declarative transitions when one fails', async () => {
    await registerBank(h);
    const response = await serviceFetch(h, '/accounts/checking/transfers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: 'GB12TEST', amount: 'not-a-number' }),
    });
    expect(response.status).toBe(400);

    const state = await h.fetch('/__fws/service/bank.test/state');
    expect(await state.json()).toEqual({ balance: 1000, transfers: [] });
  });

  it('returns a scoped 404 for unmatched service routes', async () => {
    await registerBank(h);
    const response = await serviceFetch(h, '/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: 'custom service route not found',
      host: 'bank.test',
    });
  });

  it('delegates arbitrary behavior to an external Python handler', async () => {
    const script = path.join(tempDir, 'handler.py');
    await writeFile(script, [
      'import json, sys',
      'data = json.load(sys.stdin)',
      'state = data["state"]',
      'request = data["request"]',
      'state.setdefault("messages", []).append(request["body"])',
      'json.dump({"state": state, "response": {"status": 202, "body": {"count": len(state["messages"])}}}, sys.stdout)',
    ].join('\n'));

    const setup = await h.fetch('/__fws/setup/service/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: 'slack.test',
        state: { messages: [] },
        handler: { type: 'python', script },
      }),
    });
    expect(setup.status).toBe(200);

    const response = await h.fetch('/channels/general/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fws-original-host': 'slack.test',
      },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ count: 1 });

    const state = await h.fetch('/__fws/service/slack.test/state');
    expect(await state.json()).toEqual({ messages: [{ text: 'hello' }] });
  });

  it('serializes concurrent Python requests so state updates are not lost', async () => {
    const script = path.join(tempDir, 'serialized.py');
    await writeFile(script, [
      'import json, sys, time',
      'data = json.load(sys.stdin)',
      'state = data["state"]',
      'request = data["request"]',
      'time.sleep(request["body"]["delay"])',
      'state["count"] = state.get("count", 0) + 1',
      'json.dump({"state": state, "response": {"body": {"count": state["count"]}}}, sys.stdout)',
    ].join('\n'));
    await h.fetch('/__fws/setup/service/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: 'counter.test',
        state: { count: 0 },
        handler: { type: 'python', script },
      }),
    });

    const [first, second] = await Promise.all([
      pythonServiceFetch(h, 'counter.test', { delay: 0.1 }),
      pythonServiceFetch(h, 'counter.test', { delay: 0 }),
    ]);
    expect([await first.json(), await second.json()]).toEqual([{ count: 1 }, { count: 2 }]);

    const state = await h.fetch('/__fws/service/counter.test/state');
    expect(await state.json()).toEqual({ count: 2 });
  });

  it('returns 404 when deleting an unknown service', async () => {
    const response = await h.fetch('/__fws/service/missing.test', { method: 'DELETE' });
    expect(response.status).toBe(404);
  });

  it('does not treat inherited object properties as registered hosts', async () => {
    expect((await h.fetch('/__fws/service/constructor/state')).status).toBe(404);
    const response = await h.fetch('/anything', {
      headers: { 'x-fws-original-host': 'constructor' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: 'fws-web-fetch-default' });
  });

  it('rejects invalid response headers before committing state', async () => {
    const declarative = await h.fetch('/__fws/setup/service/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: 'headers.test',
        state: { count: 0 },
        routes: [{
          method: 'POST',
          path: '/increment',
          transitions: [{ op: 'increment', path: 'count', value: 1 }],
          response: { headers: { 'bad header': 'value' } },
        }],
      }),
    });
    expect(declarative.status).toBe(400);

    const script = path.join(tempDir, 'invalid-header.py');
    await writeFile(script, [
      'import json, sys',
      'data = json.load(sys.stdin)',
      'data["state"]["count"] += 1',
      'json.dump({"state": data["state"], "response": {"headers": {"bad header": "value"}}}, sys.stdout)',
    ].join('\n'));
    await h.fetch('/__fws/setup/service/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: 'python-headers.test',
        state: { count: 0 },
        handler: { type: 'python', script },
      }),
    });
    const response = await pythonServiceFetch(h, 'python-headers.test', {});
    expect(response.status).toBe(502);
    const state = await h.fetch('/__fws/service/python-headers.test/state');
    expect(await state.json()).toEqual({ count: 0 });
  });

  it('revalidates Python paths loaded from snapshots before execution', async () => {
    const snapshot = await (await h.fetch('/__fws/snapshot/save', { method: 'POST' })).json();
    snapshot.customServices = {
      services: {
        'snapshot-handler.test': {
          host: 'snapshot-handler.test',
          state: {},
          routes: [],
          handler: { type: 'python', script: '/etc/passwd' },
          requests: [],
        },
      },
    };
    const load = await h.fetch('/__fws/snapshot/load', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect(load.status).toBe(200);

    const response = await pythonServiceFetch(h, 'snapshot-handler.test', {});
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain('must be under');
  });
});

function registerBank(h: TestHarness): Promise<Response> {
  return h.fetch('/__fws/setup/service/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(BANK_SERVICE),
  });
}

function serviceFetch(h: TestHarness, path: string, init?: RequestInit): Promise<Response> {
  return h.fetch(path, {
    ...init,
    headers: {
      'x-fws-original-host': 'bank.test',
      'x-fws-original-scheme': 'https',
      ...init?.headers,
    },
  });
}

function pythonServiceFetch(h: TestHarness, host: string, body: object): Promise<Response> {
  return h.fetch('/increment', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fws-original-host': host,
    },
    body: JSON.stringify(body),
  });
}

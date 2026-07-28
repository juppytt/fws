import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startFwsDaemon, type CliHarness } from './helpers/cli-harness.js';

const FWS_BIN = path.resolve(import.meta.dirname, '..', '..', 'bin', 'fws-cli.js');

describe('e2e: Python custom service through real proxy', () => {
  let h: CliHarness;
  let definitionPath: string;

  beforeAll(async () => {
    h = await startFwsDaemon();

    const handlerPath = path.join(h.dataDir, 'handler.py');
    definitionPath = path.join(h.dataDir, 'service.json');
    await writeFile(handlerPath, [
      'import json, sys',
      'data = json.load(sys.stdin)',
      'state = data["state"]',
      'request = data["request"]',
      'state["last_message"] = request["body"]["text"]',
      'json.dump({"state": state, "response": {"status": 201, "body": {"echo": state["last_message"]}}}, sys.stdout)',
    ].join('\n'));
    await writeFile(definitionPath, JSON.stringify({
      host: 'agent-service.test',
      state: {},
      handler: {
        type: 'python',
        // Verify that the CLI resolves handler paths relative to this file.
        script: './handler.py',
      },
    }));
  });

  afterAll(async () => {
    await h.stop();
  });

  it('registers via CLI and serves HTTPS through the MITM proxy', async () => {
    const registration = await h.run('node', [
      FWS_BIN,
      'service',
      'register',
      definitionPath,
      '--port',
      String(h.port),
    ]);
    expect(registration.exitCode, registration.stderr).toBe(0);
    expect(registration.stdout).toContain('Custom service registered: agent-service.test');

    const request = await h.run('curl', [
      '-sf',
      '--proxy', `http://localhost:${h.proxyPort}`,
      '--cacert', h.caPath,
      '-H', 'content-type: application/json',
      '-d', '{"text":"confidential payload"}',
      'https://agent-service.test/messages',
    ]);
    expect(request.exitCode, request.stderr).toBe(0);
    expect(JSON.parse(request.stdout)).toEqual({ echo: 'confidential payload' });

    const state = await h.run('node', [
      FWS_BIN,
      'service',
      'state',
      'agent-service.test',
      '--port',
      String(h.port),
    ]);
    expect(state.exitCode, state.stderr).toBe(0);
    expect(JSON.parse(state.stdout)).toEqual({ last_message: 'confidential payload' });
  });
});

import { Router, type Request, type RequestHandler } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import path from 'node:path';
import { isAllowlistedHost } from '../../proxy/intercepted-hosts.js';
import { getStore } from '../../store/index.js';
import { getDataDir } from '../../util/paths.js';
import type {
  CustomService,
  CustomServiceRequest,
  CustomServiceRoute,
  CustomServiceTransition,
  JsonValue,
} from '../../store/types.js';

const DEFAULT_PYTHON_TIMEOUT_MS = 5000;
const MAX_PYTHON_TIMEOUT_MS = 60000;
const MAX_HANDLER_OUTPUT_BYTES = 10 * 1024 * 1024;
const handlerQueues = new Map<string, Promise<void>>();

interface RequestContext {
  state: { [key: string]: JsonValue };
  request: {
    body: JsonValue | null;
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    headers: Record<string, string | string[]>;
    method: string;
    path: string;
  };
}

const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const METHOD_PATTERN = /^[A-Z]+$/;

export function customServiceRoutes(): Router {
  const router = Router();

  router.post('/__fws/setup/service/register', async (req, res) => {
    const validationError = validateService(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const service = normalizeService(req.body);
    if (service.handler?.script) {
      try {
        service.handler.script = await resolveTrustedHandlerPath(service.handler.script);
      } catch (error) {
        return res.status(400).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const services = getStore().customServices.services;
    const replaced = Boolean(services[service.host]);
    services[service.host] = service;
    res.json({ status: replaced ? 'replaced' : 'registered', host: service.host });
  });

  router.get('/__fws/service/:host/state', (req, res) => {
    const services = getStore().customServices.services;
    const host = req.params.host.toLowerCase();
    const service = Object.hasOwn(services, host) ? services[host] : undefined;
    if (!service) return res.status(404).json({ error: 'custom service not found' });
    res.json(service.state);
  });

  router.get('/__fws/service/:host/requests', (req, res) => {
    const services = getStore().customServices.services;
    const host = req.params.host.toLowerCase();
    const service = Object.hasOwn(services, host) ? services[host] : undefined;
    if (!service) return res.status(404).json({ error: 'custom service not found' });
    res.json({ requests: service.requests });
  });

  router.delete('/__fws/service/:host', (req, res) => {
    const host = req.params.host.toLowerCase();
    const services = getStore().customServices.services;
    if (!Object.hasOwn(services, host)) {
      return res.status(404).json({ error: 'custom service not found' });
    }
    delete services[host];
    res.json({ status: 'deleted', host });
  });

  return router;
}

export function customServiceDispatcher(): RequestHandler {
  return async (req, res, next) => {
    const originalHost = req.header('x-fws-original-host')?.toLowerCase();
    if (!originalHost) return next();

    const services = getStore().customServices.services;
    const service = Object.hasOwn(services, originalHost) ? services[originalHost] : undefined;
    if (!service) return next();

    const match = service.handler ? null : findRoute(service.routes, req.method, req.path);
    if (!service.handler && !match) {
      return res.status(404).json({
        error: 'custom service route not found',
        host: originalHost,
        method: req.method,
        path: req.path,
      });
    }

    const request = makeRequestRecord(req, match?.params ?? {});
    service.requests.push(request);
    const context: RequestContext = {
      state: service.state,
      request: {
        body: request.body,
        params: request.params,
        query: request.query,
        headers: request.headers,
        method: request.method,
        path: request.path,
      },
    };

    try {
      if (service.handler) {
        const result = await serializeHandlerRequest(service.host, async () => {
          const handlerResult = await runPythonHandler(service, request);
          validateResponseHeaders(handlerResult.response.headers);
          service.state = handlerResult.state;
          return handlerResult;
        });
        for (const [name, value] of Object.entries(result.response.headers ?? {})) {
          res.setHeader(name, value);
        }
        res.status(result.response.status ?? 200);
        if (result.response.body === null || result.response.status === 204) return res.end();
        return typeof result.response.body === 'string'
          ? res.send(result.response.body)
          : res.json(result.response.body ?? { ok: true });
      }

      if (!match) throw new Error('custom service route was not resolved');
      const nextState = structuredClone(service.state);
      const nextContext: RequestContext = { ...context, state: nextState };
      for (const transition of match.route.transitions ?? []) {
        applyTransition(nextState, transition, nextContext);
      }
      const response = match.route.response ?? {};
      const body = response.body === undefined ? { ok: true } : resolveValue(response.body, nextContext);
      validateResponseHeaders(response.headers);
      service.state = nextState;
      for (const [name, value] of Object.entries(response.headers ?? {})) {
        res.setHeader(name, value);
      }
      res.status(response.status ?? 200);
      if (body === null || response.status === 204) return res.end();
      return typeof body === 'string' ? res.send(body) : res.json(body);
    } catch (error) {
      return res.status(service.handler ? 502 : 400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

export function hasCustomServiceHost(hostname: string): boolean {
  try {
    return Object.hasOwn(getStore().customServices.services, hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validateService(value: unknown): string | null {
  if (!isPlainObject(value)) return 'service must be a JSON object';
  if (typeof value.host !== 'string' || !HOST_PATTERN.test(value.host)) {
    return 'host must be a hostname without a scheme or path';
  }
  if (isAllowlistedHost(value.host.toLowerCase())) {
    return 'host conflicts with a built-in fws service';
  }
  if (value.state !== undefined && !isPlainObject(value.state)) {
    return 'state must be a JSON object';
  }
  const handlerError = validateHandler(value.handler);
  if (handlerError) return handlerError;
  if (value.handler === undefined && (!Array.isArray(value.routes) || value.routes.length === 0)) {
    return 'routes must be a non-empty array when no handler is configured';
  }
  if (value.handler !== undefined && value.routes !== undefined && (!Array.isArray(value.routes) || value.routes.length > 0)) {
    return 'handler and routes are mutually exclusive';
  }

  for (const [index, route] of ((value.routes as unknown[] | undefined) ?? []).entries()) {
    if (!isPlainObject(route)) return `routes[${index}] must be an object`;
    const method = typeof route.method === 'string' ? route.method.toUpperCase() : '';
    if (!METHOD_PATTERN.test(method)) return `routes[${index}].method is invalid`;
    if (typeof route.path !== 'string' || !route.path.startsWith('/')) {
      return `routes[${index}].path must start with /`;
    }
    if (route.response !== undefined && !isPlainObject(route.response)) {
      return `routes[${index}].response must be an object`;
    }
    if (isPlainObject(route.response) && route.response.headers !== undefined) {
      if (!isStringRecord(route.response.headers)) {
        return `routes[${index}].response.headers must contain string values`;
      }
      try {
        validateResponseHeaders(route.response.headers);
      } catch (error) {
        return `routes[${index}].response.headers are invalid: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }
    const status = isPlainObject(route.response) ? route.response.status : undefined;
    if (status !== undefined && (!Number.isInteger(status) || Number(status) < 100 || Number(status) > 599)) {
      return `routes[${index}].response.status must be an HTTP status code`;
    }
    if (route.transitions !== undefined && !Array.isArray(route.transitions)) {
      return `routes[${index}].transitions must be an array`;
    }
    for (const [transitionIndex, transition] of ((route.transitions as unknown[] | undefined) ?? []).entries()) {
      if (!isPlainObject(transition)) {
        return `routes[${index}].transitions[${transitionIndex}] must be an object`;
      }
      if (!['set', 'append', 'increment', 'delete'].includes(String(transition.op))) {
        return `routes[${index}].transitions[${transitionIndex}].op is invalid`;
      }
      if (typeof transition.path !== 'string' || safePathParts(transition.path) === null) {
        return `routes[${index}].transitions[${transitionIndex}].path is invalid`;
      }
      if (transition.op !== 'delete' && transition.value === undefined) {
        return `routes[${index}].transitions[${transitionIndex}].value is required`;
      }
      if (transition.multiplier !== undefined && typeof transition.multiplier !== 'number') {
        return `routes[${index}].transitions[${transitionIndex}].multiplier must be a number`;
      }
    }
  }
  return null;
}

function normalizeService(value: Record<string, unknown>): CustomService {
  return {
    host: String(value.host).toLowerCase(),
    state: structuredClone((value.state ?? {}) as { [key: string]: JsonValue }),
    routes: structuredClone((value.routes ?? []) as CustomServiceRoute[]).map(route => ({
      ...route,
      method: route.method.toUpperCase(),
    })),
    handler: value.handler === undefined
      ? undefined
      : structuredClone(value.handler as CustomService['handler']),
    requests: [],
  };
}

function validateHandler(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isPlainObject(value) || value.type !== 'python') {
    return 'handler must have type "python"';
  }
  const hasScript = typeof value.script === 'string';
  const hasModule = typeof value.module === 'string';
  if (hasScript === hasModule) {
    return 'handler must specify exactly one of script or module';
  }
  if (hasScript && !(value.script as string).startsWith('/')) {
    return 'handler.script must be an absolute path';
  }
  if (hasModule && !/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(value.module as string)) {
    return 'handler.module must be an importable Python module name';
  }
  if (
    value.timeoutMs !== undefined
    && (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 1 || Number(value.timeoutMs) > MAX_PYTHON_TIMEOUT_MS)
  ) {
    return `handler.timeoutMs must be between 1 and ${MAX_PYTHON_TIMEOUT_MS}`;
  }
  return null;
}

async function runPythonHandler(
  service: CustomService,
  request: CustomServiceRequest,
): Promise<{
  state: { [key: string]: JsonValue };
  response: { status?: number; headers?: Record<string, string>; body?: JsonValue };
}> {
  if (!service.handler) throw new Error('python handler is not configured');
  const target = service.handler.script
    ? { type: 'script' as const, value: await resolveTrustedHandlerPath(service.handler.script) }
    : { type: 'module' as const, value: service.handler.module! };
  const input = JSON.stringify({ state: service.state, request });
  const python = process.env.FWS_PYTHON || 'python3';
  const stdout = await executePython(
    python,
    target,
    input,
    service.handler.timeoutMs ?? DEFAULT_PYTHON_TIMEOUT_MS,
  );

  let output: unknown;
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error('python handler must write one JSON object to stdout');
  }
  if (!isPlainObject(output) || !isPlainObject(output.state) || !isPlainObject(output.response)) {
    throw new Error('python handler output must contain state and response objects');
  }
  if (
    output.response.status !== undefined
    && (!Number.isInteger(output.response.status) || Number(output.response.status) < 100 || Number(output.response.status) > 599)
  ) {
    throw new Error('python handler response.status must be an HTTP status code');
  }
  if (output.response.headers !== undefined && !isStringRecord(output.response.headers)) {
    throw new Error('python handler response.headers must contain string values');
  }
  validateResponseHeaders(output.response.headers as Record<string, string> | undefined);

  return {
    state: toJsonValue(output.state) as { [key: string]: JsonValue },
    response: toJsonValue(output.response) as {
      status?: number;
      headers?: Record<string, string>;
      body?: JsonValue;
    },
  };
}

async function serializeHandlerRequest<T>(host: string, operation: () => Promise<T>): Promise<T> {
  const previous = handlerQueues.get(host) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(() => undefined, () => undefined);
  handlerQueues.set(host, tail);
  try {
    return await result;
  } finally {
    if (handlerQueues.get(host) === tail) handlerQueues.delete(host);
  }
}

async function resolveTrustedHandlerPath(script: string): Promise<string> {
  let resolved: string;
  try {
    resolved = await fs.realpath(script);
  } catch {
    throw new Error(`python handler script does not exist: ${script}`);
  }

  const configuredRoots = (process.env.FWS_HANDLER_ROOTS ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  const roots = [getDataDir(), process.cwd(), ...configuredRoots];
  for (const root of roots) {
    let resolvedRoot: string;
    try {
      resolvedRoot = await fs.realpath(root);
    } catch {
      continue;
    }
    if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) return resolved;
  }
  throw new Error(
    `python handler script must be under FWS_DATA_DIR, the fws working directory, or FWS_HANDLER_ROOTS: ${script}`,
  );
}

function executePython(
  python: string,
  target: { type: 'script' | 'module'; value: string },
  input: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = target.type === 'module' ? ['-m', target.value] : [target.value];
    const child = spawn(python, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (error?: Error, output?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output ?? '');
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`python handler timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', error => finish(new Error(`python handler failed to start: ${error.message}`)));
    const collectOutput = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_HANDLER_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new Error(`python handler combined output exceeded ${MAX_HANDLER_OUTPUT_BYTES} bytes`));
        return false;
      }
      target.push(chunk);
      return true;
    };
    child.stdout.on('data', (chunk: Buffer) => collectOutput(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collectOutput(stderr, chunk));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf-8').trim();
        finish(new Error(`python handler exited with code ${code}${detail ? `: ${detail}` : ''}`));
        return;
      }
      finish(undefined, Buffer.concat(stdout).toString('utf-8'));
    });

    child.stdin.on('error', error => finish(new Error(`python handler stdin failed: ${error.message}`)));
    child.stdin.end(input);
  });
}

function findRoute(
  routes: CustomServiceRoute[],
  method: string,
  path: string,
): { route: CustomServiceRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method.toUpperCase()) continue;
    const routeParts = splitUrlPath(route.path);
    const requestParts = splitUrlPath(path);
    if (routeParts.length !== requestParts.length) continue;

    const params: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < routeParts.length; index++) {
      const expected = routeParts[index];
      const actual = requestParts[index];
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        matches = false;
        break;
      }
    }
    if (matches) return { route, params };
  }
  return null;
}

function splitUrlPath(value: string): string[] {
  if (value === '/') return [];
  return value.replace(/^\/|\/$/g, '').split('/');
}

function makeRequestRecord(req: Request, params: Record<string, string>): CustomServiceRequest {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') query[key] = value;
    else if (Array.isArray(value)) query[key] = value.map(String);
    else if (value !== undefined) query[key] = String(value);
  }

  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' || Array.isArray(value)) headers[key] = value;
  }

  return {
    timestamp: new Date().toISOString(),
    method: req.method.toUpperCase(),
    path: req.path,
    params,
    query,
    headers,
    body: toJsonValue(req.body),
  };
}

function applyTransition(
  state: { [key: string]: JsonValue },
  transition: CustomServiceTransition,
  context: RequestContext,
): void {
  const parts = safePathParts(transition.path);
  if (!parts) throw new Error(`invalid state path: ${transition.path}`);

  if (transition.op === 'delete') {
    deleteAtPath(state, parts);
    return;
  }

  const value = resolveValue(transition.value as JsonValue, context);
  if (transition.op === 'set') {
    setAtPath(state, parts, value);
  } else if (transition.op === 'append') {
    const target = getAtPath(state, parts);
    if (!Array.isArray(target)) throw new Error(`append target is not an array: ${transition.path}`);
    target.push(structuredClone(value));
  } else {
    const target = getAtPath(state, parts);
    if (typeof target !== 'number' || typeof value !== 'number') {
      throw new Error(`increment requires numeric target and value: ${transition.path}`);
    }
    setAtPath(state, parts, target + value * (transition.multiplier ?? 1));
  }
}

function resolveValue(value: JsonValue, context: RequestContext): JsonValue {
  if (typeof value === 'string') {
    if (value.startsWith('$') && !value.includes('{{')) {
      return structuredClone(resolveReference(value, context));
    }
    return value.replace(/\{\{\s*(\$[^}]+?)\s*\}\}/g, (_match, reference: string) => {
      const resolved = resolveReference(reference.trim(), context);
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map(item => resolveValue(item, context));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item as JsonValue, context)]));
  }
  return value;
}

function resolveReference(reference: string, context: RequestContext): JsonValue {
  const parts = reference.slice(1).split('.');
  const root = parts.shift();
  if (root !== 'state' && root !== 'request') throw new Error(`unknown expression root: $${root}`);
  const value = getAtPath(context[root], parts);
  if (value === undefined) throw new Error(`expression did not resolve: ${reference}`);
  return value as JsonValue;
}

function safePathParts(path: string): string[] | null {
  const parts = path.split('.');
  if (parts.length === 0 || parts.some(part => !part || FORBIDDEN_PATH_PARTS.has(part))) return null;
  return parts;
}

function getAtPath(root: unknown, parts: string[]): unknown {
  let current = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setAtPath(root: { [key: string]: JsonValue }, parts: string[], value: JsonValue): void {
  let current: Record<string, JsonValue> = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!isPlainObject(next)) current[part] = {};
    current = current[part] as Record<string, JsonValue>;
  }
  current[parts[parts.length - 1]] = structuredClone(value);
}

function deleteAtPath(root: { [key: string]: JsonValue }, parts: string[]): void {
  const parent = getAtPath(root, parts.slice(0, -1));
  if (isPlainObject(parent)) delete parent[parts[parts.length - 1]];
}

function toJsonValue(value: unknown): JsonValue | null {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every(item => typeof item === 'string');
}

function validateResponseHeaders(headers: Record<string, string> | undefined): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    validateHeaderName(name);
    validateHeaderValue(name, value);
  }
}

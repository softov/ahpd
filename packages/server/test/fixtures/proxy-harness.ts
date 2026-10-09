/*
 * What the proxy tests share: a fake provider, the proxy on a real socket, a
 * plain HTTP client that may send any `Host`, a usage store in memory and a
 * small users file.
 *
 * The proxy is served through `plainRequests`, which is what the daemon's own
 * listener goes through on Node, so a hang-up and a streamed body behave as
 * they do in the daemon.
 */

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileUsers, type UsageEntry, type Usage, type Users } from '@ahpd/sdk';
import { plainRequests, type ApiOrigins } from '../../src/http.js';
import { proxyHandler, type ProxyOptions } from '../../src/proxy/listener.js';
import { proxyConfiguration, type ProxySetting } from '../../src/proxy/providers.js';

/** A key nobody has, so anything that held it is found by looking for it. */
export const MARKER = 'sk-marker-0f9e8d7c6b5a';

/** The deployment token the tests use. */
export const ROOT_TOKEN = 'deployment-token-for-the-proxy-tests';

/** One request the fake provider was sent. */
export interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
  /** Whether the request's connection closed before the fake ended its answer. */
  closed: boolean;
}

/** A fake provider on loopback that records what it was sent. */
export interface FakeProvider {
  /** Its endpoint, as a provider entry writes it: `http://127.0.0.1:<port>/v1`. */
  endpoint: string;
  /** Every request it was sent, in order. */
  received: Received[];
  close(): Promise<void>;
}

/** What answers one request to the fake; the record is filled before it is called. */
export type FakeAnswer = (request: Received, response: ServerResponse) => void | Promise<void>;

const closing = (server: Server): Promise<void> => new Promise((done) => {
  server.closeAllConnections();
  server.close(() => { done(); });
});

/** A fake provider answering each request with `answer`. */
export const fakeProvider = async (answer: FakeAnswer): Promise<FakeProvider> => {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const one: Received = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        closed: false,
      };
      response.on('close', () => { if (!response.writableFinished) one.closed = true; });
      received.push(one);
      void Promise.resolve(answer(one, response)).catch(() => { response.destroy(); });
    });
  });
  await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done); });
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${String(port)}/v1`, received, close: () => closing(server) };
};

/** A JSON answer from the fake. */
export const answerJson = (status: number, value: unknown, headers: Record<string, string> = {}): FakeAnswer => (_request, response) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(value));
};

/** A usage store that keeps its records in an array. */
export const memoryUsage = (): Usage & { entries: UsageEntry[] } => {
  const entries: UsageEntry[] = [];
  return {
    entries,
    record: async (entry: UsageEntry) => { entries.push(entry); },
    total: async () => ({}),
    pools: async () => [],
    records: async () => [],
    groups: async () => [],
  } as unknown as Usage & { entries: UsageEntry[] };
};

/** The people the tests call as, and a token for each. */
export interface People {
  users: Users;
  /** `member`, in `backend:billing` and `backend:ahpd`, primary `backend:billing`. */
  ana: string;
  /** `guest`, in no team. */
  gus: string;
  /** A role of `file:read` alone, which holds no proxy grant. */
  fay: string;
  /** `admin`, holding `*:*`, in the team `backend`. */
  dee: string;
  /** `member`, removed after the token was minted. */
  rex: string;
}

/** A users file in `folder` with the people above. */
export const people = async (folder: string): Promise<People> => {
  const users = fileUsers({ path: join(folder, 'users.json') });
  await users.addTeam('backend');
  await users.addProject('billing');
  await users.addProject('ahpd');
  await users.addRole('reader', ['file:read']);
  await users.add('ana', ['member'], { memberships: ['backend:billing', 'backend:ahpd'], primary: 'backend:billing' });
  await users.add('gus', ['guest']);
  await users.add('fay', ['reader']);
  await users.add('dee', ['admin'], { memberships: ['backend'] });
  await users.add('rex', ['member']);
  const tokens = {
    ana: await users.mint('ana'),
    gus: await users.mint('gus'),
    fay: await users.mint('fay'),
    dee: await users.mint('dee'),
    rex: await users.mint('rex'),
  };
  await users.remove('rex');
  return { users, ...tokens };
};

/** The proxy on a socket of its own, and what it said to the log. */
export interface Served {
  port: number;
  /** Every line the proxy handed `onProblem`. */
  log: string[];
  close(): Promise<void>;
}

/** What the tests may set on the proxy: everything, with a `proxy` setting in place of the table. */
export type ServeOptions = Partial<Omit<ProxyOptions, 'proxy'>> & { proxy?: ProxySetting };

/** The proxy served on `127.0.0.1:0`, answering `/api` and everything else with a plain 418. */
export const serveProxy = async (given: ServeOptions = {}): Promise<Served> => {
  const log: string[] = [];
  let port = 0;
  const { proxy: setting, ...rest } = given;
  const table = proxyConfiguration(setting);
  const origins = (): ApiOrigins => ({
    authorities: ['127.0.0.1', 'localhost', '[::1]'].map((name) => `${name}:${String(port)}`),
    origins: ['127.0.0.1', 'localhost', '[::1]'].map((name) => `http://${name}:${String(port)}`),
  });
  const handler = proxyHandler({
    proxy: () => table,
    token: ROOT_TOKEN,
    hostName: 'testbox',
    origins,
    otherwise: async () => new Response('below', { status: 418 }),
    onProblem: (line) => { log.push(line); },
    env: {},
    ...rest,
  });
  const server = createServer(plainRequests(handler).nodeRequest);
  await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done); });
  port = (server.address() as AddressInfo).port;
  return { port, log, close: () => closing(server) };
};

/** One answer, read whole. */
export interface Said {
  status: number;
  headers: IncomingMessage['headers'];
  text: string;
  /** The body parsed as JSON, or `undefined` when it is not. */
  json: unknown;
}

/** What one request sends. */
export interface Sent {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** A request over plain `node:http`, which sends whatever `Host` it is given. */
export const send = (port: number, path: string, sent: Sent = {}): Promise<Said> => new Promise((resolve, reject) => {
  const body = sent.body === undefined ? undefined : typeof sent.body === 'string' ? sent.body : JSON.stringify(sent.body);
  const one = httpRequest({
    host: '127.0.0.1',
    port,
    path,
    method: sent.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      host: `127.0.0.1:${String(port)}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...sent.headers,
    },
  }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let json: unknown;
      try { json = JSON.parse(text) as unknown; }
      catch { json = undefined; }
      resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json });
    });
    response.on('error', reject);
  });
  one.on('error', reject);
  if (body !== undefined) one.write(body);
  one.end();
});

/** Whether a value is OpenAI's error body. */
export const isOpenAiError = (value: unknown): boolean => {
  const error = (value as { error?: Record<string, unknown> } | undefined)?.error;
  return typeof error === 'object' && error !== null
    && typeof error['message'] === 'string' && typeof error['type'] === 'string'
    && 'param' in error && 'code' in error && Object.keys(value as object).length === 1;
};

/** Whether a value is Anthropic's error body. */
export const isAnthropicError = (value: unknown): boolean => {
  const body = value as { type?: unknown; error?: Record<string, unknown> } | undefined;
  return body?.type === 'error' && typeof body.error === 'object' && body.error !== null
    && typeof body.error['type'] === 'string' && typeof body.error['message'] === 'string';
};

/** A short wait. */
export const pause = (ms: number): Promise<void> => new Promise((done) => { setTimeout(done, ms); });

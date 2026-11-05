import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { localPath, uriOf } from '../src/resources/fileuri.js';
import { debugLogs } from '../src/sessions/debuglogs.js';
import { crc32, zip } from '../src/utils/zip.js';
import { echo } from '../../../examples/echo/agent.js';
import { claude } from '../../agent-claude/src/claude.js';
import type { Agent } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * What the reference window asks a host about itself.
 *
 * Its own requests, outside the protocol: where a session's file is, the
 * logs packed up for a bug report, what the network looks like from here,
 * and stopping the host. Each is served here in the shape the window reads.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-diag-'));
  made.push(dir);
  return dir;
};

/** The archive read back the way any unzip reads it: from the directory at the end. */
const unzipped = (file: string): Map<string, Buffer> => {
  const data = readFileSync(file);
  const end = data.length - 22;
  expect(data.readUInt32LE(end)).toBe(0x06054b50);
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const found = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(data.readUInt32LE(at)).toBe(0x02014b50);
    const method = data.readUInt16LE(at + 10);
    const crc = data.readUInt32LE(at + 16);
    const packedSize = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const local = data.readUInt32LE(at + 42);
    const name = data.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    expect(data.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const packed = data.subarray(start, start + packedSize);
    const content = method === 8 ? inflateRawSync(packed) : Buffer.from(packed);
    expect(crc32(content)).toBe(crc);
    found.set(name, content);
    at += 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
  }
  return found;
};

describe('the archive', () => {
  it('is a zip any reader opens, with each entry deflated and checked', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'a.log'), 'hello\n'.repeat(1000));
    writeFileSync(join(dir, 'b.jsonl'), '{"x":1}\n');
    const size = await zip(join(dir, 'out.zip'), [{ path: 'agenthost/a.log', from: join(dir, 'a.log') }, { path: 'events.jsonl', from: join(dir, 'b.jsonl') }]);
    expect(statSync(join(dir, 'out.zip')).size).toBe(size);
    const entries = unzipped(join(dir, 'out.zip'));
    expect([...entries.keys()]).toEqual(['agenthost/a.log', 'events.jsonl']);
    expect(entries.get('agenthost/a.log')?.toString()).toBe('hello\n'.repeat(1000));
    expect(entries.get('events.jsonl')?.toString()).toBe('{"x":1}\n');
    // Smaller than what went in, so it was deflated rather than stored.
    expect(size).toBeLessThan(6000);
  });
});

describe('collecting logs', () => {
  it('packs what is there, skips what is not, and reads the archive back a chunk at a time', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'daemon.log'), 'started\n');
    writeFileSync(join(dir, 'events.jsonl'), 'x'.repeat(3000));
    const logs = debugLogs({ tmp: dir, lease: 60_000 });
    const got = await logs.collect([
      { path: 'agenthost/daemon.log', from: join(dir, 'daemon.log') },
      { path: 'agenthost/gone.log', from: join(dir, 'gone.log') },
      { path: 'events.jsonl', from: join(dir, 'events.jsonl'), provider: 'echo' },
    ], 'archive');
    expect(got.kind).toBe('archive');
    expect(got.providerLogsIncluded).toBe(true);
    expect(got.entries).toEqual([{ path: 'agenthost/daemon.log', size: 8 }, { path: 'events.jsonl', size: 3000 }]);
    expect(got.uncompressedSize).toBe(3008);
    expect(got.resource.startsWith('file://')).toBe(true);
    const archive = localPath(got.resource);
    expect(got.size).toBe(statSync(archive).size);
    // Read whole through the chunk reader, which is how a window elsewhere gets it.
    let position = 0;
    const parts: Buffer[] = [];
    for (;;) {
      const chunk = await logs.read(got.resource, position);
      parts.push(Buffer.from(chunk.data, 'base64'));
      position += parts.at(-1)?.length ?? 0;
      if (chunk.eof) break;
    }
    expect(Buffer.concat(parts).equals(readFileSync(archive))).toBe(true);
    expect(unzipped(archive).get('events.jsonl')?.length).toBe(3000);
    // Only what this collector made: the reader is not a way to read any file.
    await expect(logs.read(uriOf(join(dir, 'daemon.log')), 0)).rejects.toThrow('Unknown or expired');
    await expect(logs.read(got.resource, -1)).rejects.toThrow('Invalid debug-log artifact position');
    // A directory stays where it is, and goes when the collector lets go.
    const opened = await logs.collect([{ path: 'agenthost/daemon.log', from: join(dir, 'daemon.log') }], 'directory');
    expect(opened.kind).toBe('directory');
    expect(readFileSync(join(localPath(opened.resource), 'agenthost', 'daemon.log'), 'utf8')).toBe('started\n');
    expect(opened.providerLogsIncluded).toBe(false);
    await logs.close();
    expect(() => statSync(archive)).toThrow();
    expect(() => statSync(localPath(opened.resource))).toThrow();
  });
});

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return { notes, send: () => {}, notify: (method, params) => notes.push({ method, params }), request: async () => ({}), answered: () => {}, close: () => {} };
}

describe('what the window asks', () => {
  /** A host on the echo agent, told where its own records and logs are. */
  const serving = (dir: string, extra: Partial<Agent> = {}, diagnostics?: Parameters<typeof createHost>[0]['diagnostics']) => {
    const agent = { ...echo({ path: dir, pace: 0 }), ...extra } as Agent;
    const host = createHost({ path: dir, agents: [agent], ...(diagnostics ? { diagnostics } : {}) });
    return async () => {
      const p = peer();
      const client = host.accept(p);
      const said = await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'] } }) as { _meta?: Record<string, unknown>; serverInfo: { version: string } };
      return { client, said };
    };
  };

  it('says where a session\'s file is, for the session or one chat of it', async () => {
    const dir = scratch();
    const asked: { id: string; directory: string }[] = [];
    const join_ = await serving(dir, { stateFile: (id, directory) => { asked.push({ id, directory }); return id === 'none' ? undefined : join(dir, `${id}.jsonl`); } })();
    expect(join_.said._meta?.['vscode.getAgentHostSessionStateFile.chat']).toBe(true);
    await join_.client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    const state = (await join_.client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as { snapshot: { state: { defaultChat: string } } }).snapshot.state;
    expect(await join_.client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/one' } })).toEqual({ resource: uriOf(join(dir, 'one.jsonl')) });
    expect(await join_.client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/one', chat: state.defaultChat } })).toEqual({ resource: uriOf(join(dir, 'one.jsonl')) });
    expect(asked.at(-1)).toEqual({ id: 'one', directory: dir });
    await expect(join_.client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/one', chat: 'ahp-chat://x/nobody' } }))
      .rejects.toMatchObject({ code: -32602, message: 'chat must belong to the requested Agent Session' });
    await join_.client.handle({ method: 'createSession', params: { channel: 'ahp-session:/none', provider: 'echo' } });
    expect(await join_.client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/none' } })).toEqual({});
  });

  /*
   * VS Code checks a named chat against its recorded owner, so a chat of a
   * session nobody runs passes.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4326-L4331
   */
  it('says where the file is for a chat of a session nobody runs, its owner read from the record', async () => {
    const dir = scratch();
    const stamp = new Date().toISOString();
    const { client } = await serving(dir, {
      list: async () => [{ id: 'one', title: 'one', createdAt: stamp, modifiedAt: stamp, workingDirectories: [uriOf(dir)] }],
      stateFile: (id) => join(dir, `${id}.jsonl`),
    })();
    await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const chat = `ahp-chat://default/${Buffer.from('ahp-session:/one', 'utf8').toString('base64url')}`;
    expect(await client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/one', chat } }))
      .toEqual({ resource: uriOf(join(dir, 'one.jsonl')) });
  });

  it('answers no file for a backend that keeps none', async () => {
    const dir = scratch();
    const { client } = await serving(dir)();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    expect(await client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/one' } })).toEqual({});
  });

  it('collects the host\'s logs and the session\'s record under the reference host\'s names', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'daemon.log'), 'up\n');
    writeFileSync(join(dir, 'one.jsonl'), '{"type":"user"}\n');
    const { client } = await serving(dir, { stateFile: (id) => join(dir, `${id}.jsonl`) }, { logs: () => [join(dir, 'daemon.log'), join(dir, 'missing.log')] })();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    const got = await client.handle({ method: 'vscode/collectAgentHostDebugLogs', params: { session: 'ahp-session:/one', kind: 'archive' } }) as {
      entries: { path: string }[]; providerLogsIncluded: boolean; resource: string;
    };
    expect(got.entries.map((one) => one.path)).toEqual(['events.jsonl', 'agenthost/daemon.log']);
    expect(got.providerLogsIncluded).toBe(true);
    const chunk = await client.handle({ method: 'vscode/readAgentHostDebugLogsChunk', params: { resource: got.resource, position: 0 } }) as { data: string; eof: boolean };
    expect(chunk.eof).toBe(true);
    expect(Buffer.from(chunk.data, 'base64').readUInt32LE(0)).toBe(0x04034b50);
    rmSync(localPath(got.resource), { force: true });
    // Without a session, the host's own and nothing of any backend's.
    const own = await client.handle({ method: 'vscode/collectAgentHostDebugLogs', params: { kind: 'directory' } }) as { entries: { path: string }[]; providerLogsIncluded: boolean; resource: string };
    expect(own.entries.map((one) => one.path)).toEqual(['agenthost/daemon.log']);
    expect(own.providerLogsIncluded).toBe(false);
    rmSync(localPath(own.resource), { recursive: true, force: true });
    await expect(client.handle({ method: 'vscode/collectAgentHostDebugLogs', params: { kind: 'tarball' } })).rejects.toMatchObject({ code: -32602 });
  });

  /*
   * VS Code's chunk read: the params refused in its words, a failure of the
   * read itself left as it is, which the wire answers as an internal error.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4160-L4184
   */
  it('refuses a chunk read\'s params in VS Code\'s words, and leaves a failed read as it is', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'daemon.log'), 'up\n');
    const { client } = await serving(dir)();
    const read = (params: Record<string, unknown>) => client.handle({ method: 'vscode/readAgentHostDebugLogsChunk', params });
    await expect(read({ resource: 1, position: 0 })).rejects.toMatchObject({ code: -32602, message: 'resource must be a URI string' });
    await expect(read({ resource: 'not a uri', position: 0 })).rejects.toMatchObject({ code: -32602, message: 'resource must be a valid URI string' });
    await expect(read({ resource: uriOf(join(dir, 'daemon.log')), position: -1 })).rejects.toMatchObject({ code: -32602, message: 'position must be a non-negative integer' });
    await expect(read({ resource: uriOf(join(dir, 'daemon.log')), position: 0 }))
      .rejects.toMatchObject({ message: 'Unknown or expired Agent Host debug-log artifact' });
    await expect(read({ resource: uriOf(join(dir, 'daemon.log')), position: 0 })).rejects.not.toHaveProperty('code', -32602);
  });

  /*
   * VS Code follows a collection under its progress token: root/progress as
   * it goes and once at the end, marked as the debug logs', a token already
   * in use refused, and its client's cancel calling it off.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4086-L4159
   */
  it('says a followed collection\'s progress, refuses its token twice, and calls it off at its client\'s cancel', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'daemon.log'), 'up\n');
    const host = createHost({ path: dir, agents: [echo({ path: dir, pace: 0 })], diagnostics: { logs: () => [join(dir, 'daemon.log')] } });
    const p = peer();
    const client = host.accept(p);
    const said = await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } }) as { _meta?: Record<string, unknown> };
    expect(said._meta?.['vscode.debugLogsCancellation']).toBe(true);
    const got = await client.handle({ method: 'vscode/collectAgentHostDebugLogs', params: { kind: 'archive', progressToken: 'p1' } }) as { resource: string };
    rmSync(localPath(got.resource), { force: true });
    const progress = p.notes.filter((one) => one.method === 'root/progress').map((one) => one.params as Record<string, unknown>);
    expect(progress[0]).toEqual({ channel: 'ahp-root://', progressToken: 'p1', progress: 0, message: 'Collecting Agent Host process and transport logs...', _meta: { 'vscode.debugLogs': true } });
    expect(progress.at(-1)).toEqual({ channel: 'ahp-root://', progressToken: 'p1', progress: 3, total: 3, _meta: { 'vscode.debugLogs': true } });

    // A token nobody follows, and a cancel that names none, refused in VS Code's words.
    await expect(client.handle({ method: 'vscode/cancelAgentHostDebugLogs', params: { progressToken: 'p1' } }))
      .rejects.toMatchObject({ code: -32602, message: 'Unknown debug-log collection' });
    await expect(client.handle({ method: 'vscode/cancelAgentHostDebugLogs', params: {} }))
      .rejects.toMatchObject({ code: -32602, message: 'progressToken must be a string' });

    // The collector itself: a token in use refused, a collection called off by
    // the client that follows it and by nobody else, and one whose client went.
    const logs = debugLogs({ tmp: dir, lease: 60_000 });
    const files = [{ path: 'agenthost/daemon.log', from: join(dir, 'daemon.log') }];
    const follow = (token: string, owner: string) => ({ token, owner, report: () => {} });
    const going = logs.collect(files, 'archive', follow('p2', 'window'));
    await expect(logs.collect(files, 'archive', follow('p2', 'window'))).rejects.toMatchObject({ code: -32602, message: 'progressToken is already in use' });
    expect(logs.cancel('p2', 'another')).toBe(false);
    expect(logs.cancel('p2', 'window')).toBe(true);
    await expect(going).rejects.toMatchObject({ message: 'Canceled' });
    expect(logs.cancel('p2', 'window')).toBe(false);
    const left = logs.collect(files, 'archive', follow('p3', 'window'));
    logs.abandon('window');
    await expect(left).rejects.toMatchObject({ message: 'Canceled' });
    await logs.close();
  });

  /*
   * VS Code's report: the first account a provider is signed in as, each
   * endpoint once by URL, and the version its product has, none made up.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostProviderService.ts#L199-L233
   */
  it('reports the account a backend is signed in as, each endpoint once, and no version it was not given', async () => {
    const dir = scratch();
    const { client } = await serving(dir, {
      endpoints: () => [{ name: 'Echo', url: 'http://127.0.0.1:1/' }, { name: 'Echo again', url: 'http://127.0.0.1:1' }],
      probe: async () => ({ models: [], commands: [], customizations: [], account: { status: 'signedIn', email: 'me@example.com' } }),
    })();
    await new Promise((r) => { setTimeout(r, 20); });
    const info = await client.handle({ method: 'getNetworkDiagnosticsInfo', params: {} }) as Record<string, unknown>;
    expect(info).not.toHaveProperty('version');
    expect(info.account).toBe('me@example.com');
    expect(info.endpoints).toEqual([{ name: 'Echo', url: 'http://127.0.0.1:1/' }]);
  });

  /*
   * VS Code's probe reports the proxy it goes through, and a URL that does not
   * parse fails the request.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/networkDiagnosticsService.ts#L106-L155
   */
  it('reports the proxy a probe goes through, none for a host NO_PROXY names, and fails a URL that does not parse', async () => {
    const dir = scratch();
    const { client } = await serving(dir)();
    const kept = { use: process.env.NODE_USE_ENV_PROXY, http: process.env.http_proxy, no: process.env.no_proxy };
    process.env.NODE_USE_ENV_PROXY = '1';
    process.env.http_proxy = 'http://127.0.0.1:2';
    process.env.no_proxy = 'localhost,.internal:8080';
    try {
      const through = await client.handle({ method: 'diagnosticsFetch', params: { url: 'http://127.0.0.1:1/' } }) as Record<string, unknown>;
      expect(through.proxyUrl).toBe('http://127.0.0.1:2');
      const direct = await client.handle({ method: 'diagnosticsFetch', params: { url: 'http://localhost:1/' } }) as Record<string, unknown>;
      expect(direct).not.toHaveProperty('proxyUrl');
      const named = await client.handle({ method: 'diagnosticsFetch', params: { url: 'http://a.internal:8080/' } }) as Record<string, unknown>;
      expect(named).not.toHaveProperty('proxyUrl');
    }
    finally {
      for (const [key, value] of [['NODE_USE_ENV_PROXY', kept.use], ['http_proxy', kept.http], ['no_proxy', kept.no]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    // Thrown as it is, which the wire answers as an internal error.
    await expect(client.handle({ method: 'diagnosticsFetch', params: { url: 'not a url' } })).rejects.toMatchObject({ name: 'TypeError', message: 'Invalid URL' });
  });

  it('describes the network from here, and probes one endpoint', async () => {
    const dir = scratch();
    const { client, said } = await serving(dir, { endpoints: () => [{ name: 'Echo', url: 'http://127.0.0.1:1/', expectedStatus: 200 }] }, { version: '9.9.9' })();
    expect(said.serverInfo.version).toBe('9.9.9');
    const info = await client.handle({ method: 'getNetworkDiagnosticsInfo', params: {} }) as Record<string, unknown>;
    expect(info.version).toBe('9.9.9');
    expect(info.os).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
    expect(info.proxySettings).toEqual({});
    expect(info.endpoints).toEqual([{ name: 'Echo', url: 'http://127.0.0.1:1/', expectedStatus: 200 }]);
    expect(await client.handle({ method: 'getManagedSettingsDiagnostics', params: {} })).toEqual([]);
    // Port 1 on loopback answers nobody: the lookup succeeds, the probe says why it failed, and both are timed.
    const probe = await client.handle({ method: 'diagnosticsFetch', params: { url: 'http://127.0.0.1:1/' } }) as Record<string, unknown>;
    expect(probe.url).toBe('http://127.0.0.1:1/');
    expect((probe.dnsIpv4 as { address?: string }).address).toBe('127.0.0.1');
    expect(typeof probe.error).toBe('string');
    expect(typeof probe.durationMs).toBe('number');
    expect(probe.statusCode).toBeUndefined();
  });

  /*
   * VS Code's shutdown: the providers shut down, then the answer, the host
   * process and its connection left running.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L16018-L16051
   */
  it('stops its backends when told, answers once they have stopped, and keeps the connection', async () => {
    const dir = scratch();
    const stopped: string[] = [];
    const { client } = await serving(dir, {
      create: (start) => {
        const session = echo({ path: dir, pace: 0 }).create(start);
        return { ...session, close: (why) => { stopped.push(String(why)); return session.close(why); } };
      },
    })();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    expect(await client.handle({ method: 'shutdown', params: {} })).toEqual({});
    expect(stopped).toEqual(['stopping']);
    // The connection still answers, and the closed host starts nothing new.
    expect(await client.handle({ method: 'getManagedSettingsDiagnostics', params: {} })).toEqual([]);
    await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/two', provider: 'echo' } }))
      .rejects.toMatchObject({ message: 'This host is closing, so nothing new starts on it' });
  });
});

describe('where Claude keeps a session', () => {
  it('finds the transcript under the CLI\'s spelling of the directory, or under any project it moved from', () => {
    const dir = scratch();
    const held = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = join(dir, 'config');
    try {
      const project = join(dir, 'work_here');
      mkdirSync(project);
      const spelled = project.replace(/[^A-Za-z0-9]/g, '-');
      mkdirSync(join(dir, 'config', 'projects', spelled), { recursive: true });
      mkdirSync(join(dir, 'config', 'projects', '-elsewhere'), { recursive: true });
      writeFileSync(join(dir, 'config', 'projects', spelled, 'aaa.jsonl'), '');
      writeFileSync(join(dir, 'config', 'projects', '-elsewhere', 'bbb.jsonl'), '');
      const agent = claude({ paths: [project] });
      expect(agent.stateFile?.('aaa', project)).toBe(join(dir, 'config', 'projects', spelled, 'aaa.jsonl'));
      expect(agent.stateFile?.('bbb', project)).toBe(join(dir, 'config', 'projects', '-elsewhere', 'bbb.jsonl'));
      expect(agent.stateFile?.('ccc', project)).toBeUndefined();
      // An id is a name, not a path.
      expect(agent.stateFile?.('../x', project)).toBeUndefined();
      expect(agent.endpoints?.()[0]).toMatchObject({ name: 'Anthropic API', expectedStatus: 401 });
    }
    finally {
      if (held === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = held;
    }
  });
});

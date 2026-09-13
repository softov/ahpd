import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { debugLogs } from '../packages/sdk/src/debuglogs.js';
import { crc32, zip } from '../packages/sdk/src/zip.js';
import { echo } from '../examples/echo/agent.js';
import { claude } from '../packages/agent-claude/src/claude.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

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
      { path: 'events.jsonl', from: join(dir, 'events.jsonl'), provider: true },
    ], 'archive');
    expect(got.kind).toBe('archive');
    expect(got.providerLogsIncluded).toBe(true);
    expect(got.entries).toEqual([{ path: 'agenthost/daemon.log', size: 8 }, { path: 'events.jsonl', size: 3000 }]);
    expect(got.uncompressedSize).toBe(3008);
    expect(got.resource.startsWith('file://')).toBe(true);
    const archive = got.resource.slice('file://'.length);
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
    await expect(logs.read(`file://${join(dir, 'daemon.log')}`, 0)).rejects.toThrow('Unknown or expired');
    await expect(logs.read(got.resource, -1)).rejects.toThrow('Invalid debug-log artifact position');
    // A directory stays where it is, and goes when the collector lets go.
    const opened = await logs.collect([{ path: 'agenthost/daemon.log', from: join(dir, 'daemon.log') }], 'directory');
    expect(opened.kind).toBe('directory');
    expect(readFileSync(join(opened.resource.slice('file://'.length), 'agenthost', 'daemon.log'), 'utf8')).toBe('started\n');
    expect(opened.providerLogsIncluded).toBe(false);
    await logs.close();
    expect(() => statSync(archive)).toThrow();
    expect(() => statSync(opened.resource.slice('file://'.length))).toThrow();
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
    expect(await join_.client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/one' } })).toEqual({ resource: `file://${join(dir, 'one.jsonl')}` });
    expect(await join_.client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/one', chat: state.defaultChat } })).toEqual({ resource: `file://${join(dir, 'one.jsonl')}` });
    expect(asked.at(-1)).toEqual({ id: 'one', directory: dir });
    await expect(join_.client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/one', chat: 'ahp-chat://x/nobody' } }))
      .rejects.toMatchObject({ code: -32602, message: 'chat must belong to the requested Agent Session' });
    await join_.client.handle({ method: 'createSession', params: { channel: 'ahp-session:/none', provider: 'echo' } });
    expect(await join_.client.handle({ method: 'vscode/getAgentHostSessionStateFile', params: { session: 'ahp-session:/none' } })).toEqual({});
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
    expect(got.entries.map((one) => one.path)).toEqual(['agenthost/daemon.log', 'events.jsonl']);
    expect(got.providerLogsIncluded).toBe(true);
    const chunk = await client.handle({ method: 'vscode/readAgentHostDebugLogsChunk', params: { resource: got.resource, position: 0 } }) as { data: string; eof: boolean };
    expect(chunk.eof).toBe(true);
    expect(Buffer.from(chunk.data, 'base64').readUInt32LE(0)).toBe(0x04034b50);
    rmSync(got.resource.slice('file://'.length), { force: true });
    // Without a session, the host's own and nothing of any backend's.
    const own = await client.handle({ method: 'vscode/collectAgentHostDebugLogs', params: { kind: 'directory' } }) as { entries: { path: string }[]; providerLogsIncluded: boolean; resource: string };
    expect(own.entries.map((one) => one.path)).toEqual(['agenthost/daemon.log']);
    expect(own.providerLogsIncluded).toBe(false);
    rmSync(own.resource.slice('file://'.length), { recursive: true, force: true });
    await expect(client.handle({ method: 'vscode/collectAgentHostDebugLogs', params: { kind: 'tarball' } })).rejects.toMatchObject({ code: -32602 });
    await expect(client.handle({ method: 'vscode/readAgentHostDebugLogsChunk', params: { resource: `file://${join(dir, 'daemon.log')}`, position: 0 } })).rejects.toMatchObject({ code: -32602 });
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
    await expect(client.handle({ method: 'diagnosticsFetch', params: { url: 'not a url' } })).rejects.toMatchObject({ code: -32602 });
  });

  it('stops when told, and only where the host was given a way to', async () => {
    const dir = scratch();
    const { client: cannot } = await serving(dir)();
    await expect(cannot.handle({ method: 'shutdown', params: {} })).rejects.toMatchObject({ code: -32601 });
    let stopped = 0;
    const { client } = await serving(dir, {}, { shutdown: () => { stopped += 1; } })();
    // Answered before it stops, so the window hears yes rather than a dropped socket.
    expect(await client.handle({ method: 'shutdown', params: {} })).toEqual({});
    expect(stopped).toBe(0);
    await new Promise((r) => { setTimeout(r, 20); });
    expect(stopped).toBe(1);
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

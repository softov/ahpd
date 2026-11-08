import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { protectedResource, serversFor, urlOf } from '../src/mcp.js';

/*
 * A server's sign-in metadata, found as VS Code finds it: the path-appended
 * well-known URL, then the origin's, each taken only where its `resource` is
 * the one asked for.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/oauth.ts#L1201-L1290
 */
describe('the metadata a server publishes about signing in', () => {
  /** A server answering the well-known paths it is given, and nothing else. */
  const serving = async (answers: (origin: string) => Record<string, unknown>): Promise<{ origin: string; close: () => Promise<void> }> => {
    let held: Record<string, unknown> = {};
    const server = createServer((request, response) => {
      const body = held[request.url ?? ''];
      response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
      response.end(body === undefined ? '' : JSON.stringify(body));
    });
    await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done); });
    const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    held = answers(origin);
    return { origin, close: () => new Promise((done) => { server.close(() => { done(); }); }) };
  };

  it('falls back to the origin\'s metadata, and takes it only where its resource is the origin', async () => {
    const good = await serving((origin) => ({
      '/.well-known/oauth-protected-resource': { resource: `${origin}/`, authorization_servers: ['https://auth.example'] },
    }));
    const bad = await serving(() => ({
      '/.well-known/oauth-protected-resource': { resource: 'https://elsewhere.example/', authorization_servers: [] },
    }));
    try {
      // The origin's own, since nothing answers at the path-appended URL.
      expect(await protectedResource(`${good.origin}/mcp`, 'docs')).toMatchObject({ authorization_servers: ['https://auth.example'] });
      // A resource that is not the one asked for is taken as no answer.
      expect(await protectedResource(`${bad.origin}/mcp`, 'docs')).toEqual({ resource: `${bad.origin}/mcp`, resource_name: 'docs' });
    }
    finally {
      await good.close();
      await bad.close();
    }
  });
});

/*
 * The MCP servers a session declares.
 *
 * This host normally leaves MCP configuration to the CLI. It reads the same
 * files for one reason: `setMcpServers` re-declares only servers the SDK was
 * given, so a server that came from a settings file is one a token can never
 * be applied to. Owning the declaration is what makes signing in possible.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const project = (servers: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-mcp-'));
  made.push(dir);
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: servers }));
  return dir;
};

/** A folder the host vouched for, which is what makes its file one to read. */
const vouched = (): boolean => true;

describe('the servers a session declares', () => {
  it('reads the project file the CLI reads', () => {
    const dir = project({ gmail: { type: 'http', url: 'https://mcp.example.com/gmail' } });
    const found = serversFor([dir], vouched);
    expect(Object.keys(found)).toContain('gmail');
    expect(urlOf(found.gmail)).toBe('https://mcp.example.com/gmail');
  });

  it('reads nothing from a folder the host did not vouch for', () => {
    const dir = project({ gmail: { type: 'http', url: 'https://mcp.example.com/gmail' } });
    // Asserted against the home file rather than against its absence: this
    // host has a `~/.claude.json` of its own, and the point is that the
    // project's file adds nothing to it. A `.mcp.json` names servers this
    // host would start as commands.
    expect(serversFor([dir], () => false)).toEqual(serversFor([]));
    // And an absent answer is the host having said nothing, which is the same.
    expect(serversFor([dir])).toEqual(serversFor([]));
  });

  it('says nothing about a directory with no file, rather than failing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-bare-'));
    made.push(dir);
    /*
     * A missing, unreadable or malformed file contributes nothing.
     *
     * Compared against the home file rather than against an empty object:
     * whoever runs this has their own `~/.claude.json`, and the point is that
     * this directory adds nothing to it. The CLI reads the same files either
     * way, so a server this misses works exactly as it did before.
     */
    const home = serversFor([], vouched);
    expect(serversFor([dir], vouched)).toEqual(home);
    writeFileSync(join(dir, '.mcp.json'), 'not json at all');
    expect(serversFor([dir], vouched)).toEqual(home);
  });

  it('knows which servers can be signed into over the network', () => {
    // A URL is what makes a protected resource identifiable, and a stdio
    // server has none - so it stays an error rather than becoming a sign-in
    // a client cannot complete.
    expect(urlOf({ type: 'stdio', command: 'gmail-mcp' })).toBeUndefined();
    expect(urlOf({ type: 'sse', url: 'https://mcp.example.com/e' })).toBe('https://mcp.example.com/e');
    // `http` is the default when a config names a URL and no type.
    expect(urlOf({ url: 'https://mcp.example.com/x' })).toBe('https://mcp.example.com/x');
  });

  it('lets a nearer file win, which is the order the CLI resolves them in', () => {
    const dir = project({ shared: { type: 'http', url: 'https://project/one' } });
    const found = serversFor([dir], vouched);
    expect(urlOf(found.shared)).toBe('https://project/one');
  });

  /*
   * The CLI's scopes for one folder: local over project over user, the local
   * servers kept in the home file under the folder's path.
   * https://code.claude.com/docs/en/mcp#scope-hierarchy-and-precedence
   */
  it('reads a folder\'s local-scope servers from the home file, above the project\'s and the user\'s', () => {
    const dir = project({ shared: { type: 'http', url: 'https://project/one' } });
    const home = mkdtempSync(join(tmpdir(), 'ahpd-home-'));
    made.push(home);
    writeFileSync(join(home, '.claude.json'), JSON.stringify({
      mcpServers: { shared: { type: 'http', url: 'https://user/one' }, mine: { type: 'http', url: 'https://user/mine' } },
      projects: { [dir]: { mcpServers: { shared: { type: 'http', url: 'https://local/one' }, notes: { type: 'http', url: 'https://local/notes' } } } },
    }));
    const before = process.env.HOME;
    process.env.HOME = home;
    try {
      const found = serversFor([dir], vouched);
      expect(urlOf(found.shared)).toBe('https://local/one');
      expect(urlOf(found.notes)).toBe('https://local/notes');
      expect(urlOf(found.mine)).toBe('https://user/mine');
      // The person's own, read for a folder nobody vouched for as well.
      expect(urlOf(serversFor([dir], () => false).notes)).toBe('https://local/notes');
    }
    finally {
      if (before === undefined) delete process.env.HOME;
      else process.env.HOME = before;
    }
  });
});

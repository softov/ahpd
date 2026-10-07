import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serversFor, urlOf } from '../src/mcp.js';

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
});

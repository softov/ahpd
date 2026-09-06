/** The MCP servers a session runs with, read from the files the CLI reads. */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Bag } from '@ahpd/server';

/**
 * Every MCP server configured for a directory, by name.
 *
 * The CLI finds these itself and this host normally leaves it to. It reads
 * them here for one reason: a server the *SDK* was given is one
 * `setMcpServers` can re-declare, and a server that came from a settings file
 * is not - so a token a client signs in with has nowhere to go unless this
 * host owns the declaration. The files are the CLI's own: `.mcp.json` beside
 * the project, and `mcpServers` in `~/.claude.json`.
 *
 * A file that is missing, unreadable or not JSON contributes nothing. This is
 * a best effort by design: the CLI still reads the same files, and a server
 * this misses is a server that works exactly as it did before.
 */
export function serversFor(directories: string[]): Record<string, Bag> {
  const found: Record<string, Bag> = {};
  const files = [
    join(homedir(), '.claude.json'),
    ...directories.map((dir) => join(dir, '.mcp.json')),
  ];
  for (const file of files) {
    let held: unknown;
    // Synchronous on purpose: these are two small files read once when a
    // session is created, and a backend's `create` answers with a session
    // rather than a promise of one.
    try { held = JSON.parse(readFileSync(file, 'utf8')) as unknown; }
    catch { continue; }
    const bag = typeof held === 'object' && held !== null ? held as Bag : {};
    const servers = typeof bag.mcpServers === 'object' && bag.mcpServers !== null ? bag.mcpServers as Bag : {};
    for (const [name, config] of Object.entries(servers)) {
      // Later wins: a project's own `.mcp.json` is nearer than the home file,
      // which is the order the CLI resolves them in.
      if (typeof config === 'object' && config !== null) found[name] = config as Bag;
    }
  }
  return found;
}

/** The URL an http or sse server lives at, or nothing for a stdio one. */
export const urlOf = (config: unknown): string | undefined => {
  const bag = typeof config === 'object' && config !== null ? config as Bag : {};
  const url = typeof bag.url === 'string' ? bag.url : undefined;
  if (url === undefined) return undefined;
  const kind = typeof bag.type === 'string' ? bag.type : 'http';
  return kind === 'http' || kind === 'sse' ? url : undefined;
};

/**
 * What an MCP server says about signing into it, per RFC 9728.
 *
 * `<url>/.well-known/oauth-protected-resource`, which is where an OAuth
 * protected resource publishes its metadata and where a client looks to find
 * the authorization server. Answers the discovered document, or a bare one
 * naming the server itself: the URL *is* the canonical resource identifier,
 * so an incomplete answer is still a true one - what a client loses is the
 * one-click sign-in, not the knowledge that it needs to sign in.
 */
export async function protectedResource(url: string, name: string, ms = 15_000): Promise<Bag> {
  const bare: Bag = { resource: url, resource_name: name };
  const found = new URL(url);
  const at = `${found.origin}/.well-known/oauth-protected-resource${found.pathname.replace(/\/+$/, '')}`;
  const said = await fetch(at, { signal: AbortSignal.timeout(ms) })
    .then((answer) => (answer.ok ? answer.json() as Promise<unknown> : undefined))
    .catch(() => undefined);
  if (typeof said !== 'object' || said === null) return bare;
  const metadata = said as Bag;
  return typeof metadata.resource === 'string' ? metadata : bare;
}

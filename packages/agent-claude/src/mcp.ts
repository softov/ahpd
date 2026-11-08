/** The MCP servers a session runs with: the host's, and the ones in the files the CLI reads. */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Bag, McpServer } from '@ahpd/sdk';

/**
 * The servers the host offers a session, in the shape the SDK takes, for a
 * session that runs in `folder`.
 *
 * Every session is offered the host's servers whatever agent it runs, the
 * ones a client plugin contributes among them, which the CLI does not find in
 * the plugin itself because it is told to skip them there. An HTTP server goes
 * as it is. A stdio server goes without its directory, which the SDK has no
 * field for: the CLI starts it in the session's own folder, so one whose
 * directory is another folder is left out and said, as the reference leaves
 * out a server whose directory it cannot represent: VS Code's Claude's
 * `toClaudeMcpServers`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkOptions.ts#L235-L266
 */
export function toClaudeMcpServers(
  servers: Record<string, McpServer> | undefined,
  folder: string,
  say?: (line: string) => void,
): Record<string, Bag> {
  const taken: Record<string, Bag> = {};
  for (const [name, one] of Object.entries(servers ?? {})) {
    if (one.type === 'http') {
      taken[name] = { type: 'http', url: one.url, ...(one.headers === undefined ? {} : { headers: { ...one.headers } }) };
      continue;
    }
    const named = one.cwd === '~' ? homedir() : one.cwd?.startsWith('~/') === true ? join(homedir(), one.cwd.slice(2)) : one.cwd;
    const where = named === undefined ? undefined : resolve(folder, named);
    if (where !== undefined && where !== resolve(folder)) {
      say?.(`${name}: the CLI starts a stdio MCP server in the session's folder, so one that starts in ${one.cwd} was left out`);
      continue;
    }
    taken[name] = {
      type: 'stdio',
      command: one.command,
      ...(one.args === undefined ? {} : { args: [...one.args] }),
      ...(one.env === undefined ? {} : { env: { ...one.env } }),
    };
  }
  return taken;
}

/**
 * Every MCP server configured for a directory, by name.
 *
 * The CLI finds these itself and this host normally leaves it to. It reads
 * them here for one reason: a server the *SDK* was given is one
 * `setMcpServers` can re-declare, and a server that came from a settings file
 * is not - so a token a client signs in with has nowhere to go unless this
 * host owns the declaration. The files are the CLI's own: `.mcp.json` beside
 * the project, and `~/.claude.json`, its `mcpServers` and those under the
 * folder's path.
 *
 * A file that is missing, unreadable or not JSON contributes nothing. This is
 * a best effort by design: the CLI still reads the same files, and a server
 * this misses is a server that works exactly as it did before.
 *
 * `trusted` is the host's answer about a folder, and the project's file is read
 * only where it says yes. A `.mcp.json` names servers this host starts as
 * commands, so a folder nobody vouched for contributes none of them - and an
 * absent `trusted` is the host having said nothing, which is the same answer. The home file
 * is the person's own rather than a project's and is read either way: its
 * top-level servers, the CLI's user scope, and the servers it keeps under each
 * folder's path, the CLI's local scope.
 *
 * Every scope the CLI loads for the folder, in its precedence: local over
 * project over user, a server of one name taken whole from the highest.
 * https://code.claude.com/docs/en/mcp#scope-hierarchy-and-precedence
 */
export function serversFor(directories: string[], trusted?: (folder: string) => boolean): Record<string, Bag> {
  // Synchronous on purpose: these are small files read once when a session
  // is created.
  const read = (file: string): Bag => {
    try {
      const held = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      return typeof held === 'object' && held !== null ? held as Bag : {};
    }
    catch { return {}; }
  };
  const serversOf = (holder: unknown): Bag => {
    const servers = typeof holder === 'object' && holder !== null ? (holder as Bag).mcpServers : undefined;
    return typeof servers === 'object' && servers !== null ? servers as Bag : {};
  };
  const home = read(join(homedir(), '.claude.json'));
  const projects = typeof home.projects === 'object' && home.projects !== null ? home.projects as Bag : {};
  const found: Record<string, Bag> = {};
  // Lowest first, so a nearer scope's server of the same name wins.
  for (const servers of [
    serversOf(home),
    ...directories.filter((dir) => trusted?.(dir) === true).map((dir) => serversOf(read(join(dir, '.mcp.json')))),
    ...directories.map((dir) => serversOf(projects[dir])),
  ]) {
    for (const [name, config] of Object.entries(servers)) {
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
 * Found as VS Code finds it: the well-known path with the server's path
 * appended where the URL has one, then the origin's own, each answer taken
 * only where its `resource` is the one it was asked for (the server's URL for
 * the first, its origin for the second), since RFC 9728 says the two MUST
 * match. Answers the discovered document, or a bare one naming the server
 * itself: the URL is the canonical resource identifier, so an incomplete
 * answer is still a true one, and what a client loses is the one-click
 * sign-in, not the knowledge that it needs to sign in.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/oauth.ts#L1201-L1290
 * https://datatracker.ietf.org/doc/html/rfc9728#PRConfigurationValidation
 */
export async function protectedResource(url: string, name: string, ms = 15_000): Promise<Bag> {
  const bare: Bag = { resource: url, resource_name: name };
  const target = new URL(url);
  const root = `${target.origin}/.well-known/oauth-protected-resource`;
  const fetched = async (at: string, expected: string): Promise<Bag | undefined> => {
    const said = await fetch(at, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ms) })
      .then((answer) => (answer.status === 200 ? answer.json() as Promise<unknown> : undefined))
      .catch(() => undefined);
    if (typeof said !== 'object' || said === null) return undefined;
    const metadata = said as Bag;
    if (typeof metadata.resource !== 'string') return undefined;
    try {
      return new URL(metadata.resource).toString() === new URL(expected).toString() ? metadata : undefined;
    }
    catch {
      return undefined;
    }
  };
  return (target.pathname !== '/' ? await fetched(`${root}${target.pathname}`, url) : undefined)
    ?? await fetched(root, target.origin)
    ?? bare;
}

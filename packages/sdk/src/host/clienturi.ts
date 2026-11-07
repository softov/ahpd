/*
 * A resource on a connected client, as this host addresses it.
 *
 * VS Code's host reaches a client's files under one scheme of its own, whose
 * authority is the client's id and whose path carries the URI as the client
 * knows it:
 *
 *   vscode-agent-client://<clientId>/<originalScheme>/<originalAuthority>/<originalPath>
 *
 * `file:///Users/me/notes.md` on client `editor` is
 * `vscode-agent-client://editor/file/-/Users/me/notes.md`, an empty authority
 * written `-`. An opaque path, one with no leading `/` such as
 * `untitled:Untitled-1`, is marked by a `!` after its scheme, which no scheme
 * name can contain, and given a `/` the decoder takes off again.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentClientUri.ts#L8-L97
 */

/** The scheme a client's resource is addressed under here. */
export const AGENT_CLIENT_SCHEME = 'vscode-agent-client';

/** A URI's parts, as the WHATWG parser reads them, with its authority whole. */
const partsOf = (uri: string): { scheme: string; authority: string; path: string; query: string; fragment: string } | undefined => {
  if (!URL.canParse(uri)) return undefined;
  const url = new URL(uri);
  const user = url.username === '' ? '' : `${url.username}${url.password === '' ? '' : `:${url.password}`}@`;
  return { scheme: url.protocol.slice(0, -1), authority: `${user}${url.host}`, path: url.pathname, query: url.search, fragment: url.hash };
};

/** A URI as the client knows it, addressed on that client. */
export const toAgentClientUri = (original: string, clientId: string): string => {
  const parts = partsOf(original);
  if (parts === undefined) return original;
  const opaque = parts.path.length > 0 && !parts.path.startsWith('/');
  const slot = opaque ? `${parts.scheme}!` : parts.scheme;
  const body = opaque ? `/${parts.path}` : parts.path;
  return `${AGENT_CLIENT_SCHEME}://${clientId}/${slot}/${parts.authority === '' ? '-' : parts.authority}${body}${parts.query}${parts.fragment}`;
};

/**
 * The client a URI under the client scheme names and the URI as that client
 * knows it, or nothing for any other URI.
 */
export const fromAgentClientUri = (uri: string): { client: string; original: string } | undefined => {
  const parts = partsOf(uri);
  if (parts === undefined || parts.scheme !== AGENT_CLIENT_SCHEME || parts.authority === '') return undefined;
  const tail = `${parts.query}${parts.fragment}`;
  const { path } = parts;
  const client = decodeURIComponent(parts.authority);
  const schemeEnd = path.indexOf('/', 1);
  if (schemeEnd === -1) return { client, original: `file://${path}${tail}` };
  const marked = path.substring(1, schemeEnd);
  const opaque = marked.endsWith('!');
  const scheme = opaque ? marked.slice(0, -1) : marked;
  const authorityEnd = path.indexOf('/', schemeEnd + 1);
  const written = authorityEnd === -1 ? path.substring(schemeEnd + 1) : path.substring(schemeEnd + 1, authorityEnd);
  const authority = written === '-' ? '' : written;
  const rest = authorityEnd === -1 ? '/' : path.substring(authorityEnd);
  const originalPath = opaque ? rest.substring(1) : rest;
  // As VS Code's URI writes one back: `//` before an authority, and always for `file:`.
  const slashes = authority !== '' || scheme === 'file' ? `//${authority}` : '';
  return { client, original: `${scheme}:${slashes}${originalPath}${tail}` };
};

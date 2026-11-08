/**
 * The URL normalization VS Code's URL approval compares a URL and a pattern
 * under: a URL whose authority names a host and no user, its host lowercased,
 * and a pattern serialized so the matcher reads its escapes as written.
 *
 * Vendored from VS Code's `trustedDomains.ts`: the functions the vendored URL
 * approval here reaches, as VS Code has them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/url/common/trustedDomains.ts#L43-L104
 */

import { matchesSomeScheme, Schemas } from './network.js';
import { URI } from './uri.js';
import { decodeUnreservedURLPathCharacters, normalizeURLPathSeparators } from './urlglob.js';

/**
 * Returns whether a URL has an authority that can be safely used for trust decisions.
 */
export function isURLSafeForTrust(url: URI): boolean {
  return url.authority.length > 0 && !hasURLUserInformation(url);
}

/**
 * Returns whether a URL authority contains user information.
 */
export function hasURLUserInformation(url: URI): boolean {
  return url.authority.includes('@');
}

/**
 * Normalizes a URL for trust comparisons without decoding reserved path escapes.
 */
export function normalizeURLForTrust(url: URI): URI {
  const parsed = normalizeURLPathSeparators(url);
  const hostOffset = parsed.authority.indexOf('@') + 1;
  const authority = parsed.authority.slice(0, hostOffset) + parsed.authority.slice(hostOffset).toLowerCase();
  let path = parsed.path;
  if (authority === 'github.com') {
    path = matchesSomeScheme(parsed, Schemas.http, Schemas.https) ? lowercaseURLPath(path) : path.toLowerCase();
  }
  return parsed.with({ authority, path });
}

function lowercaseURLPath(path: string): string {
  const unreserved = decodeUnreservedURLPathCharacters(path);
  if (!/%[89a-f][0-9a-f]/i.test(unreserved)) {
    return unreserved.toLowerCase();
  }
  // Decode Unicode through URI's graceful decoder without reinterpreting ASCII escape sequences.
  const protectedPath = unreserved.replace(/%[0-7][0-9a-f]/gi, sequence => `%25${sequence.slice(1)}`);
  return URI.parse(`${Schemas.https}://url.invalid${protectedPath}`).path.toLowerCase();
}

/** Serializes a normalized pattern without losing literal escapes when the matcher parses it again. */
export function serializeURLPattern(url: URI): string {
  return url.with({
    authority: url.authority.replace(/%/g, '%25'),
    path: url.path.replace(/%/g, '%25'),
  }).toString(true);
}

/** Normalizes configured patterns while preserving scheme-less glob applicability. */
export function normalizeURLPattern(pattern: string): string {
  const hasScheme = /^[^./:]*:\/\//.test(pattern);
  const prefix = `${Schemas.https}://`;
  const normalized = serializeURLPattern(normalizeURLForTrust(URI.parse(hasScheme ? pattern : prefix + pattern)));
  return hasScheme ? normalized : normalized.slice(prefix.length);
}

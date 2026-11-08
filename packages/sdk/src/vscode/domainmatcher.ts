/**
 * How VS Code's network filter reads a domain and matches it against a domain
 * pattern: by the host alone, its user information, port and path set aside.
 *
 * Vendored from VS Code's `domainMatcher.ts`: the normalizers, the pattern
 * matcher and the domain read from a URI, as VS Code has them. Its decision
 * over an allow list and a deny list (`isDomainAllowed`) is left out, since
 * the managed rules here are read rule by rule. The adaptation is this
 * package's: a named group read from a match is typed as what VS Code reads
 * it as.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/networkFilter/common/domainMatcher.ts#L8-L241
 */

import { URI } from './uri.js';

/**
 * Common file extensions that are unlikely to be network domains.
 * Used to filter false positives when extracting domains from freeform text.
 */
const fileExtensionSuffixes = new Set([
  '7z', 'bz2', 'cjs', 'class', 'cpp', 'cs', 'css', 'csv', 'dll', 'exe', 'gif', 'gz', 'ico', 'jar',
  'env', 'java', 'jpeg', 'jpg', 'js', 'json', 'jsx', 'lock', 'log', 'md', 'mjs', 'pdf', 'php', 'png',
  'py', 'rar', 'rs', 'so', 'sql', 'svg', 'tar', 'tgz', 'toml', 'ts', 'tsx', 'txt', 'wasm', 'webp',
  'xml', 'yaml', 'yml', 'zip'
]);

/**
 * Bare host detection is a heuristic used only to prompt before running commands that appear to access the network.
 * Keep this list intentionally conservative and focused on TLDs commonly used for coding-related hosts and services.
 */
const wellKnownDomainSuffixes = new Set([
  'ai', 'cloud', 'com', 'dev', 'io', 'me', 'net', 'org', 'tech'
]);

/**
 * Normalizes and validates a domain string.
 *
 * Strips user info, port, trailing dots, and trailing punctuation.
 * Accepts bare wildcards (`*`) and wildcard prefixes (`*.example.com`).
 *
 * @param value The raw domain string to normalize.
 * @param fromUrl Whether the value was extracted from a URL context (skips file-extension filtering).
 * @returns The normalized domain string, or `undefined` if the input is invalid.
 */
export function normalizeDomain(value: string | undefined, fromUrl: boolean = false): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/^[^@]+@/, '').replace(/:\d+$/, '').replace(/\.+$/, '');
  if (!normalized || normalized.includes('/') || normalized === '.' || normalized === '..') {
    return undefined;
  }

  // Allow a bare wildcard pattern early, before hostname validation.
  if (normalized === '*') {
    return '*';
  }

  if (!/^\*?\.?[a-z0-9.;,)!?:-]+$/.test(normalized)) {
    return undefined;
  }

  // Strip common trailing punctuation that may follow a domain in text, e.g. "example.com,".
  const stripped = normalized.replace(/[),;:!?]+$/, '');
  if (!stripped) {
    return undefined;
  }

  const domainToValidate = stripped.startsWith('*.') ? stripped.slice(2) : stripped;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))*$/.test(domainToValidate)) {
    return undefined;
  }

  // Support wildcard domain patterns like "*.example.com".
  const hasWildcardPrefix = stripped.startsWith('*.');
  const host = hasWildcardPrefix ? stripped.slice(2) : stripped;
  if (!host) {
    return undefined;
  }

  // Validate that the host part only contains valid hostname characters.
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return undefined;
  }

  // Disallow patterns that look like file names with common extensions, as these are unlikely
  // to be intended as network domains and may be false positives from the regex.
  if (!fromUrl) {
    const lastLabel = host.slice(host.lastIndexOf('.') + 1);
    if (fileExtensionSuffixes.has(lastLabel)) {
      return undefined;
    }
    if (!wellKnownDomainSuffixes.has(lastLabel)) {
      return undefined;
    }
  }

  return hasWildcardPrefix ? `*.${host}` : host;
}

function normalizeUriAuthority(authority: string | undefined): string | undefined {
  if (!authority || /[/?#\\]/.test(authority)) {
    return undefined;
  }

  let hostname: string;
  try {
    const url = new URL(`http://${authority}`);
    if (hasHostLikeCredentials(url)) {
      return undefined;
    }
    hostname = url.hostname.toLowerCase();
  } catch {
    return undefined;
  }

  if (hostname.startsWith('[')) {
    return hostname.endsWith(']') ? hostname : undefined;
  }

  return normalizeDomain(hostname, true);
}

function hasHostLikeCredentials(url: URL): boolean {
  return [url.username, url.password].some(value => {
    if (!value) {
      return false;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(value).toLowerCase();
    } catch {
      return true;
    }

    if (decoded.includes('@')) {
      return false;
    }

    return (decoded.includes('.') && normalizeDomain(decoded, true) !== undefined)
      || normalizeBareIpv6(decoded) !== undefined;
  });
}

function normalizeBareIpv6(value: string): string | undefined {
  if (!value.includes(':') || /[/?#\\@\[\]]/.test(value)) {
    return undefined;
  }
  return normalizeUriAuthority(`[${value}]`);
}

/**
 * Normalizes an administrator allow/deny pattern to the canonical host form used for matching.
 */
export function normalizeDomainPattern(pattern: string): string | undefined {
  const extractedPattern = extractDomainPattern(pattern);

  if (extractedPattern === '*') {
    return extractedPattern;
  }

  if (extractedPattern.startsWith('*.')) {
    const normalizedSuffix = normalizeUriAuthority(extractedPattern.slice(2));
    const normalizedPattern = normalizeDomain(normalizedSuffix ? `*.${normalizedSuffix}` : extractedPattern, true);
    if (!normalizedPattern) {
      return undefined;
    }
    const suffix = normalizedPattern.slice(2);
    return `*.${normalizeUriAuthority(suffix) ?? suffix}`;
  }

  return normalizeBareIpv6(extractedPattern)
    ?? normalizeUriAuthority(extractedPattern)
    ?? normalizeDomain(extractedPattern, true);
}

function normalizeEmbeddedIpv4(value: string): string | undefined {
  const mappedMatch = /^\[::ffff:(?<high>[0-9a-f]{1,4}):(?<low>[0-9a-f]{1,4})\]$/.exec(value);
  const compatibleMatch = mappedMatch ? undefined : /^\[::(?:(?<high>[0-9a-f]{1,4}):)?(?<low>[0-9a-f]{1,4})\]$/.exec(value);
  const groups = (mappedMatch ?? compatibleMatch)?.groups;
  if (!groups) {
    return undefined;
  }

  const high = Number.parseInt(groups.high ?? '0', 16);
  const low = Number.parseInt(groups.low as string, 16);
  if (compatibleMatch && high === 0 && low <= 1) {
    return undefined;
  }

  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

/**
 * Extracts the domain portion from a pattern string.
 * If the pattern contains `://`, it is parsed as a URI and the authority is returned.
 * Otherwise, the trimmed pattern is returned as-is.
 */
export function extractDomainPattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (trimmed === '*') {
    return trimmed;
  }
  if (!trimmed.includes('://')) {
    return trimmed;
  }
  try {
    return URI.parse(trimmed).authority;
  } catch {
    return trimmed;
  }
}

/**
 * Checks whether a normalized domain matches a given allow/deny pattern.
 * Supports exact matches, bare wildcards (`*`), and wildcard prefixes (`*.example.com`).
 *
 * @param domain A normalized domain (output of {@link normalizeDomain}).
 * @param pattern An allow/deny pattern (may be a bare domain, URL, or wildcard).
 * @returns `true` if the domain matches the pattern.
 */
export function matchesDomainPattern(domain: string, pattern: string): boolean {
  const normalizedPattern = normalizeDomainPattern(pattern);
  if (!normalizedPattern) {
    return false;
  }
  if (normalizedPattern === '*') {
    return true;
  }
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2);
    const normalizedDomain = normalizeEmbeddedIpv4(domain) ?? domain;
    return normalizedDomain === suffix || normalizedDomain.endsWith(`.${suffix}`);
  }
  return (normalizeEmbeddedIpv4(domain) ?? domain) === (normalizeEmbeddedIpv4(normalizedPattern) ?? normalizedPattern);
}

/**
 * Extracts and normalizes a domain from a URI.
 * Separates user information and ports, and canonicalizes IPv6 literals.
 *
 * @param uri The URI to extract the domain from.
 * @returns The normalized domain, or `undefined` if no valid domain could be extracted.
 */
export function extractDomainFromUri(uri: URI): string | undefined {
  return normalizeUriAuthority(uri.authority);
}

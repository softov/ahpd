/**
 * Whether a URL is approved by a map of URL patterns, the test VS Code's agent
 * host reads a `WebFetch` rule's pattern with.
 *
 * Vendored from VS Code's `urlApprovalPatterns.ts`: `isUrlApproved` with the
 * functions it reaches, as VS Code has them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/url/common/urlApprovalPatterns.ts#L10-L31
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/url/common/urlApprovalPatterns.ts#L116-L145
 */

import type { URI } from './uri.js';
import { isURLSafeForTrust, normalizeURLForTrust, normalizeURLPattern } from './trusteddomains.js';
import { testUrlMatchesGlob } from './urlglob.js';

/**
 * Approval settings for a URL pattern
 */
export interface IUrlApprovalSettings {
  approveRequest?: boolean;
  approveResponse?: boolean;
}

function getUrlApprovalValue(settings: boolean | IUrlApprovalSettings, checkRequest: boolean): boolean | undefined {
  if (typeof settings === 'boolean') {
    return settings;
  }
  return checkRequest ? settings.approveRequest : settings.approveResponse;
}

function normalizeSafeURL(url: URI): URI | undefined {
  if (!isURLSafeForTrust(url)) {
    return undefined;
  }
  const normalized = normalizeURLForTrust(url);
  return isURLSafeForTrust(normalized) ? normalized : undefined;
}

/**
 * Checks if a URL matches any approved pattern
 * @param url The URL to check
 * @param approvedUrls Map of approved URL patterns to their settings
 * @param checkRequest Whether to check request approval (true) or response approval (false)
 * @returns true if the URL is approved for the specified action
 */
export function isUrlApproved(
  url: URI,
  approvedUrls: Record<string, boolean | IUrlApprovalSettings>,
  checkRequest: boolean,
): boolean {
  const normalizedUrl = normalizeSafeURL(url);
  if (!normalizedUrl) {
    const settings = approvedUrls['*'];
    return settings === undefined ? false : getUrlApprovalValue(settings, checkRequest) ?? false;
  }

  for (const [pattern, settings] of Object.entries(approvedUrls)) {
    // Check if URL matches this pattern
    if (testUrlMatchesGlob(normalizedUrl, normalizeURLPattern(pattern))) {
      const value = getUrlApprovalValue(settings, checkRequest);
      if (value !== undefined) {
        return value;
      }
    }
  }

  return false;
}

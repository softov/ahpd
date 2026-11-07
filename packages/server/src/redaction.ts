/**
 * What a text a plugin wrote is cleared of before a client reads it.
 *
 * VS Code's agent host clears every text that may reach a person or a log of
 * the credentials a URL carries: the query of an absolute URL, the userinfo of
 * any URL, a signed-URL parameter wherever it stands, also percent-encoded, and
 * a connection token in output it buffered. These are its functions, carried as
 * they are written there
 * (src/vs/platform/agentHost/common/logRedaction.ts L8-L105 and
 * src/vs/platform/agentHost/common/remoteAgentHostBootstrapProgress.ts L16-L19
 * at 6b68d3fe).
 */

/** Query parameters that carry signed-URL credentials (Azure Storage SAS, user delegation keys, response overrides). */
const SIGNED_QUERY_PARAMETERS = ['sig', 'se', 'sp', 'sv', 'skoid', 'sktid', 'skt', 'ske', 'sks', 'skv', 'st', 'sr', 'srt', 'ss', 'spr', 'rscd', 'rsct', 'rscc', 'rsce', 'rscl', 'saoid', 'suoid', 'scid', 'sdd', 'ses'];

const SIGNED_QUERY_PARAMETER_NAMES = new Set(SIGNED_QUERY_PARAMETERS);

/** A signed-URL parameter (key and value) as a whole token anywhere in text, also in a relative URL or outside any URL. */
const SIGNED_PARAMETER = new RegExp(`(^|[^A-Za-z0-9_-])(?:${SIGNED_QUERY_PARAMETERS.join('|')})=[^&#\\s"'<>()]*`, 'gi');
const SIGNED_PARAMETER_TEST = new RegExp(SIGNED_PARAMETER.source, 'i');

/** An absolute URL that has a query or fragment. */
const URL_WITH_QUERY = /\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>()]+[?#][^\s"'<>()]*/gi;

/** The userinfo (`user:password@`) of an absolute URL. */
const URL_USERINFO = /\b(?<scheme>[a-z][a-z0-9+.-]*:\/\/)[^\s/?#@"'<>()]+@/gi;
const URL_USERINFO_TEST = new RegExp(URL_USERINFO.source, 'i');

/** A token (between query, list and quoting delimiters) holding a percent escape: checked in its decoded forms. */
const PERCENT_ENCODED_TOKEN = /[^\s&?#;"'<>()]*%[0-9a-f]{2}[^\s&?#;"'<>()]*/gi;

/** Decoding rounds for nested percent-encoding (`%2573ig` is `%73ig` is `sig`). */
const PERCENT_DECODE_MAX_ROUNDS = 3;

/** `url` (absolute or relative) without its query and fragment; `?<redacted>` marks that one was removed. */
const redactUrlForLog = (url: string): string => {
  const query = url.search(/[?#]/);
  return query < 0 ? url : `${url.slice(0, query)}?<redacted>`;
};

/** `text` and its percent-decoded forms, at most `PERCENT_DECODE_MAX_ROUNDS` rounds, until stable. */
const percentDecodedForms = (text: string): string[] => {
  const forms = [text];
  for (let round = 0; round < PERCENT_DECODE_MAX_ROUNDS; round++) {
    const last = forms[forms.length - 1] as string;
    // Every ASCII percent escape decoded once; malformed or non-ASCII escapes stay as they are.
    const next = last.replace(/%[0-9a-f]{2}/gi, (escape) => {
      const code = parseInt(escape.slice(1), 16);
      return code < 0x80 ? String.fromCharCode(code) : escape;
    });
    if (next === last) break;
    forms.push(next);
  }
  return forms;
};

/** Whether `text` parses as an absolute URL whose query has a signed-URL parameter name. */
const hasSignedSearchParameter = (text: string): boolean => {
  const candidate = text.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate) || !/[?]/.test(candidate)) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  }
  catch {
    return false;
  }
  for (const key of url.searchParams.keys()) {
    if (SIGNED_QUERY_PARAMETER_NAMES.has(key.trim().toLowerCase())) return true;
  }
  return false;
};

/** Whether `text` holds a signed-URL parameter anywhere, also percent-encoded or as a parsed query name. */
const hasSignedUrlParameter = (text: string): boolean =>
  percentDecodedForms(text).some((form) => SIGNED_PARAMETER_TEST.test(form) || hasSignedSearchParameter(form));

/** Whether `text` holds an absolute URL with userinfo, also percent-encoded. */
const hasUrlUserinfo = (text: string): boolean => percentDecodedForms(text).some((form) => URL_USERINFO_TEST.test(form));

/**
 * Free text with the query of every absolute URL and the userinfo of every URL
 * removed, and every remaining signed-URL parameter, or token whose decoded
 * form holds one, replaced by `<redacted>`.
 */
export const redactSecretsInText = (text: string): string => text
  .replace(URL_WITH_QUERY, (match) => redactUrlForLog(match))
  .replace(URL_USERINFO, '$<scheme><redacted>@')
  .replace(SIGNED_PARAMETER, '$1<redacted>')
  .replace(PERCENT_ENCODED_TOKEN, (token) => (hasSignedUrlParameter(token) || hasUrlUserinfo(token) ? '<redacted>' : token));

/** A connection token in output a host buffered, as `?tkn=***`. */
export const redactToken = (text: string): string => text.replace(/\?tkn=[^\s&]+/g, '?tkn=***');

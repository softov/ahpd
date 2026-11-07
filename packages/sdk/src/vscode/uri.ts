/**
 * The URI VS Code's URL approval, its URL globs and its domain matcher parse a
 * URL with, an automation's resource is read with, and a retained terminal
 * link is built and read with.
 *
 * Vendored from VS Code's `uri.ts`: the parse, `from`, the validation, `with`
 * and the printing, with both encoders, as VS Code has them. Its file paths (`file`,
 * `fsPath`, `joinPath`), its test for a URI-like object (`isUri`) and its
 * marshalling (`toJSON`, `revive`) are left out, since nothing here reads a
 * URI as a path, meets a URI it did not make or sends one. The adaptations are
 * this package's: the subclass that caches the encoded form is folded into the
 * class, `substr` is written `substring`, which reads the same from the start
 * and to the end VS Code passes it, and a match read by an index is typed as
 * what VS Code reads it as.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/uri.ts
 */

import { CharCode } from './charcode.js';

const _schemePattern = /^\w[\w\d+.-]*$/;
const _singleSlashStart = /^\//;
const _doubleSlashStart = /^\/\//;

function _validateUri(ret: URI, _strict?: boolean): void {

  // scheme, must be set
  if (!ret.scheme && _strict) {
    throw new Error(`[UriError]: Scheme is missing: {scheme: "", authority: "${ret.authority}", path: "${ret.path}", query: "${ret.query}", fragment: "${ret.fragment}"}`);
  }

  // scheme, https://tools.ietf.org/html/rfc3986#section-3.1
  // ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
  if (ret.scheme && !_schemePattern.test(ret.scheme)) {
    const matches = [...ret.scheme.matchAll(/[^\w\d+.-]/gu)];
    const detail = matches.length > 0
      ? ` Found '${(matches[0] as RegExpMatchArray)[0]}' at index ${(matches[0] as RegExpMatchArray).index} (${matches.length} total)`
      : '';
    throw new Error(`[UriError]: Scheme contains illegal characters.${detail} (len:${ret.scheme.length})`);
  }

  // path, http://tools.ietf.org/html/rfc3986#section-3.3
  // If a URI contains an authority component, then the path component
  // must either be empty or begin with a slash ("/") character.  If a URI
  // does not contain an authority component, then the path cannot begin
  // with two slash characters ("//").
  if (ret.path) {
    if (ret.authority) {
      if (!_singleSlashStart.test(ret.path)) {
        throw new Error('[UriError]: If a URI contains an authority component, then the path component must either be empty or begin with a slash ("/") character');
      }
    } else {
      if (_doubleSlashStart.test(ret.path)) {
        throw new Error('[UriError]: If a URI does not contain an authority component, then the path cannot begin with two slash characters ("//")');
      }
    }
  }
}

// for a while we allowed uris *without* schemes and this is the migration
// for them, e.g. an uri without scheme and without strict-mode warns and falls
// back to the file-scheme. that should cause the least carnage and still be a
// clear warning
function _schemeFix(scheme: string, _strict: boolean): string {
  if (!scheme && !_strict) {
    return 'file';
  }
  return scheme;
}

// implements a bit of https://tools.ietf.org/html/rfc3986#section-5
function _referenceResolution(scheme: string, path: string): string {

  // the slash-character is our 'default base' as we don't
  // support constructing URIs relative to other URIs. This
  // also means that we alter and potentially break paths.
  // see https://tools.ietf.org/html/rfc3986#section-5.1.4
  switch (scheme) {
    case 'https':
    case 'http':
    case 'file':
      if (!path) {
        path = _slash;
      } else if (path[0] !== _slash) {
        path = _slash + path;
      }
      break;
  }
  return path;
}

const _empty = '';
const _slash = '/';
const _regexp = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

/** A URI's parts, as a URI or its components carry them. */
export interface UriComponents {
  scheme: string;
  authority?: string;
  path?: string;
  query?: string;
  fragment?: string;
}

/**
 * Uniform Resource Identifier (URI) http://tools.ietf.org/html/rfc3986.
 *
 *       foo://example.com:8042/over/there?name=ferret#nose
 *       \_/   \______________/\_________/ \_________/ \__/
 *        |           |            |            |        |
 *     scheme     authority       path        query   fragment
 */
export class URI implements UriComponents {

  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  private _formatted: string | null = null;

  protected constructor(scheme: string, authority?: string, path?: string, query?: string, fragment?: string, _strict: boolean = false) {
    this.scheme = _schemeFix(scheme, _strict);
    this.authority = authority || _empty;
    this.path = _referenceResolution(this.scheme, path || _empty);
    this.query = query || _empty;
    this.fragment = fragment || _empty;

    _validateUri(this, _strict);
  }

  // ---- modify to new -------------------------

  with(change: { scheme?: string; authority?: string | null; path?: string | null; query?: string | null; fragment?: string | null }): URI {

    if (!change) {
      return this;
    }

    let { scheme, authority, path, query, fragment } = change;
    if (scheme === undefined) {
      scheme = this.scheme;
    } else if (scheme === null) {
      scheme = _empty;
    }
    if (authority === undefined) {
      authority = this.authority;
    } else if (authority === null) {
      authority = _empty;
    }
    if (path === undefined) {
      path = this.path;
    } else if (path === null) {
      path = _empty;
    }
    if (query === undefined) {
      query = this.query;
    } else if (query === null) {
      query = _empty;
    }
    if (fragment === undefined) {
      fragment = this.fragment;
    } else if (fragment === null) {
      fragment = _empty;
    }

    if (scheme === this.scheme
      && authority === this.authority
      && path === this.path
      && query === this.query
      && fragment === this.fragment) {

      return this;
    }

    return new URI(scheme, authority, path, query, fragment);
  }

  // ---- parse & validate ------------------------

  /**
   * Creates a new URI from a string, e.g. `http://www.example.com/some/path`,
   * `file:///usr/home`, or `scheme:with/path`.
   *
   * @param value A string which represents an URI (see `URI#toString`).
   */
  static parse(value: string, _strict: boolean = false): URI {
    const match = _regexp.exec(value);
    if (!match) {
      return new URI(_empty, _empty, _empty, _empty, _empty);
    }
    return new URI(
      match[2] || _empty,
      percentDecode(match[4] || _empty),
      percentDecode(match[5] || _empty),
      percentDecode(match[7] || _empty),
      percentDecode(match[9] || _empty),
      _strict
    );
  }

  /**
   * Creates new URI from uri components.
   *
   * Unless `strict` is `true` the scheme is defaults to be `file`. This function performs
   * validation and should be used for untrusted uri components retrieved from storage,
   * user input, command arguments etc
   */
  static from(components: UriComponents, strict?: boolean): URI {
    const result = new URI(
      components.scheme,
      components.authority,
      components.path,
      components.query,
      components.fragment,
      strict
    );
    return result;
  }

  // ---- printing/externalize ---------------------------

  /**
   * Creates a string representation for this URI. It's guaranteed that calling
   * `URI.parse` with the result of this function creates an URI which is equal
   * to this URI.
   *
   * @param skipEncoding Do not encode the result, default is `false`
   */
  toString(skipEncoding: boolean = false): string {
    if (!skipEncoding) {
      if (!this._formatted) {
        this._formatted = _asFormatted(this, false);
      }
      return this._formatted;
    } else {
      // we don't cache that
      return _asFormatted(this, true);
    }
  }
}

// reserved characters: https://tools.ietf.org/html/rfc3986#section-2.2
const encodeTable: { [ch: number]: string } = {
  [CharCode.Colon]: '%3A', // gen-delims
  [CharCode.Slash]: '%2F',
  [CharCode.QuestionMark]: '%3F',
  [CharCode.Hash]: '%23',
  [CharCode.OpenSquareBracket]: '%5B',
  [CharCode.CloseSquareBracket]: '%5D',
  [CharCode.AtSign]: '%40',

  [CharCode.ExclamationMark]: '%21', // sub-delims
  [CharCode.DollarSign]: '%24',
  [CharCode.Ampersand]: '%26',
  [CharCode.SingleQuote]: '%27',
  [CharCode.OpenParen]: '%28',
  [CharCode.CloseParen]: '%29',
  [CharCode.Asterisk]: '%2A',
  [CharCode.Plus]: '%2B',
  [CharCode.Comma]: '%2C',
  [CharCode.Semicolon]: '%3B',
  [CharCode.Equals]: '%3D',

  [CharCode.Space]: '%20',
};

function encodeURIComponentFast(uriComponent: string, isPath: boolean, isAuthority: boolean): string {
  let res: string | undefined = undefined;
  let nativeEncodePos = -1;

  for (let pos = 0; pos < uriComponent.length; pos++) {
    const code = uriComponent.charCodeAt(pos);

    // unreserved characters: https://tools.ietf.org/html/rfc3986#section-2.3
    if (
      (code >= CharCode.a && code <= CharCode.z)
      || (code >= CharCode.A && code <= CharCode.Z)
      || (code >= CharCode.Digit0 && code <= CharCode.Digit9)
      || code === CharCode.Dash
      || code === CharCode.Period
      || code === CharCode.Underline
      || code === CharCode.Tilde
      || (isPath && code === CharCode.Slash)
      || (isAuthority && code === CharCode.OpenSquareBracket)
      || (isAuthority && code === CharCode.CloseSquareBracket)
      || (isAuthority && code === CharCode.Colon)
    ) {
      // check if we are delaying native encode
      if (nativeEncodePos !== -1) {
        res += encodeURIComponent(uriComponent.substring(nativeEncodePos, pos));
        nativeEncodePos = -1;
      }
      // check if we write into a new string (by default we try to return the param)
      if (res !== undefined) {
        res += uriComponent.charAt(pos);
      }

    } else {
      // encoding needed, we need to allocate a new string
      if (res === undefined) {
        res = uriComponent.substring(0, pos);
      }

      // check with default table first
      const escaped = encodeTable[code];
      if (escaped !== undefined) {

        // check if we are delaying native encode
        if (nativeEncodePos !== -1) {
          res += encodeURIComponent(uriComponent.substring(nativeEncodePos, pos));
          nativeEncodePos = -1;
        }

        // append escaped variant to result
        res += escaped;

      } else if (nativeEncodePos === -1) {
        // use native encode only when needed
        nativeEncodePos = pos;
      }
    }
  }

  if (nativeEncodePos !== -1) {
    res += encodeURIComponent(uriComponent.substring(nativeEncodePos));
  }

  return res !== undefined ? res : uriComponent;
}

function encodeURIComponentMinimal(path: string): string {
  let pos = path.indexOf('?');
  const hashPos = path.indexOf('#');
  if (pos === -1 || (hashPos !== -1 && hashPos < pos)) {
    pos = hashPos;
  }
  if (pos === -1) {
    return path;
  }

  let res = path.substring(0, pos);
  let copyStart = pos;
  for (; pos < path.length; pos++) {
    const code = path.charCodeAt(pos);
    if (code === CharCode.Hash || code === CharCode.QuestionMark) {
      if (copyStart < pos) {
        res += path.substring(copyStart, pos);
      }
      res += encodeTable[code];
      copyStart = pos + 1;
    }
  }
  if (copyStart < path.length) {
    res += path.substring(copyStart);
  }
  return res;
}

/**
 * Create the external version of a uri
 */
function _asFormatted(uri: URI, skipEncoding: boolean): string {

  const encoder = !skipEncoding
    ? encodeURIComponentFast
    : encodeURIComponentMinimal;

  let res = '';
  let { scheme, authority, path, query, fragment } = uri;
  if (scheme) {
    res += scheme;
    res += ':';
  }
  if (authority || scheme === 'file') {
    res += _slash;
    res += _slash;
  }
  if (authority) {
    let idx = authority.indexOf('@');
    if (idx !== -1) {
      // <user>@<auth>
      const userinfo = authority.substring(0, idx);
      authority = authority.substring(idx + 1);
      idx = userinfo.indexOf(':');
      if (idx === -1) {
        res += encoder(userinfo, false, false);
      } else {
        // <user>:<pass>@<auth>
        res += encoder(userinfo.substring(0, idx), false, false);
        res += ':';
        res += encoder(userinfo.substring(idx + 1), false, false);
      }
      res += '@';
    }
    authority = authority.toLowerCase();
    idx = authority.lastIndexOf(':');
    if (idx === -1) {
      res += encoder(authority, false, true);
    } else {
      // <auth>:<port>
      res += encoder(authority.substring(0, idx), false, true);
      res += authority.substring(idx);
    }
  }
  if (path) {
    // HTTP paths are case-sensitive, even when their first segment resembles a drive letter.
    const lowerScheme = scheme.toLowerCase();
    if (path.length >= 3 && path.charCodeAt(0) === CharCode.Slash && path.charCodeAt(2) === CharCode.Colon) {
      const code = path.charCodeAt(1);
      if (code >= CharCode.A && code <= CharCode.Z && lowerScheme !== 'http' && lowerScheme !== 'https') {
        path = `/${String.fromCharCode(code + 32)}:${path.substring(3)}`; // "/c:".length === 3
      }
    } else if (path.length >= 2 && path.charCodeAt(1) === CharCode.Colon) {
      const code = path.charCodeAt(0);
      if (code >= CharCode.A && code <= CharCode.Z && lowerScheme !== 'http' && lowerScheme !== 'https') {
        path = `${String.fromCharCode(code + 32)}:${path.substring(2)}`; // "/c:".length === 3
      }
    }
    // encode the rest of the path
    res += encoder(path, true, false);
  }
  if (query) {
    res += '?';
    res += encoder(query, false, false);
  }
  if (fragment) {
    res += '#';
    res += !skipEncoding ? encodeURIComponentFast(fragment, false, false) : fragment;
  }
  return res;
}

// --- decode

function decodeURIComponentGraceful(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    if (str.length > 3) {
      return str.substring(0, 3) + decodeURIComponentGraceful(str.substring(3));
    } else {
      return str;
    }
  }
}

const _rEncodedAsHex = /(%[0-9A-Za-z][0-9A-Za-z])+/g;

function percentDecode(str: string): string {
  if (!str.match(_rEncodedAsHex)) {
    return str;
  }
  return str.replace(_rEncodedAsHex, (match) => decodeURIComponentGraceful(match));
}

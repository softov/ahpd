import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * The one reader and the one writer for `file:` URIs.
 *
 * A client sends a folder as a URI and a backend opens it as a path, and the
 * two are not the same text: VS Code encodes a space as `%20`, and a backend
 * handed `my%20dir` opens nothing. Every place the host crosses between the
 * two crosses here, so a folder called `my dir` is `my dir` on both sides.
 *
 * Nothing here touches the filesystem - these are text functions - so they are
 * safe for a part of the host that holds no store.
 */

/** The scheme and the `//` after it, which is where a path begins. */
const SCHEME = 'file://';

/**
 * The path part of a `file:` URI: what is after the scheme, with any
 * authority dropped.
 *
 * Everything before the first slash is an authority, and an authority is not
 * part of the path: `file://host/a` names `/a` on this machine. Node's reader
 * refuses a URI whose authority is not its own rather than reading it, so the
 * authority comes off by hand and the two shapes arrive at the same reader.
 */
const pathPart = (value: string): string => {
  const rest = value.slice(SCHEME.length);
  if (rest.indexOf('/') === 0) return rest;
  const slash = rest.indexOf('/');
  return slash === -1 ? '' : rest.slice(slash);
};

/**
 * A `file:` URI, as the path it names.
 *
 * Anything that is not a `file://` URI is handed back unchanged, because the
 * callers of this are given a path about as often as a URI.
 *
 * A URI with an authority names a path on this machine, so the authority is
 * dropped: a shell's own OSC 7 says `file://host/path` and the path is the
 * whole of what a client opens.
 *
 * A URI Node will not parse, one whose `%` is not an escape, and one holding an
 * encoded slash all fall back to the URI's own text after the scheme: a folder
 * really called `100%` is what that is, and no caller of this ever threw on a
 * URI before, so none may start.
 *
 * A literal `#` and a literal `?` are part of the path. A builder that writes a
 * path into a URI without encoding it - an agent handing over its own `cwd`, a
 * shell's OSC 7 - puts the character in as it is, and a folder really called
 * `C#` or `x?y` is what that names. Node reads `#...` as a fragment and `?...`
 * as a query and answers the folder above them, so the two are escaped here and
 * decoded back by the same reader, which is the other half of what `uriOf`
 * writes: `%23` and `%3F`.
 */
export const localPath = (value: string): string => {
  if (!value.startsWith(SCHEME)) return value;
  const path = pathPart(value);
  // Nothing after the scheme is no path at all. Node reads `file://` as the
  // root, which is not what a URI naming nothing names.
  if (path === '') return path;
  /*
   * One reader for both shapes, reached by putting the path back under the
   * scheme: it is the reader that refuses an encoded slash rather than
   * decoding it into a separator, and a URI with an authority must not
   * decode differently from one without.
   */
  const escaped = path.replaceAll('#', '%23').replaceAll('?', '%3F');
  try {
    const decoded = fileURLToPath(`${SCHEME}${escaped}`);
    /*
     * A NUL is not a path. `%00` decodes to one, and a string carrying one is
     * a comparison and a log line nothing can read, so the text it came from
     * is what is handed on.
     */
    return decoded.includes('\0') ? path : decoded;
  }
  // A `%` that is not an escape is not one, and an encoded slash is a slash
  // in a name rather than a separator: a folder really called `100%` and a
  // folder really called `a/b` are both what that is, and their text is the
  // path. None of the readers this replaces ever threw, so this one may not
  // either.
  catch { return path; }
};

/** A path, back as the URI a client sends and receives. */
export const uriOf = (path: string): string => pathToFileURL(path).href;

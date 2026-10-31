/**
 * The one rule for a URL a client opens itself.
 *
 * A canvas and a view's Link both put a URL in front of a person, and a
 * relative path or a scheme a client does not open is something neither can
 * reach: the client would draw a link that goes nowhere, or a page that
 * nothing answers. The two checks are this one, so the rule is said once.
 */

/**
 * Whether `text` is an absolute http(s) URL with a host.
 *
 * The host is what makes it absolute and reachable; `https://` alone parses
 * and names no machine, so it is refused. Anything that is not a string is not
 * a URL, and a string that does not parse is not one either.
 */
export const isWebUrl = (text: unknown): boolean => {
  if (typeof text !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(text);
  }
  catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host !== '';
};

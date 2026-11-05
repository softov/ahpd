/**
 * The text a person reads, in the language their client sent.
 *
 * A catalog is one JSON object keyed by the field path of each text:
 * `meta.title`, `options.<key>.description`, `session.<key>.enum.<value>`, and
 * `messages.<key>` for what a plugin says to a person itself.
 * English is not in any catalog: it is the text the code already holds, and
 * each lookup is handed it as the answer when no catalog has the path.
 */

import es from './i18n/es.json' with { type: 'json' };
import pt from './i18n/pt.json' with { type: 'json' };

/** One locale's text, keyed by field path. A leaf is the translated string. */
export interface Catalog {
  [key: string]: Catalog | string;
}

/** The catalogs of one source, the host or a plugin, by BCP 47 tag. */
export type Catalogs = Record<string, Catalog>;

/** The host's own catalogs, for the host's own keys in the new session form. */
export const HOST_CATALOGS: Catalogs = { pt, es };

/**
 * The tags a locale is looked up as, most specific first.
 *
 * The tag as given, then its language subtag alone: ahpw sends `pt` and
 * ahpapp sends `pt-BR`, and a catalog written as `pt` answers both. Empty for
 * no locale.
 */
export const localesOf = (locale: string | undefined): string[] => {
  if (locale === undefined || locale === '') return [];
  const language = locale.split(/[-_]/)[0] ?? locale;
  return language === locale || language === '' ? [locale] : [locale, language];
};

/** The string at `path` in one catalog, or `undefined` when the path ends anywhere else. */
const at = (catalog: Catalog | undefined, path: readonly string[]): string | undefined => {
  let found: Catalog | string | undefined = catalog;
  for (const key of path) {
    if (typeof found !== 'object' || found === null || !Object.hasOwn(found, key)) return undefined;
    found = found[key];
  }
  return typeof found === 'string' ? found : undefined;
};

/**
 * The text at `path` for `locale`, or `english` when no catalog has it.
 *
 * `path` is an array of keys, such as `['session', 'isolation', 'title']`.
 * The catalogs are tried in the order given, and in each one the tag and then
 * its language, so a plugin's own words come before the host's. One string at
 * a time: a catalog that has a title and no description still gives its title.
 */
export const translated = (
  path: readonly string[],
  english: string,
  locale: string | undefined,
  ...catalogs: readonly (Catalogs | undefined)[]
): string => {
  const tags = localesOf(locale);
  for (const one of catalogs) {
    if (one === undefined) continue;
    for (const tag of tags) {
      const found = at(Object.hasOwn(one, tag) ? one[tag] : undefined, path);
      if (found !== undefined) return found;
    }
  }
  return english;
};

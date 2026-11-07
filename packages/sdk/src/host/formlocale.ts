import { HOST_CATALOGS, translated } from '../i18n.js';
import type { Catalogs } from '../i18n.js';
import type { Bag } from '../types/common.js';

/** The catalogs a key's text is looked up in, in order, for one form. */
export type CatalogsOf = (key: string) => readonly (Catalogs | undefined)[];

/** The host's own catalogs, for a key only the host declares. */
export const hostCatalogs: CatalogsOf = () => [HOST_CATALOGS];

/**
 * One form's properties with their text in `locale`.
 *
 * The text of key `<key>` is at `<block>.<key>` in a catalog: `title`,
 * `description`, `enum.<value>` for the label of one value,
 * `enumDescriptions.<value>` for its description, and `items.title`. Every
 * other field is copied as it is, and the values themselves never move.
 *
 * A key that sets `enumDynamic` keeps its labels and their descriptions: its
 * values come from a repository or a person, and a label is the value it names.
 *
 * Called before an answerer fills a dynamic key, so the answerer's labels are
 * never read as text to translate. No locale answers `properties` itself.
 */
export const formIn = (properties: Bag, block: 'session' | 'options', locale: string | undefined, catalogsOf: CatalogsOf): Bag => {
  if (locale === undefined) return properties;
  const out: Bag = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    const property = value as Bag;
    const catalogs = catalogsOf(key);
    const text = (path: string[], english: string): string => translated([block, key, ...path], english, locale, ...catalogs);
    const copy: Bag = { ...property };
    if (typeof property.title === 'string') copy.title = text(['title'], property.title);
    if (typeof property.description === 'string') copy.description = text(['description'], property.description);
    if (property.enumDynamic === undefined && Array.isArray(property.enum) && Array.isArray(property.enumLabels)) {
      const values = property.enum as unknown[];
      copy.enumLabels = (property.enumLabels as unknown[]).map((label, at) => {
        const one = values[at];
        return typeof label === 'string' && (typeof one === 'string' || typeof one === 'number' || typeof one === 'boolean')
          ? text(['enum', String(one)], label)
          : label;
      });
    }
    // Each value's description with its label, as VS Code localizes the two
    // together.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L387-L405
    if (property.enumDynamic === undefined && Array.isArray(property.enum) && Array.isArray(property.enumDescriptions)) {
      const values = property.enum as unknown[];
      copy.enumDescriptions = (property.enumDescriptions as unknown[]).map((description, at) => {
        const one = values[at];
        return typeof description === 'string' && (typeof one === 'string' || typeof one === 'number' || typeof one === 'boolean')
          ? text(['enumDescriptions', String(one)], description)
          : description;
      });
    }
    const items = property.items;
    if (typeof items === 'object' && items !== null && !Array.isArray(items) && typeof (items as Bag).title === 'string') {
      copy.items = { ...(items as Bag), title: text(['items', 'title'], (items as Bag).title as string) };
    }
    out[key] = copy;
  }
  return out;
};

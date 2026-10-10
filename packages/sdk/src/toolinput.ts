/**
 * The readers for a tool's input fields, one per kind of field.
 *
 * Every tool this package contributes reads what the model sent through one of
 * these, so a field of the wrong shape is refused in the same sentence
 * whichever tool it arrived at: `Invalid <tool> input: <field> ...`. That
 * sentence is what the model reads to fix its call, so it names the tool and
 * the field, and this file is the one place the four are written.
 *
 * A reader answers only for its own field. What a caller does with the answer
 * is the caller's: `required` answers the text exactly as it arrived, because
 * only the tool knows whether the spaces around it matter.
 *
 * This module is internal. A tool's input belongs to the protocol rather than
 * to this package, so nothing here is exported from `@ahpd/sdk`.
 */

/** The text a tool was given, or a refusal naming the tool and the field. */
export const required = (value: unknown, field: string, tool: string): string => {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Invalid ${tool} input: ${field} must be a non-empty string.`);
  return value;
};

/** The text a tool may be given, or nothing where it was given none. */
export const optional = (value: unknown, field: string, tool: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid ${tool} input: ${field} must be a string.`);
  return value;
};

/** A yes-or-no a tool may be given, or nothing where it was given none. */
export const flag = (value: unknown, field: string, tool: string): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${tool} input: ${field} must be a boolean.`);
  return value;
};

/**
 * A timestamp a tool may be given, in milliseconds since the epoch.
 *
 * A string `Date.parse` reads, as the protocol's ISO-8601 timestamps are. A
 * number, or a string it cannot read, is refused rather than guessed at, so a
 * filter never matches the wrong turns quietly.
 */
export const when = (value: unknown, field: string, tool: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) throw new Error(`Invalid ${tool} input: ${field} must be an ISO-8601 timestamp.`);
  return at;
};

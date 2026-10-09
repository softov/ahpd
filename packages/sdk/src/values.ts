/**
 * The one-line readers for a value that arrived untyped.
 *
 * Each reads a value that arrived untyped - a JSON body, a plugin's frame, a
 * field off a store - and answers what it holds or what to fall back on. A
 * plugin reaches them through `@ahpd/sdk`, and nothing in this file imports a
 * runtime, which is what keeps the sdk taking no dependency.
 */

import type { Bag } from './types/common.js';
import type { Owner } from './types/usage.js';

/** Whether a value is an object with named fields, which is what a bag and a schema are. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A value as a keyed object, or an empty one where it is not one: a list is not an object with fields. */
export const bag = (value: unknown): Bag => (isRecord(value) ? value : {});

/** A string, or nothing where the value is not one. */
export const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The strings in an array, whatever else found its way in there, and none for anything that is not one. */
export const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []);

/** One error, as the one line a person reads. */
export const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A typed reference as a file wrote it, or nothing when it is not one.
 *
 * The four kinds `Owner` names, and an id after the colon: a row naming no
 * owner, or one naming something which is not one, is a row nobody owns.
 */
export const ownerOf = (value: unknown): Owner | undefined =>
  typeof value === 'string' && /^(?:user|team|project|root):.+$/.test(value) ? value as Owner : undefined;

import { Readable } from 'node:stream';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { fileProcessor } from './files.ts';

/**
 * An action's input, made as Activepieces makes it before the action runs.
 *
 * Two passes, each the reference's own. First the call is diagnosed as
 * `executePieceActionRun` diagnoses one: a key no prop has, a required prop
 * with no value and a value a static dropdown does not list refuse the call in
 * its words; an empty container is made the prop's own shape, and the missing
 * optional arrays, dynamic props and checkboxes are filled. Then the engine's
 * `propsProcessor` runs: each value through its type's processor, the props of
 * each item of an array included, and each result through its type's
 * validator, the call refused with every validator's words when one fails.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/api/src/app/mcp/tools/flow-run-utils.ts
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/api/src/app/mcp/tools/mcp-utils.ts
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/variables/props-processor.ts
 *
 * The words that name a tool of Activepieces' own MCP server, which a session
 * here does not have, are left out of the diagnosis.
 */

/** One prop, as the piece declares it: the framework's fields this file reads. */
export interface Prop {
  type?: unknown;
  displayName?: unknown;
  description?: unknown;
  required?: unknown;
  defaultValue?: unknown;
  streaming?: unknown;
  options?: unknown;
  properties?: unknown;
}

/** An action's props, by the name the piece reads each by. */
export type Props = Record<string, Prop>;

/** Whether a value is a plain record: the core utils' `isObject`. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a value is nothing: the core utils' `isNil`. */
const isNil = (value: unknown): value is null | undefined => value === null || value === undefined;

/** A string read as JSON where it parses, and as itself where it does not: the core utils' `parseToJsonIfPossible`. */
const parseToJsonIfPossible = (value: unknown): unknown => {
  try {
    return JSON.parse(value as string) as unknown;
  }
  catch {
    return value;
  }
};

/** The prop types that are no input of an action. */
const NON_INPUT_PROP_TYPES = new Set(['OAUTH2', 'SECRET_TEXT', 'BASIC_AUTH', 'CUSTOM_AUTH', 'MARKDOWN']);

/** The keys of an input that are no prop of the action. */
const INTERNAL_INPUT_KEYS = new Set(['auth']);

/** The prop types whose value is an id another call resolves. */
const RESOLVABLE_PROP_TYPES = new Set(['DROPDOWN', 'MULTI_SELECT_DROPDOWN', 'DYNAMIC']);

/** The options a static dropdown lists, each with its value. */
const optionsOf = (prop: Prop): { value: unknown }[] | undefined => {
  const options = isObject(prop.options) ? prop.options['options'] : undefined;
  return Array.isArray(options) ? options.filter(isObject).map((one) => ({ value: one['value'] })) : undefined;
};

/** The values a static dropdown offers, as a hint after its name. */
const formatOptionsHint = (options: { value: unknown }[] | undefined): string => {
  if (options === undefined || options.length === 0) return '';
  const values = options.map((one) => String(one.value));
  if (values.length > 10) return ` - options: ${values.slice(0, 10).join(', ')}... (${values.length} total)`;
  return ` - options: ${values.join(', ')}`;
};

/** The edit distance between two names. */
const levenshtein = (a: string, b: string): number => {
  const rows = Array.from({ length: a.length + 1 }, (_one, at) => [at, ...new Array<number>(b.length).fill(0)]);
  const first = rows[0] as number[];
  for (let column = 1; column <= b.length; column++) first[column] = column;
  for (let row = 1; row <= a.length; row++) {
    const current = rows[row] as number[];
    const above = rows[row - 1] as number[];
    for (let column = 1; column <= b.length; column++) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min((above[column] as number) + 1, (current[column - 1] as number) + 1, (above[column - 1] as number) + cost);
    }
  }
  return (rows[a.length] as number[])[b.length] as number;
};

/** The prop a mistyped key most likely meant, or nothing when none is close. */
const suggestClosestKey = (key: string, validKeys: string[]): string | undefined => {
  const lowered = key.toLowerCase();
  const containing = validKeys.find((valid) => {
    const one = valid.toLowerCase();
    return one.includes(lowered) || lowered.includes(one);
  });
  if (containing !== undefined) return containing;
  const threshold = Math.max(2, Math.floor(key.length / 2));
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const valid of validKeys) {
    const distance = levenshtein(lowered, valid.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = valid;
    }
  }
  return best !== undefined && bestDistance <= threshold ? best : undefined;
};

/**
 * Why a call cannot run as it is, or nothing when it can: `diagnosePieceProps`
 * and the refusals `executePieceActionRun` makes of what it finds.
 */
export const diagnose = (props: Props, input: Record<string, unknown>): string | undefined => {
  const missing: string[] = [];
  const uiRequired: string[] = [];
  const invalidEnums: string[] = [];
  const allProps: string[] = [];
  const validPropKeys = new Set<string>();
  for (const [name, prop] of Object.entries(props)) {
    const type = String(prop.type);
    if (NON_INPUT_PROP_TYPES.has(type)) continue;
    validPropKeys.add(name);
    const isStaticDropdown = type === 'STATIC_DROPDOWN' || type === 'STATIC_MULTI_SELECT_DROPDOWN';
    const options = optionsOf(prop);
    const optionsHint = isStaticDropdown ? formatOptionsHint(options) : '';
    allProps.push(`${name} (${type}${prop.required === true ? ', required' : ''}${optionsHint})`);
    const value = input[name];
    const valueProvided = value !== undefined && value !== null && value !== '';
    if (prop.required === true && !valueProvided) {
      const descriptionHint = typeof prop.description === 'string' && prop.description !== '' ? ` - ${prop.description}` : '';
      if (RESOLVABLE_PROP_TYPES.has(type)) uiRequired.push(`${name} (${typeof prop.displayName === 'string' ? prop.displayName : name})${descriptionHint}`);
      else missing.push(`${name} (${type}${optionsHint})${descriptionHint}`);
    }
    if (isStaticDropdown && valueProvided && options !== undefined) {
      const provided = Array.isArray(value) ? value : [value];
      const bad = provided.filter((one) => !options.some((allowed) => allowed.value === one));
      if (bad.length > 0) invalidEnums.push(`${name}: ${bad.map((one) => JSON.stringify(one)).join(', ')} not allowed${optionsHint}`);
    }
  }

  const unknownKeys = Object.keys(input).filter((key) => !validPropKeys.has(key) && !INTERNAL_INPUT_KEYS.has(key));
  const parts: string[] = [];
  if (unknownKeys.length > 0) {
    const valid = Object.entries(props)
      .filter(([, prop]) => !NON_INPUT_PROP_TYPES.has(String(prop.type)))
      .map(([name, prop]) => `- ${name} (${String(prop.type)}): ${typeof prop.description === 'string' ? prop.description : String(prop.displayName ?? name)}`)
      .join('\n');
    const suggestions = unknownKeys
      .map((key) => {
        const closest = suggestClosestKey(key, [...validPropKeys]);
        return closest === undefined ? undefined : `'${key}' → did you mean '${closest}'?`;
      })
      .filter((one): one is string => one !== undefined);
    const suggestionLine = suggestions.length > 0 ? `\nSuggestions: ${suggestions.join('; ')}.` : '';
    parts.push(`Unknown properties: ${unknownKeys.map((key) => `'${key}'`).join(', ')}.${suggestionLine} Valid properties for this action are:\n${valid}\nPlease retry with correct property names.`);
  }
  if (invalidEnums.length > 0) parts.push(`Invalid option values: ${invalidEnums.join('; ')}. Use one of the listed option values exactly (case-sensitive).`);
  if (missing.length > 0) parts.push(`Missing required inputs: ${missing.join(', ')}.`);
  if (uiRequired.length > 0) parts.push(`These inputs are dropdown/dynamic fields, which take the value's ID: ${uiRequired.join(', ')}.`);
  if (allProps.length > 0 && unknownKeys.length === 0) parts.push(`Expected inputs: ${allProps.join(', ')}.`);

  if (unknownKeys.length > 0) return parts.join(' ');
  if (missing.length > 0 || invalidEnums.length > 0) return `Cannot run action: ${parts.join(' ')}`;
  return undefined;
};

/**
 * The input with an empty container made its prop's shape, and an absent
 * free-form one filled empty: `coerceEmptyContainerInputs`.
 */
export const coerceEmptyContainerInputs = (props: Props, input: Record<string, unknown>): Record<string, unknown> => {
  const coerced: Record<string, unknown> = { ...input };
  for (const [name, prop] of Object.entries(props)) {
    const type = prop.type;
    if (type !== 'OBJECT' && type !== 'ARRAY') continue;
    const value = coerced[name];
    const valueProvided = value !== undefined && value !== null && value !== '';
    const emptyWrongShapeContainer = (type === 'OBJECT' && Array.isArray(value) && value.length === 0)
      || (type === 'ARRAY' && isObject(value) && Object.keys(value).length === 0);
    // A structured array is required data: an absent one stays absent, so the
    // diagnosis says it is missing.
    const isStructuredArray = type === 'ARRAY' && isObject(prop.properties) && Object.keys(prop.properties).length > 0;
    if (emptyWrongShapeContainer || (!valueProvided && !isStructuredArray)) coerced[name] = type === 'OBJECT' ? {} : [];
  }
  return coerced;
};

/**
 * The defaults of the optional props a call left out, under what the call
 * gave: `fillDefaultsForMissingOptionalProps`.
 */
export const fillDefaultsForMissingOptionalProps = (props: Props, input: Record<string, unknown>): Record<string, unknown> => {
  const defaults: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(props)) {
    if (prop.required === true) continue;
    if (prop.type === 'ARRAY') defaults[name] = [];
    else if (prop.type === 'DYNAMIC') defaults[name] = {};
    else if (prop.type === 'CHECKBOX') defaults[name] = prop.defaultValue ?? false;
  }
  return { ...defaults, ...input };
};

/** One prop's processor: what the engine turns a value of that type into. */
type Processor = (prop: Prop, value: unknown) => unknown;

/** The engine's `textProcessor`. */
const textProcessor: Processor = (prop, value) => {
  if (isNil(value)) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  const result = String(value);
  if (result.length === 0 && prop.required !== true) return undefined;
  return result;
};

/** The engine's `numberProcessor`. */
const numberProcessor: Processor = (_prop, value) => {
  if (isNil(value)) return value;
  if (value === '') return undefined;
  return Number(value);
};

/** The engine's `jsonProcessor`. */
const jsonProcessor: Processor = (_prop, value) => {
  if (isNil(value)) return value;
  try {
    if (typeof value === 'object') return value;
    return JSON.parse(value as string) as unknown;
  }
  catch {
    return undefined;
  }
};

/** The engine's `objectProcessor`. */
const objectProcessor: Processor = (_prop, value) => {
  if (isNil(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    }
    catch {
      return undefined;
    }
  }
  if (isObject(value)) return value;
  return undefined;
};

dayjs.extend(utc);
dayjs.extend(timezone);

/** The engine's `dateTimeProcessor`: the value read in UTC, written as ISO 8601. */
const dateTimeProcessor: Processor = (_prop, value) => {
  try {
    if (!value) throw new Error('Undefined input');
    return dayjs.tz(value as string, 'UTC').toISOString();
  }
  catch {
    return undefined;
  }
};

/** The engine's `multiSelectProcessor`. */
const multiSelectProcessor: Processor = (_prop, value) => {
  if (isNil(value) || Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().length === 0) return undefined;
  const parsed = parseToJsonIfPossible(value);
  return Array.isArray(parsed) ? parsed : [value];
};

/** The engine's `checkboxProcessor`. */
const checkboxProcessor: Processor = (_prop, value) => {
  if (isNil(value) || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.trim().length === 0) return undefined;
  const parsed = parseToJsonIfPossible(value);
  return typeof parsed === 'boolean' ? parsed : value;
};

/** The engine's processors, by prop type. */
const PROCESSORS: Record<string, Processor> = {
  JSON: jsonProcessor,
  OBJECT: objectProcessor,
  NUMBER: numberProcessor,
  LONG_TEXT: textProcessor,
  SHORT_TEXT: textProcessor,
  SECRET_TEXT: textProcessor,
  DATE_TIME: dateTimeProcessor,
  MULTI_SELECT_DROPDOWN: multiSelectProcessor,
  STATIC_MULTI_SELECT_DROPDOWN: multiSelectProcessor,
  CHECKBOX: checkboxProcessor,
};

/** The engine's `arrayZipperProcessor`: an object of arrays made an array of objects. */
const arrayZipper = (value: unknown): unknown => {
  if (Array.isArray(value) || !isObject(value)) return value;
  const length = Math.max(...Object.values(value).map((one) => (Array.isArray(one) ? one.length : 1)));
  return Array.from({ length }, (_one, at) => Object.fromEntries(Object.entries(value)
    .map(([key, one]) => [key, Array.isArray(one) ? one[at] as unknown : one])));
};

/** The presets a date range may name. */
const DATE_RANGE_PRESETS = ['any_time', 'last_24_hours', 'last_7_days', 'last_30_days', 'last_90_days', 'this_month', 'custom'];

/** Whether a value is the framework's `DateRangeValue`. */
const isDateRange = (value: unknown): boolean => isObject(value)
  && (value['preset'] === undefined || DATE_RANGE_PRESETS.includes(value['preset'] as string))
  && (value['after'] === undefined || typeof value['after'] === 'string')
  && (value['before'] === undefined || typeof value['before'] === 'string');

/** The engine's `validateProperty`: one value against its prop, in the validator's words. */
const validateProperty = (prop: Prop, value: unknown, originalValue: unknown): string[] => {
  const shown = String(originalValue);
  if (prop.type === 'JSON') {
    if (prop.required !== true && originalValue === '') return [];
    if (!isNil(originalValue) && isNil(value)) return [`Expected JSON, received: ${shown}`];
    if (prop.required !== true && isNil(value)) return [];
    if (!isObject(value) && !Array.isArray(value)) return [`Expected JSON, received: ${shown}`];
    return [];
  }
  if (prop.required !== true && isNil(value)) return [];
  switch (prop.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT':
    case 'RICH_TEXT':
      return typeof value === 'string' ? [] : [`Expected string, received: ${shown}`];
    case 'NUMBER':
      return typeof value === 'number' && !Number.isNaN(value) ? [] : [`Expected number, received: ${shown}`];
    case 'CHECKBOX':
      return typeof value === 'boolean' ? [] : [`Expected boolean, received: ${shown}`];
    case 'DATE_TIME':
      return typeof value === 'string' ? [] : [`Invalid datetime format. Expected ISO format (e.g. 2024-03-14T12:00:00.000Z), received: ${shown}`];
    case 'DATE_RANGE':
      return isDateRange(value) ? [] : [`Expected date range, received: ${shown}`];
    case 'ARRAY':
    case 'MULTI_SELECT_DROPDOWN':
    case 'STATIC_MULTI_SELECT_DROPDOWN':
      return Array.isArray(value) ? [] : [`Expected array, received: ${shown}`];
    case 'OBJECT':
      return isObject(value) ? [] : [`Expected object, received: ${shown}`];
    case 'FILE': {
      if (isObject(value)) return [];
      /*
       * The validator's words, with a URL named by its host and never its path
       * or query, where a signed URL carries its token (plan plugin/70, Softov
       * 2026-10-26: "A refusal names a URL's host, never its path or query").
       * A URL with no host, a `data:` URI, is named by its scheme.
       */
      const url = typeof originalValue === 'string' && URL.canParse(originalValue) ? new URL(originalValue) : undefined;
      const named = url === undefined ? shown : (url.host === '' ? url.protocol : url.host);
      return [`Expected file url or base64 with mimeType, received: ${named}`];
    }
    default:
      return [];
  }
};

/** What each prop's validation found, by its name: the engine's `PropsValidationError`. */
interface ValidationErrors {
  [key: string]: string[] | ValidationErrors | ValidationErrors[];
}

/** Every stream a processed input opened, ended: a refused call never reads them. */
const destroyOpenStreams = (value: unknown): void => {
  if (isNil(value) || typeof value !== 'object' || Buffer.isBuffer(value)) return;
  if (value instanceof Readable) {
    value.destroy();
    return;
  }
  for (const child of Object.values(value)) destroyOpenStreams(child);
};

/**
 * One input through the processors and validators of its props: the engine's
 * `applyProcessorsAndValidators`. `folder` is the session's attachments folder,
 * which a `FILE` value naming an attachment is read from.
 */
export const applyProcessorsAndValidators = async (
  resolvedInput: Record<string, unknown>,
  props: Props,
  folder: string | undefined,
): Promise<{ processedInput: Record<string, unknown>; errors: ValidationErrors }> => {
  const processedInput: Record<string, unknown> = { ...resolvedInput };
  const errors: ValidationErrors = {};
  for (const [key, value] of Object.entries(resolvedInput)) {
    const prop = props[key];
    if (prop === undefined) continue;
    if (prop.type === 'ARRAY' && isObject(prop.properties)) {
      const items = arrayZipper(value);
      const processedArray: unknown[] = [];
      const processedErrors: ValidationErrors[] = [];
      for (const item of Array.isArray(items) ? items : []) {
        const done = await applyProcessorsAndValidators(isObject(item) ? item : {}, prop.properties as Props, folder);
        processedArray.push(done.processedInput);
        processedErrors.push(done.errors);
      }
      processedInput[key] = processedArray;
      if (processedErrors.some((one) => Object.keys(one).length > 0)) errors[key] = { properties: processedErrors };
    }
    if (prop.required !== true && isNil(processedInput[key])) processedInput[key] = undefined;
    if (prop.type === 'FILE') processedInput[key] = await fileProcessor(prop, processedInput[key], folder);
    else {
      const processor = PROCESSORS[String(prop.type)];
      if (processor !== undefined) processedInput[key] = processor(prop, processedInput[key]);
    }
  }
  for (const [key, value] of Object.entries(processedInput)) {
    const prop = props[key];
    if (prop === undefined) continue;
    const found = validateProperty(prop, value, resolvedInput[key]);
    if (found.length > 0) errors[key] = found;
  }
  if (Object.keys(errors).length > 0) destroyOpenStreams(processedInput);
  return { processedInput, errors };
};

/**
 * One call's input, made as Activepieces makes an action run's: diagnosed and
 * refused in its words, coerced and filled, then processed and validated, the
 * validators' findings refused as the engine throws them.
 */
export const inputOf = async (props: Props, input: Record<string, unknown>, folder: string | undefined): Promise<Record<string, unknown>> => {
  const coerced = coerceEmptyContainerInputs(props, input);
  const diagnosis = diagnose(props, coerced);
  if (diagnosis !== undefined) throw new Error(diagnosis);
  const { processedInput, errors } = await applyProcessorsAndValidators(fillDefaultsForMissingOptionalProps(props, coerced), props, folder);
  if (Object.keys(errors).length > 0) throw new Error(JSON.stringify(errors, null, 2));
  return processedInput;
};

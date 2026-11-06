import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProcessorsAndValidators, coerceEmptyContainerInputs, diagnose, fillDefaultsForMissingOptionalProps, inputOf } from '../src/props.js';
import type { Props } from '../src/props.js';

/*
 * An action's input, as Activepieces makes it before the action runs: the
 * diagnosis `executePieceActionRun` makes, the containers it coerces and the
 * defaults it fills, and the engine's processors and validators.
 */

/** The folders a case made, removed after it. */
const made: string[] = [];
afterEach(() => {
  for (const one of made.splice(0)) rmSync(one, { recursive: true, force: true });
});

/** One action's props, of most of the framework's types. */
const PROPS: Props = {
  title: { type: 'SHORT_TEXT', displayName: 'Title', required: true, description: 'What the issue is called' },
  count: { type: 'NUMBER', displayName: 'Count', required: false },
  draft: { type: 'CHECKBOX', displayName: 'Draft', required: false, defaultValue: true },
  labels: { type: 'ARRAY', displayName: 'Labels', required: false },
  body: { type: 'JSON', displayName: 'Body', required: false },
  extra: { type: 'OBJECT', displayName: 'Extra', required: false },
  due: { type: 'DATE_TIME', displayName: 'Due', required: false },
  colour: { type: 'STATIC_DROPDOWN', displayName: 'Colour', required: false, options: { options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }] } },
  tags: { type: 'STATIC_MULTI_SELECT_DROPDOWN', displayName: 'Tags', required: false, options: { options: [{ label: 'A', value: 'a' }] } },
  notice: { type: 'MARKDOWN', displayName: 'Notice', required: false },
  board: { type: 'DROPDOWN', displayName: 'Board', required: true },
};

describe('the diagnosis', () => {
  it('refuses a key no prop has, suggesting the prop it most likely meant', () => {
    const said = diagnose(PROPS, { title: 'x', board: 'b1', titel: 'x' });
    expect(said).toContain("Unknown properties: 'titel'.\nSuggestions: 'titel' → did you mean 'title'?. Valid properties for this action are:\n- title (SHORT_TEXT): What the issue is called\n");
    expect(said).not.toContain('notice');
  });

  it('refuses a missing required prop and a value a static dropdown does not list, and lets a resolvable one pass', () => {
    expect(diagnose(PROPS, { colour: 'green', board: 'b1' })).toBe(
      'Cannot run action: Invalid option values: colour: "green" not allowed - options: red, blue. Use one of the listed option values exactly (case-sensitive). '
      + 'Missing required inputs: title (SHORT_TEXT) - What the issue is called. Expected inputs: title (SHORT_TEXT, required), count (NUMBER), draft (CHECKBOX), labels (ARRAY), body (JSON), extra (OBJECT), due (DATE_TIME), colour (STATIC_DROPDOWN - options: red, blue), tags (STATIC_MULTI_SELECT_DROPDOWN - options: a), board (DROPDOWN, required).',
    );
    expect(diagnose(PROPS, { title: 'x' })).toBeUndefined();
  });
});

describe('the coercion and the defaults', () => {
  it('makes an empty container its prop\'s shape, and an absent free-form one empty', () => {
    expect(coerceEmptyContainerInputs(PROPS, { extra: [], labels: {} })).toMatchObject({ extra: {}, labels: [] });
    expect(coerceEmptyContainerInputs(PROPS, {})).toMatchObject({ extra: {}, labels: [] });
  });

  it('fills the optional arrays, dynamic props and checkboxes a call left out, under what it gave', () => {
    expect(fillDefaultsForMissingOptionalProps(PROPS, { draft: false })).toEqual({ labels: [], draft: false });
    expect(fillDefaultsForMissingOptionalProps(PROPS, {})).toEqual({ labels: [], draft: true });
  });
});

describe('the processors and validators', () => {
  it('turns each value into its prop\'s type', async () => {
    const { processedInput, errors } = await applyProcessorsAndValidators({
      title: 7,
      count: '12',
      draft: 'true',
      body: '{"a":1}',
      extra: '{"b":2}',
      due: '2026-11-05 10:00',
      tags: 'a',
    }, PROPS, undefined);
    expect(errors).toEqual({});
    expect(processedInput).toEqual({
      title: '7',
      count: 12,
      draft: true,
      body: { a: 1 },
      extra: { b: 2 },
      due: '2026-11-05T10:00:00.000Z',
      tags: ['a'],
    });
  });

  it('answers each value its validator refuses in the validator\'s words', async () => {
    const { errors } = await applyProcessorsAndValidators({ title: 't', count: 'twelve', body: 'not json', due: '' }, PROPS, undefined);
    expect(errors).toEqual({
      count: ['Expected number, received: twelve'],
      body: ['Expected JSON, received: not json'],
    });
  });

  it('processes the props of each item of an array, its files among them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-props-'));
    made.push(dir);
    writeFileSync(join(dir, 'a.txt'), 'first');
    const props: Props = {
      rows: { type: 'ARRAY', required: true, properties: { name: { type: 'SHORT_TEXT', required: true }, file: { type: 'FILE', required: true } } },
    };
    const { processedInput, errors } = await applyProcessorsAndValidators({ rows: [{ name: 1, file: 'a.txt' }, { name: 'two', file: 'b.txt' }] }, props, dir);
    const rows = processedInput['rows'] as { name: unknown; file: { filename: string } | null }[];
    expect(rows[0]?.name).toBe('1');
    expect(rows[0]?.file?.filename).toBe('a.txt');
    expect(errors).toEqual({ rows: { properties: [{}, { file: ['Expected file url or base64 with mimeType, received: b.txt'] }] } });
  });
});

describe('one call\'s input', () => {
  it('is refused with the engine\'s JSON of what the validators found', async () => {
    await expect(inputOf(PROPS, { title: 't', board: 'b1', count: 'many' }, undefined)).rejects.toThrow(
      JSON.stringify({ count: ['Expected number, received: many'] }, null, 2),
    );
  });
});

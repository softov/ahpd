import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A client tool's input schema, reaching the model whole.
 *
 * The protocol declares a tool's `inputSchema` as JSON Schema, and
 * `createSdkMcpServer` takes a zod raw shape and turns it back into JSON
 * Schema for the model. So a definition has to make the round trip: a nested
 * object, an array of objects and an enum reach the model as the client wrote
 * them, and only a property zod cannot read is a string.
 *
 * The cases read both: what the SDK server lists for the tool - the zod the
 * conversion is made from - and the JSON Schema that zod writes back out of
 * it, which is what the model is offered.
 */

/** The one argument the server was built from, held for the cases. */
const seen = vi.hoisted(() => ({ given: undefined as Record<string, unknown> | undefined }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => {
    seen.given = given;
    return { type: 'sdk', name: given.name, tools: given.tools };
  },
}));

const { contributed } = await import('../src/session/clienttools.js');

/** One client tool, whose `inputSchema` is this JSON Schema. */
const toolOf = (inputSchema: Bag): BoundTool => ({
  owner: 'probe',
  definition: { name: 'openFile', description: 'Open a file', inputSchema },
}) as unknown as BoundTool;

/** The raw shape the SDK server was handed for a tool with this schema. */
const shapeOf = (inputSchema: Bag): Record<string, z.ZodTypeAny> => {
  contributed('client', [toolOf(inputSchema)], () => Promise.reject(new Error('not run')));
  const server = seen.given as { tools: { inputSchema: Record<string, z.ZodTypeAny> }[] } | undefined;
  const tool = server?.tools[0];
  if (tool === undefined) throw new Error('the server was handed no tool');
  return tool.inputSchema;
};

/** The zod the server listed for one property, which is what the conversion is made from. */
const zodOf = (shape: Record<string, z.ZodTypeAny>, key: string): z.ZodTypeAny => {
  const property = shape[key];
  if (property === undefined) throw new Error(`the server listed no ${key}`);
  return property;
};

/**
 * The JSON Schema zod writes out of one property, which is what the model reads.
 *
 * `io: 'input'` because the model is offering arguments, not reading a result:
 * a property left off `required` is optional, and the optional wrapper is unwrapped
 * here so the extra `anyOf` it would add does not hide the shape under it.
 */
const schemaOf = (property: z.ZodTypeAny): Bag => {
  const shell = z.toJSONSchema(property, { io: 'input' }) as Bag;
  const anyOf = shell.anyOf;
  return Array.isArray(anyOf) && anyOf.length === 1 ? anyOf[0] as Bag : shell;
};

it('reads a nested object as an object with its required fields', () => {
  const shape = shapeOf({
    type: 'object',
    properties: {
      point: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
      },
    },
    required: ['point'],
  });
  const written = schemaOf(zodOf(shape, 'point'));
  expect(written.type).toBe('object');
  expect(written.required).toEqual(['x', 'y']);
});

it('keeps an array of objects an array of objects', () => {
  const shape = shapeOf({
    type: 'object',
    properties: {
      points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } },
    },
    required: ['points'],
  });
  const written = schemaOf(zodOf(shape, 'points'));
  expect(written.type).toBe('array');
  expect((written.items as Bag).type).toBe('object');
  expect((written.items as Bag).required).toEqual(['x']);
});

it('keeps an enum an enum, and a description on its property', () => {
  const shape = shapeOf({
    type: 'object',
    properties: { colour: { type: 'string', enum: ['red', 'blue'], description: 'Which colour' } },
    required: ['colour'],
  });
  const written = schemaOf(zodOf(shape, 'colour'));
  // Not a string, which is what an enum used to become.
  expect(written.enum).toEqual(['red', 'blue']);
  // Read back by the model, so a property the reader drops the words from keeps them.
  expect(written.description).toBe('Which colour');
});

it('leaves the other properties as they are when one cannot be read', () => {
  const shape = shapeOf({
    type: 'object',
    properties: {
      path: { type: 'string' },
      // A `$ref` zod cannot resolve on its own: the reader throws, and the
      // property is a string, which is what every argument used to be.
      broken: { $ref: '#/$defs/Missing' },
    },
    required: ['path', 'broken'],
  });
  expect(zodOf(shape, 'broken').def.type).toBe('string');
  expect(schemaOf(zodOf(shape, 'path')).type).toBe('string');
});

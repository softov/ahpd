import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { env, extraArgs, optionDefaults, outputStyle, presetSchema, sandbox, thinking } from '../src/options.js';

/*
 * Each Claude option, declared once.
 *
 * A declaration is what a value may be and where it goes, and both the schema
 * a preset is checked against and the options a session's `query()` is built
 * from are made of them. So the cases here are the two questions a declaration
 * answers - does this value hold, and what does it become - and a preset's
 * values going through them into a session, which is the half that only holds
 * if `session.ts` asks.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.options.push(options);
    return {
      async *[Symbol.asyncIterator]() { /* nothing streamed */ },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async (flags: Record<string, unknown>) => { sdk.flags.push(flags); },
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const sdk = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], flags: [] as Record<string, unknown>[] }));

const { createSession } = await import('../src/session.js');

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** One session's `query()` options, on a variant holding the given values. */
const queried = async (preset: Record<string, unknown>): Promise<Record<string, unknown>> => {
  sdk.options = [];
  sdk.flags = [];
  createSession({
    uri: 'ahp-session:/declared',
    chatUri: 'ahp-chat:/declared',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-declared-')),
    emit: () => {},
    preset,
  });
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

it('turns a sandbox value into the flag settings layer, and default into nothing', () => {
  expect(sandbox.toQuery?.('on')).toEqual({ settings: { sandbox: { enabled: true } } });
  expect(sandbox.toQuery?.('off')).toEqual({ settings: { sandbox: { enabled: false } } });
  expect(sandbox.toQuery?.('default')).toEqual({});
});

it('turns a thinking value into the query option the SDK takes', () => {
  expect(thinking.toQuery?.('adaptive')).toEqual({ thinking: { type: 'adaptive' } });
  expect(thinking.toQuery?.('disabled')).toEqual({ thinking: { type: 'disabled' } });
  expect(thinking.toQuery?.('sideways')).toEqual({});
});

it('lays env over the daemon own, and adds the extra CLI arguments as they were written', () => {
  expect(env.toQuery?.({ ANTHROPIC_MODEL: 'claude-opus-5' })).toEqual({ env: { ...process.env, ANTHROPIC_MODEL: 'claude-opus-5' } });
  expect(env.toQuery?.({})).toEqual({});
  expect(extraArgs.toQuery?.({ 'permission-prompt-tool': null, 'settings': '{"a":1}' }))
    .toEqual({ extraArgs: { 'permission-prompt-tool': null, settings: '{"a":1}' } });
});

it('leaves the output style to the flag settings, which the CLI takes live', () => {
  expect(outputStyle.toFlags?.('concise')).toEqual({ outputStyle: 'concise' });
  expect(outputStyle.toFlags?.('')).toEqual({});
  // Nowhere in the options the query is built from: the CLI reads it live.
  expect(outputStyle.toQuery).toBeUndefined();
});

it('holds a preset to the declared fields, and names the one that does not hold', () => {
  expect(presetSchema({ sandbox: 'on', thinking: 'disabled', outputStyle: 'concise', env: { A: 'b' }, extraArgs: { flag: null } }, 'options.presets.work'))
    .toBeUndefined();
  expect(presetSchema({ temperature: 1 }, 'options.presets.work'))
    .toBe('options.presets.work.temperature is not an option a preset holds');
  expect(presetSchema({ sandbox: 'maybe' }, 'options.presets.work'))
    .toBe('options.presets.work.sandbox is not one of default, on, off');
  expect(presetSchema({ env: 'A=b' }, 'options.presets.work'))
    .toBe('options.presets.work.env is not an object');
});

it('says what an option is when nothing named one', () => {
  expect(optionDefaults()).toEqual({ thinking: 'adaptive' });
});

it('builds a session query from the declared values of its preset', async () => {
  const options = await queried({ sandbox: 'on', thinking: 'disabled', outputStyle: 'concise' });
  expect(options.settings).toEqual({ sandbox: { enabled: true } });
  expect(options.thinking).toEqual({ type: 'disabled' });
  // The style is not an option of the query; it waits for the handshake.
  await settle();
  expect(sdk.flags).toContainEqual({ outputStyle: 'concise' });
});

it('leaves the sandbox layer out when nobody asked for one', async () => {
  expect((await queried({ sandbox: 'default' })).settings).toBeUndefined();
});
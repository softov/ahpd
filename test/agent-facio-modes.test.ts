import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createFakeModel } from '@facio/agents/testing';
import type { ModelAdapter } from '@facio/agents';
import type { Agent, Bag, BoundTool, Session, Start } from '@ahpd/sdk';
import { EFFORT_LEVELS, PERMISSION_MODES, effortOf, facioAgent, modelOf } from '../packages/agent-facio/src/index.js';

/*
 * The two controls a window draws beyond the text fields.
 *
 * A client draws a mode picker and a thinking level only when the backend
 * advertises them, and only when the value would be honoured: an embedder's
 * policy is the run-level authority, and a caller's adapter is the model. So
 * these check the schema, and then that each mode is really the run's policy
 * and each level is really in the request.
 */

/** Let the run's zero-delay work finish, up to a point. */
const until = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

type Note = { channel: 'session' | 'chat' | 'terminal'; action: Bag };

/** One session's channels, collected the way the host would dispatch them. */
function channels() {
  const notes: Note[] = [];
  return {
    notes,
    emit: (channel: 'session' | 'chat' | 'terminal', action: Bag): void => { notes.push({ channel, action }); },
    types: (channel: string): string[] =>
      notes.filter((one) => one.channel === channel).map((one) => String(one.action.type)),
  };
}

const ended = (view: ReturnType<typeof channels>): boolean =>
  view.types('chat').some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error');

const asked = (view: ReturnType<typeof channels>): boolean => view.types('session').includes('session/inputNeededSet');

/** A directory a session can call its workspace. */
const place = (): string => mkdtempSync(join(tmpdir(), 'ahpd-facio-modes-'));

/** The interface a session may be told, as a map a test can read. */
const properties = (agent: Agent): Record<string, Bag> =>
  (agent.schema() as Bag).properties as Record<string, Bag>;

/** A host tool that writes, so a mode has something to decide about. */
const writing = (ran: string[]): BoundTool => ({
  definition: {
    name: 'write_file',
    title: 'Write a file',
    description: 'Writes a file.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  effects: { writes: true },
  run: (input) => {
    ran.push(String(input.path));
    return 'written';
  },
});

/**
 * One turn that calls the writing tool, under one mode.
 *
 * Answers what the tool was asked to write, and whether the run stopped to ask
 * a person instead - which is the difference a mode makes.
 */
async function turn(mode: string | undefined, path = 'a.txt') {
  const ran: string[] = [];
  const model = createFakeModel({
    script: [
      { toolCalls: [{ name: 'write_file', input: { path }, callId: 'c1' }] },
      { text: 'done' },
    ],
    stream: true,
  });
  const agent = facioAgent({ adapter: model, memory: true });
  const view = channels();
  const session: Session = agent.create({
    uri: 'ahp-session:/modes',
    chatUri: 'ahp-chat:/modes',
    settings: { ...agent.defaults(), ...(mode === undefined ? {} : { permissionMode: mode }) },
    workingDirectory: place(),
    schema: () => agent.schema(),
    emit: view.emit,
    tools: [writing(ran)],
  } as unknown as Start);
  session.begin('t1', 'write it');
  await until(() => ended(view) || asked(view));
  // A paused run is stopped rather than left waiting on a person who is not there.
  if (asked(view)) session.close();
  return { view, ran };
}

it('advertises an approvals mode and a thinking level, in the window own names', () => {
  const props = properties(facioAgent({}));
  expect(Object.keys(props)).toEqual(['model', 'baseUrl', 'instructions', 'permissionMode', 'effortLevel']);
  expect(props.permissionMode).toMatchObject({ scope: 'session', sessionMutable: true, default: 'auto' });
  expect(props.permissionMode?.enum).toEqual([...PERMISSION_MODES]);
  expect((props.permissionMode?.enumLabels as string[]).length).toBe(PERMISSION_MODES.length);
  expect((props.permissionMode?.enumDescriptions as string[]).length).toBe(PERMISSION_MODES.length);
  expect(props.effortLevel).toMatchObject({ scope: 'chat', sessionMutable: true, default: 'off' });
  expect(props.effortLevel?.enum).toEqual([...EFFORT_LEVELS]);
});

it('omits a control this backend would not honour', () => {
  const withPolicy = facioAgent({ policy: { decide: () => ({ behavior: 'allow' }) } });
  expect(Object.keys(properties(withPolicy))).not.toContain('permissionMode');
  expect(Object.keys(properties(withPolicy))).toContain('effortLevel');

  const stub = { id: 'stub', modelId: 'stub', features: {} } as unknown as ModelAdapter;
  const withAdapter = facioAgent({ adapter: stub });
  expect(Object.keys(properties(withAdapter))).toContain('permissionMode');
  expect(Object.keys(properties(withAdapter))).not.toContain('effortLevel');
});

it('runs a write under auto, which is the default, and under bypassPermissions', async () => {
  const chosen = await turn(undefined);
  expect(chosen.ran).toEqual(['a.txt']);
  expect(asked(chosen.view)).toBe(false);

  const auto = await turn('auto');
  expect(auto.ran).toEqual(['a.txt']);
  expect(asked(auto.view)).toBe(false);

  const bypass = await turn('bypassPermissions');
  expect(bypass.ran).toEqual(['a.txt']);
  expect(asked(bypass.view)).toBe(false);
});

it('asks before a write under default, and refuses it under plan and dontAsk', async () => {
  const ask = await turn('default');
  expect(ask.ran).toEqual([]);
  expect(asked(ask.view)).toBe(true);

  const plan = await turn('plan');
  expect(plan.ran).toEqual([]);
  expect(asked(plan.view)).toBe(false);
  expect(ended(plan.view)).toBe(true);

  const dont = await turn('dontAsk');
  expect(dont.ran).toEqual([]);
  expect(asked(dont.view)).toBe(false);
  expect(ended(dont.view)).toBe(true);
});

it('lets acceptEdits write inside the workspace and asks outside it', async () => {
  const inside = await turn('acceptEdits', 'a.txt');
  expect(inside.ran).toEqual(['a.txt']);
  expect(asked(inside.view)).toBe(false);

  const outside = join(place(), 'elsewhere.txt');
  const away = await turn('acceptEdits', outside);
  expect(away.ran).toEqual([]);
  expect(asked(away.view)).toBe(true);
});

it('off and an unknown level send no reasoning, a chosen one sends it', () => {
  expect(effortOf('off')).toBeUndefined();
  expect(effortOf(undefined)).toBeUndefined();
  expect(effortOf('extreme')).toBeUndefined();
  expect(effortOf('high')).toBe('high');
});

/*
 * The level in the request itself, over the harness configuration, so the
 * adapter is the one a real session builds.
 */

let home: string;
let had: string | undefined;
let real: typeof fetch;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-facio-effort-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  real = globalThis.fetch;
});

afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  globalThis.fetch = real;
  rmSync(home, { recursive: true, force: true });
});

/** What the endpoint was sent for a session with these settings. */
const sent = async (settings: Record<string, unknown>): Promise<Record<string, unknown>> => {
  mkdirSync(join(home, 'facio'), { recursive: true });
  writeFileSync(join(home, 'facio', 'config.json'), JSON.stringify({
    providers: [{ id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }],
    model: 'open_router/deepseek/deepseek-chat',
  }));
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: unknown, init?: { body?: string }) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  await modelOf({}, settings).complete({ instructions: 'x', messages: [], tools: [] } as never);
  return body;
};

it('puts the chosen thinking level in the request and nothing for off', async () => {
  expect((await sent({ effortLevel: 'high' })).reasoning_effort).toBe('high');
  expect('reasoning_effort' in await sent({ effortLevel: 'off' })).toBe(false);
  expect('reasoning_effort' in await sent({})).toBe(false);
});

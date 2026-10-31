import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Engine } from '../../sdk/src/types/index.js';
import type { Bag, PluginHost, Start } from '../../sdk/src/types/index.js';

/*
 * The plugin loads without importing pi.
 *
 * Both of pi's packages are replaced by modules whose import does not finish
 * until a case lets it, and each counts how often it was imported. So a module
 * that imported pi when it loaded would hang here, and one that imported it
 * twice would say so.
 */

const gate = vi.hoisted(() => {
  let release: () => void = () => {};
  const opened = new Promise<void>((done) => { release = done; });
  return { opened, release: () => { release(); }, imports: { coding: 0, ai: 0 }, listed: 0 };
});

vi.mock('@earendil-works/pi-coding-agent', async () => {
  gate.imports.coding += 1;
  await gate.opened;
  let listener: ((event: Bag) => void) | undefined;
  const session = {
    sessionId: 'pi-lazy-1',
    sessionManager: { getSessionFile: () => '/tmp/pi/pi-lazy-1.jsonl', getLeafId: () => 'entry-1', getBranch: () => [] },
    modelRuntime: { getAvailable: async () => [], getProviders: () => [] },
    subscribe: (one: (event: Bag) => void) => { listener = one; return () => { listener = undefined; }; },
    prompt: async () => { listener?.({ type: 'agent_settled', aborted: false }); },
    steer: async () => 'queued',
    abort: async () => {},
    model: undefined,
    thinkingLevel: 'off',
    dispose: () => {},
  };
  return {
    SessionManager: {
      list: async () => { gate.listed += 1; return []; },
      findById: (_cwd: string, id: string) => `/tmp/pi/${id}.jsonl`,
      open: () => ({}),
      create: () => ({}),
    },
    // pi's own per-line parse, which `loadPi` takes from the module whether or
    // not a suite reads a session file through it.
    parseSessionEntries: (content: string) => content
      .split('\n')
      .filter((line: string) => line.trim() !== '')
      .flatMap((line: string) => { try { return [JSON.parse(line)]; } catch { return []; } }),
    SettingsManager: { create: () => ({}) },
    createAgentSessionServices: async () => ({}),
    createAgentSessionFromServices: async () => ({ session }),
    defineTool: (tool: unknown) => tool,
    ModelRuntime: { create: async () => ({ getAvailable: async () => [] }) },
    getAgentDir: () => '/nonexistent/pi-agent',
  };
});

vi.mock('@earendil-works/pi-ai', async () => {
  gate.imports.ai += 1;
  await gate.opened;
  return {
    getSupportedThinkingLevels: () => ['off'],
    Type: { Unsafe: (schema: unknown) => schema },
  };
});

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-pi-lazy-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const within = <T>(work: Promise<T>, ms: number): Promise<T | 'timed out'> =>
  Promise.race([work, new Promise<'timed out'>((done) => { setTimeout(() => { done('timed out'); }, ms); })]);

const settled = async (): Promise<void> => { await new Promise((done) => { setTimeout(done, 5); }); };

it('applies without waiting for pi, imports it once for the first list and session, and answers stateFile once it has loaded', async () => {
  // A module that imported pi when it loaded never finishes, so this waits
  // only as long as a cold import of the plugin can take on a slow runner.
  const entry = await within(import('../src/index.js'), WAIT_MS);
  expect(entry).not.toBe('timed out');
  if (entry === 'timed out') return;

  // The plugin registers the engine `pi`, and the agent a case drives is one
  // record of it: nothing is registered as an agent by the load.
  const engines: Record<string, Engine> = {};
  const host = {
    paths: [root],
    registerEngine: (engine: Engine) => { engines[engine.name] = engine; },
  } as unknown as PluginHost;
  expect(await within(Promise.resolve(entry.apply(host, {})), 500)).not.toBe('timed out');
  const engine = engines['pi'];
  if (engine === undefined) throw new Error('no pi engine was registered');
  const agent = engine.open({
    id: 'pi-lazy',
    engine: 'pi',
    owner: 'host',
    name: 'pi',
    description: undefined,
    icon: undefined,
    model: undefined,
    config: {},
  });

  // Held: pi has not loaded, so the file pi keeps is not known yet.
  expect(agent.stateFile?.('pi-lazy-1', root)).toBeUndefined();

  let listed = false;
  const listing = agent.list!().then((rows) => { listed = true; return rows; });
  const sent: Bag[] = [];
  const session = await agent.create({
    uri: 'ahp-session:/lazy',
    chatUri: 'ahp-chat:/lazy',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: (_channel: string, action: Bag) => { sent.push(action); },
  } as Start);
  session.begin('t1', 'hello');
  await settled();
  expect(listed).toBe(false);
  expect(sent.map((one) => one.type)).not.toContain('chat/turnComplete');

  gate.release();
  expect(await listing).toEqual([]);
  await settled();
  expect(sent.map((one) => one.type)).toContain('chat/turnComplete');
  expect(gate.listed).toBe(1);
  expect(gate.imports).toEqual({ coding: 1, ai: 1 });

  // Loaded: the same question now has pi's answer.
  expect(agent.stateFile?.('pi-lazy-1', root)).toBe('/tmp/pi/pi-lazy-1.jsonl');
  session.close();
});

/*
 * Every first-party schema, walked for a value a client cannot draw.
 *
 * A client draws a form from each schema the host sends: a plugin's options, an
 * engine record, a connector, an action's input, a trigger and the session
 * config. An object that names no properties, an array with no items or a field
 * with no type is drawn as `No parameters defined.` or `[object Object]`, and an
 * edit there can destroy the value. The check in `validate.ts` reports such a
 * hole as a problem line when a plugin registers it; this walks every schema the
 * first-party plugins and the host register, so a new hole cannot merge.
 *
 * A backend makes its session config schema when a record is opened rather than
 * registering it, so that schema is walked through `open` here, as
 * `resolveSessionConfig` is the one place a daemon can read it.
 *
 * The plugins load with a stub host that keeps what each `apply` registers.
 * Activepieces names only the pieces it ships and is given no configuration
 * folder, so no logo is fetched and the walk never reaches the network. Every
 * other plugin gets a temporary folder of its own, so nothing is written outside
 * one, and no daemon is started.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gapLine, pluginHost, schemaGaps } from '@ahpd/sdk';
import type { Agent, AgentView, Contribution, Engine, Plugin, SchemaGap } from '@ahpd/sdk';
import { apply as acp } from '../../agent-acp/src/plugin.js';
import { apply as claude } from '../../agent-claude/src/plugin.js';
import { apply as cofold } from '../../agent-cofold/src/plugin.js';
import { apply as pi } from '../../agent-pi/src/plugin.js';
import { apply as activepieces } from '../../activepieces/src/plugin.js';
import { apply as bot } from '../../bot/src/plugin.js';
import { apply as computer } from '../../computer/src/plugin.js';
import { apply as push } from '../../push/src/plugin.js';
import { apply as tasks } from '../../tasks/src/plugin.js';
import { apply as tunnel } from '../../tunnel-devtunnel/src/plugin.js';
import { apply as webhook } from '../../webhook/src/plugin.js';
import { configSchema, mcpServerSchema } from '../src/commands/options.js';
import { proxySchema } from '../src/proxy/providers.js';
import { readManifest } from '../src/plugins.js';

/** The packages this repository ships, which are the plugins a client draws from. */
const REPO = join(import.meta.dirname, '..', '..', '..');

/** The pieces the activepieces package ships. A piece that is not shipped would make `apply` install one. */
const PIECES = [
  '@activepieces/piece-airtable',
  '@activepieces/piece-discord',
  '@activepieces/piece-github',
  '@activepieces/piece-hubspot',
  '@activepieces/piece-jira-cloud',
  '@activepieces/piece-linear',
  '@activepieces/piece-notion',
  '@activepieces/piece-resend',
  '@activepieces/piece-sendgrid',
  '@activepieces/piece-slack',
  '@activepieces/piece-smtp',
  '@activepieces/piece-stripe',
  '@activepieces/piece-telegram-bot',
  '@activepieces/piece-whatsapp',
];

/** One plugin to load, and what its `apply` is given. */
interface Sample {
  /** The package's folder, which is where its manifest is. */
  readonly dir: string;
  /** The plugin's id, which is what a gap line names. */
  readonly name: string;
  /** Its `apply`. */
  readonly apply: Plugin['apply'];
  /** The options it is applied with. */
  readonly options?: Record<string, unknown>;
  /**
   * A configuration folder of `''` for activepieces, so a piece logo is never
   * fetched. Every other plugin gets a temporary folder.
   */
  readonly configDir?: string;
  /** What a record of its engine fills in, over the engine's template. */
  readonly record?: Record<string, unknown>;
}

/**
 * Every plugin this repository ships, in package order.
 *
 * cofold's record is a memory store, so opening the backend to read its schema
 * writes no session anywhere.
 */
const SAMPLES: Sample[] = [
  { dir: 'agent-acp', name: 'agent-acp', apply: acp },
  { dir: 'agent-claude', name: 'agent-claude', apply: claude },
  { dir: 'agent-cofold', name: 'agent-cofold', apply: cofold, record: { memory: true } },
  { dir: 'agent-pi', name: 'agent-pi', apply: pi },
  { dir: 'activepieces', name: 'activepieces', apply: activepieces, options: { pieces: PIECES }, configDir: '' },
  { dir: 'bot', name: 'bot', apply: bot },
  { dir: 'computer', name: 'computer', apply: computer },
  { dir: 'push', name: 'push', apply: push },
  { dir: 'tasks', name: 'tasks', apply: tasks },
  { dir: 'tunnel-devtunnel', name: 'tunnel-devtunnel', apply: tunnel },
  { dir: 'webhook', name: 'webhook', apply: webhook },
];

/** One line for each gap the walk found, in the wording the daemon uses. */
const gapsOf = (by: string, where: string, schema: unknown): string[] =>
  schemaGaps(schema).map((gap: SchemaGap) => gapLine(by, where, gap));

/** Where a plugin's schemas are, and what each one is called. */
interface Walked {
  /** The place a person reads, such as `engine claude`. */
  readonly where: string;
  /** The schema at that place. */
  readonly schema: unknown;
}

/** A record of one engine, filled in with what its template starts from. */
function viewOf(engine: Engine, extra: Record<string, unknown> = {}): AgentView {
  const template = engine.templates?.[0];
  return {
    id: `gap-${engine.name}`,
    engine: engine.name,
    owner: 'host',
    name: 'Gap test',
    description: undefined,
    icon: undefined,
    model: undefined,
    config: { ...template?.config, ...extra },
  };
}

/** The backend a record of one engine opens, with its own template as the record. */
function agentOf(engine: Engine, extra: Record<string, unknown> = {}): Agent {
  try {
    return engine.open(viewOf(engine, extra));
  }
  catch (error) {
    throw new Error(`engine ${engine.name} refused a record of its own template: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Every schema one plugin registered, and the place a gap in it is named by.
 *
 * The names are the ones `validate.ts` reports a registration under, so a
 * failure here reads like the daemon's own problem line.
 */
function walkedOf(contribution: Contribution, record: Record<string, unknown> | undefined): Walked[] {
  const walked: Walked[] = [];
  for (const [name, engine] of Object.entries(contribution.engines ?? {})) {
    walked.push({ where: `engine ${name}`, schema: engine.schema });
    // The session config schema a backend makes, which no registration carries.
    walked.push({ where: `session config of engine ${name}`, schema: agentOf(engine, record).schema() });
  }
  for (const [name, adapter] of Object.entries(contribution.adapters)) {
    walked.push({ where: `adapter ${name}`, schema: adapter.schema });
    for (const capability of adapter.capabilities) {
      if (capability.input === undefined) continue;
      walked.push({ where: `adapter ${name} capability ${capability.name} input`, schema: capability.input });
    }
  }
  for (const [type, definition] of Object.entries(contribution.triggers.types)) {
    walked.push({ where: `trigger ${type}`, schema: definition.configSchema });
  }
  for (const [key, schema] of Object.entries(contribution.sessionConfig)) {
    walked.push({ where: `session config ${key}`, schema });
  }
  for (const agent of contribution.agents) {
    walked.push({ where: `agent ${agent.provider}`, schema: agent.schema() });
  }
  return walked;
}

/** What one plugin kept and what it registered, once its apply returned. */
interface Loaded {
  readonly contribution: Contribution;
  readonly problems: string[];
  readonly alerts: string[];
}

/** What each plugin registered, by its id. */
const loaded = new Map<string, Loaded>();

/** The folders this file made, removed once it ends. */
const folders: string[] = [];

beforeAll(async () => {
  /*
   * cofold reads the harness's own configuration when a backend opens, and a
   * developer's file would make this walk depend on the machine. A file named
   * and not there answers no providers, which is what a machine that never ran
   * the harness has.
   */
  vi.stubEnv('PAPO_CONFIG', join(tmpdir(), 'ahpd-schema-gaps-no-papo.json'));

  for (const sample of SAMPLES) {
    const configDir = sample.configDir
      ?? mkdtempSync(join(tmpdir(), `ahpd-schema-gaps-${sample.name}-`));
    if (configDir !== '') folders.push(configDir);

    const problems: string[] = [];
    const alerts: string[] = [];
    const held = pluginHost(sample.name, {
      path: configDir,
      paths: [configDir],
      version: '0.0.0',
      hostName: 'schema-gaps',
      configDir,
      log: () => {},
      say: () => {},
    }, {
      alert: (alert) => { alerts.push(alert.text); },
      records: () => undefined,
      sessions: () => undefined,
    });

    await sample.apply(held.host, sample.options ?? {});
    held.seal();
    loaded.set(sample.name, { contribution: held.contribution, problems, alerts });
  }
}, 120_000);

afterAll(async () => {
  for (const one of loaded.values()) {
    for (const close of one.contribution.closers) await close();
  }
  vi.unstubAllEnvs();
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe('every shipped plugin names every value of its manifest', () => {
  for (const sample of SAMPLES) {
    it(`${sample.name} has an optionsSchema, and no gap in it`, () => {
      const manifest = readManifest(join(REPO, 'packages', sample.dir));

      expect(manifest.problem).toBeUndefined();
      expect(manifest.optionsSchema).toBeTypeOf('object');
      expect(gapsOf(sample.name, 'options', manifest.optionsSchema)).toEqual([]);
    });
  }
});

describe('every schema a first-party plugin registers names every value', () => {
  for (const sample of SAMPLES) {
    it(`${sample.name} has no gap in any schema its apply registers`, () => {
      const one = loaded.get(sample.name);
      if (one === undefined) throw new Error(`${sample.name} was not loaded`);

      const lines = walkedOf(one.contribution, sample.record).flatMap((place) => gapsOf(sample.name, place.where, place.schema));
      expect(lines).toEqual([]);
    });
  }
});

describe('every vault field a first-party plugin draws says secret', () => {
  /*
   * The host still reads `writeOnly` as a vault field, and the load says so
   * with one warning line. A first-party plugin that still marked a field that
   * way would carry that line at every start, so none may.
   */
  for (const sample of SAMPLES) {
    it(`${sample.name} gives no line saying to mark a vault field secret`, () => {
      const one = loaded.get(sample.name);
      if (one === undefined) throw new Error(`${sample.name} was not loaded`);

      expect(one.alerts.filter((text) => text.includes('writeOnly kept in the vault'))).toEqual([]);
    });
  }
});

describe('every schema the host draws names every value', () => {
  it('has no gap in the daemon config, an MCP server or the proxy', () => {
    expect([
      ...gapsOf('ahpd', 'config', configSchema),
      ...gapsOf('ahpd', 'mcp server', mcpServerSchema),
      ...gapsOf('ahpd', 'model proxy', proxySchema),
    ]).toEqual([]);
  });
});

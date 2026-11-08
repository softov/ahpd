import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { uriOf } from '../src/resources/fileuri.js';
import { questionOf, questioning } from './support/questions.js';
import type { CommandSplit, CommandSplitter } from '../src/access/commandautoapprover.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';
import type { Users } from '../src/types/users.js';

/*
 * The parser a session's command lines are read with, and where it comes from.
 *
 * `HostOptions.commandParser` is the port the sdk's splitter fills by default.
 * A host given one reads every line with it, and a parser that throws or
 * answers something that is not a `CommandSplit` is read as a line nobody could
 * read, which asks.
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-commandparser-'));
const RESOURCE = 'ahpd://users';

/** A directory that knows one admin, by the token it presents. */
const directory = (): Users => ({
  resource: { resource: RESOURCE, resource_name: 'ahpd users', authorization_servers: [RESOURCE], required: false },
  verify: async (token) => (token === 'admin' ? { id: 'ana', roles: ['admin'], can: () => true } : undefined),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'admin',
});

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** Let the dispatch, its echo and the write behind it come to. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/**
 * A host with a people directory and one signed-in window, given some options
 * of its own, and whether the host's approval chain approved a command line a
 * question of its backend put, which it reads with the parser.
 */
function serving(extra: Partial<HostOptions> = {}) {
  const backend = questioning(DIR);
  const host = createHost({ path: DIR, agents: [backend.agent], users: directory(), terminalAutoApproveDefaults: 'vscode', ...extra });
  const p = peer();
  const client: Client = host.accept(p);
  const uri = 'ahp-session:/ana-one';
  // The default chat the host mints for the session, read once it is made.
  let chat = '';
  let turns = 0;
  /** Whether the host answered a question about the line with nobody asked. */
  const approved = async (line: string): Promise<boolean> => {
    turns += 1;
    const turnId = `q${turns}`;
    backend.ask('bash', { permissionKind: 'shell', shellCommand: line, shellLanguage: 'bash' });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } },
    });
    await settle();
    return questionOf(p.notes, turnId) === undefined && backend.answerOf(turnId) === true;
  };
  const opening = async (): Promise<void> => {
    await client.handle({
      method: 'initialize',
      params: { clientId: 'ana', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
    });
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RESOURCE, token: 'admin' } });
    // Two commands are approved by the window's table, so a parser's answer and
    // the default's are told apart by what comes back.
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { terminalAutoApproveRules: { 'ls -la': true, 'make test': true } } } },
    });
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(DIR)] },
    });
    chat = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    await settle();
  };
  return { approved, opening };
}

/** The reading a parser answers for one line. */
const split = (subCommands: string[]): CommandSplit => ({ subCommands, writeDests: [], unanalyzable: false });

/** A plugin's own context, with nothing outside this file reached. */
const context = (): LoaderContext => ({
  path: DIR,
  paths: [DIR],
  version: '0.0.0',
  hostName: 'host',
  configDir: DIR,
  log: () => {},
  say: () => {},
});

it('reads a line with the parser the options name, not the sdk\'s splitter', async () => {
  const seen: { line: string; shell: string }[] = [];
  const parser: CommandSplitter = (line, shell) => {
    seen.push({ line, shell });
    return line === 'make test' ? split(['make test']) : undefined;
  };
  const { approved, opening } = serving({ commandParser: parser });
  await opening();

  // The table approves both, and the parser reads only one of them: a line it
  // refuses is a line that asks, though the default splitter would have read it.
  expect(await approved('make test')).toBe(true);
  expect(await approved('ls -la')).toBe(false);
  expect(new Set(seen.map((one) => JSON.stringify(one)))).toEqual(new Set([
    JSON.stringify({ line: 'make test', shell: 'bash' }),
    JSON.stringify({ line: 'ls -la', shell: 'bash' }),
  ]));
});

it('asks when the parser throws, though the table approves the line', async () => {
  const parser: CommandSplitter = () => {
    throw new Error('no reading today');
  };
  const { approved, opening } = serving({ commandParser: parser });
  await opening();

  expect(await approved('make test')).toBe(false);
});

it('asks when the parser answers something that is not a CommandSplit', async () => {
  const parser = ((): unknown => ({ subCommands: ['make test'] })) as CommandSplitter;
  const { approved, opening } = serving({ commandParser: parser });
  await opening();

  expect(await approved('make test')).toBe(false);
});

it('reads with the parser a plugin registered, once the fold has named the port', async () => {
  const parser: CommandSplitter = (line) => (line === 'make test' ? split(['make test']) : undefined);
  const owner = pluginHost('alpha', context());
  owner.host.registerCommandParser(parser);

  const folded = foldHostOptions({ path: DIR, agents: [] }, [owner.contribution]);
  expect(folded.problems).toEqual([]);
  expect(folded.options.commandParser).toBe(parser);
  const read = folded.options.commandParser;
  if (read === undefined) throw new Error('the fold dropped the parser');

  const { approved, opening } = serving({ commandParser: read });
  await opening();
  expect(await approved('make test')).toBe(true);
  // The default splitter would have read this one, and the plugin's refuses it.
  expect(await approved('ls -la')).toBe(false);
});

it('refuses a parser that is not a function, naming the plugin and the method', () => {
  const { host } = pluginHost('alpha', context());
  expect(() => host.registerCommandParser('nope' as never)).toThrow(/alpha.*registerCommandParser.*commandParser.*function/);
});

it('refuses one plugin registering a parser twice', () => {
  const { host } = pluginHost('alpha', context());
  host.registerCommandParser(() => undefined);
  expect(() => host.registerCommandParser(() => undefined)).toThrow(/alpha.*commandParser.*registered only once/);
});

it('keeps the first parser when a second plugin sets the port without replace', () => {
  const first: CommandSplitter = () => undefined;
  const second: CommandSplitter = () => undefined;
  const one = pluginHost('alpha', context());
  one.host.registerCommandParser(first);
  const two = pluginHost('beta', context());
  two.host.registerCommandParser(second);

  const { options, problems } = foldHostOptions({ path: DIR, agents: [] }, [one.contribution, two.contribution]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('alpha');
  expect(problems[0]).toContain('beta');
  expect(problems[0]).toContain('commandParser');
  expect(problems[0]).toContain("'replace'");
  expect(options.commandParser).toBe(first);
});

it('lets a second plugin take the first parser over with replace', () => {
  const first: CommandSplitter = () => undefined;
  const second: CommandSplitter = () => undefined;
  const one = pluginHost('alpha', context());
  one.host.registerCommandParser(first);
  const two = pluginHost('beta', context());
  two.host.registerCommandParser(second, 'replace');

  const { options, problems } = foldHostOptions({ path: DIR, agents: [] }, [one.contribution, two.contribution]);
  expect(problems).toEqual([]);
  expect(options.commandParser).toBe(second);
});

/*
 * The configuration file, held to the schema the flags are declared with.
 *
 * A wrong value on a key the daemon knows refuses the start with a sentence
 * naming the file and the key; a key it does not know is named on one line and
 * the run goes on. The cases read a file in a temporary directory, so none of
 * them reads the configuration of whoever runs the suite.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { configSchema, flagFields, optionsFrom, serverFields } from '../src/commands/options.js';
import type { Config } from '../src/config.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = './packages/server/test/fixtures/plugin-echo';

let home: string;
let config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-config-check-'));
  config = join(home, 'config.json');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const put = (value: unknown): void => { writeFileSync(config, JSON.stringify(value)); };

/** The options a run would take with this file under no flags. */
const folded = (value: unknown) => {
  put(value);
  return optionsFrom({ configFile: config });
};

/** What refusing this file said, or the case fails for the file being accepted. */
const refusal = (value: unknown): string => {
  try {
    folded(value);
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${JSON.stringify(value)} was accepted`);
};

describe('a wrong value on a known key', () => {
  it('refuses an integer given as a string, naming the file and the key', () => {
    expect(refusal({ port: '8080' })).toBe(`${config}: port must be an integer`);
  });

  it('refuses a number where text goes', () => {
    expect(refusal({ host: 5 })).toBe(`${config}: host must be text`);
  });

  it('refuses a value outside an enum', () => {
    expect(refusal({ automations: 'disk' })).toBe(`${config}: automations must be one of file, memory`);
    expect(refusal({ sessions: 'disk' })).toBe(`${config}: sessions must be one of file, memory`);
    // A way of checking tokens this host does not have, refused rather than
    // taken as the default: an operator who misspelled `jwt` meant it. Anything
    // off the list reads the same way, the words named before the type.
    expect(refusal({ issuerVerify: 'keys' })).toBe(`${config}: issuerVerify must be one of userinfo, jwt, auto`);
    expect(refusal({ issuerVerify: 5 })).toBe(`${config}: issuerVerify must be one of userinfo, jwt, auto`);
    // Two tables there are: VS Code's, and the one with nothing in it.
    expect(refusal({ terminalAutoApproveDefaults: 'all' })).toBe(`${config}: terminalAutoApproveDefaults must be one of vscode, none`);
  });

  it('refuses a boolean given as a string', () => {
    expect(refusal({ requireIssuer: 'yes' })).toBe(`${config}: requireIssuer must be true or false`);
  });

  it('refuses a tokens per person that is not a whole number of 0 or more', () => {
    expect(refusal({ tokensPerPerson: -1 })).toBe(`${config}: tokensPerPerson must be an integer >= 0`);
    expect(refusal({ tokensPerPerson: 2.5 })).toBe(`${config}: tokensPerPerson must be an integer >= 0`);
    expect(refusal({ tokensPerPerson: '3' })).toBe(`${config}: tokensPerPerson must be an integer >= 0`);
  });

  it('refuses a string where a list of strings goes', () => {
    expect(refusal({ paths: '/work' })).toBe(`${config}: paths must be a list of text`);
  });

  it('refuses an httpApi.port out of range, naming the nested key', () => {
    expect(refusal({ httpApi: { port: 70000 } })).toBe(`${config}: httpApi.port must be an integer between 0 and 65535`);
  });

  it('refuses a delta window longer than a second, and one that is not a whole number', () => {
    expect(refusal({ deltaWindowMs: 1001 })).toBe(`${config}: deltaWindowMs must be an integer between 0 and 1000`);
    expect(refusal({ deltaWindowMs: 7.5 })).toBe(`${config}: deltaWindowMs must be an integer between 0 and 1000`);
  });

  it('refuses an httpApi that is neither a switch nor an object', () => {
    expect(refusal({ httpApi: 'on' })).toContain(`${config}: httpApi must be`);
  });

  it('refuses an httpApi.host that names no address', () => {
    expect(refusal({ httpApi: { port: 0, host: '' } })).toContain(`${config}: httpApi.host must be text matching ^\\S+$`);
  });

  it('refuses a usage.per that is neither a turn nor a report', () => {
    expect(refusal({ usage: { per: 'session' } })).toBe(`${config}: usage.per must be one of turn, report`);
  });

  it('takes a usage.timezone as a string, and refuses one that is not', () => {
    expect(refusal({ usage: { timezone: 3 } })).toBe(`${config}: usage.timezone must be text`);
    expect(refusal({ usage: { timezone: null } })).toBe(`${config}: usage.timezone must be text`);
  });

  it('reads the zone onto the options, and leaves it absent when the file names none', () => {
    // Which zone it names is not checked here: a runtime that cannot read one
    // says so where the periods are cut, and uses the system's own.
    expect(folded({ usage: { timezone: 'Asia/Tokyo' } }).usageTimezone).toBe('Asia/Tokyo');
    expect(folded({ usage: {} }).usageTimezone).toBeUndefined();
    expect(folded({}).usageTimezone).toBeUndefined();
  });

  it('reads the delta window onto the options, and leaves it absent when the file names none', () => {
    expect(folded({ deltaWindowMs: 0 }).deltaWindowMs).toBe(0);
    expect(folded({ deltaWindowMs: 75 }).deltaWindowMs).toBe(75);
    // Absent rather than defaulted here, because the host's own 75 milliseconds
    // is the same answer and one place should hold it.
    expect(folded({}).deltaWindowMs).toBeUndefined();
  });

  it('reads the default rules from the file, and VS Code\'s table when it names none', () => {
    expect(folded({ terminalAutoApproveDefaults: 'none' }).terminalAutoApproveDefaults).toBe('none');
    expect(folded({ terminalAutoApproveDefaults: 'vscode' }).terminalAutoApproveDefaults).toBe('vscode');
    // Defaulted here rather than left off, because `vscode` is what the key
    // means when the deployment said nothing.
    expect(folded({}).terminalAutoApproveDefaults).toBe('vscode');
  });

  it('refuses httpApi.host without httpApi.port', () => {
    expect(refusal({ httpApi: { host: '127.0.0.1' } })).toContain('httpApi.host');
    expect(refusal({ httpApi: { host: '127.0.0.1' } })).toContain('httpApi.port');
  });

  it('refuses a plugins entry that is not a spec', () => {
    expect(refusal({ plugins: [3] })).toContain(`${config}: plugins must be`);
    expect(refusal({ plugins: [{ options: {} }] })).toBe(`${config}: plugins[0].source is required`);
    expect(refusal({ plugins: [{ source: 'x', enabled: 'no' }] })).toBe(`${config}: plugins.enabled must be true or false`);
    expect(refusal({ plugins: [{ name: 'x', enabled: 'no' }] })).toBe(`${config}: plugins.enabled must be true or false`);
  });

  it('reads the old `name` form and the `source` form alike', () => {
    expect(folded({ plugins: [{ name: 'x' }] }).plugins).toEqual([{ source: 'x' }]);
    expect(folded({ plugins: [{ source: 'x' }] }).plugins).toEqual([{ source: 'x' }]);
    expect(folded({ plugins: [{ source: 'x', name: 'Foo' }] }).plugins).toEqual([{ source: 'x', name: 'Foo' }]);
  });

  it('refuses grants that are not a list of text', () => {
    // The shape is checked before the grammar is: a list holding a number is
    // refused as a schema, while one holding a word that names nothing is read
    // and dropped by the loader, which is the one that can say what is wrong
    // with the word.
    expect(refusal({ plugins: [{ name: 'x', grants: 'session:write' }] })).toBe(`${config}: plugins.grants must be a list of text`);
    expect(refusal({ plugins: [{ name: 'x', grants: [7] }] })).toBe(`${config}: plugins.grants must be text`);
  });

  it('refuses a value that was dropped before, rather than falling back to the default', () => {
    expect(refusal({ updateCheck: 'false' })).toBe(`${config}: updateCheck must be true or false`);
  });
});

describe('an unknown key', () => {
  it('is warned about with the file and the key, and the rest is read', () => {
    const options = folded({ plugin: [], port: 1234 });
    expect(options.warnings).toEqual([`${config}: plugin is not a setting ahpd knows; ignored`]);
    expect(options.port).toBe(1234);
  });

  it('names a flag that only means something typed', () => {
    expect(folded({ stdio: true }).warnings).toEqual([`${config}: stdio is not a setting ahpd knows; ignored`]);
    expect(folded({ stdio: true }).stdio).toBe(false);
  });

  it('is not confused with a property every object has', () => {
    expect(folded({ constructor: 1 }).warnings).toEqual([`${config}: constructor is not a setting ahpd knows; ignored`]);
  });
});

describe('a valid file', () => {
  it('of every key is read, each under its flag', () => {
    const options = folded({
      port: 0,
      host: '127.0.0.1',
      paths: [home],
      connectionToken: 'secret',
      connectionTokenFile: join(home, 'token'),
      withoutConnectionToken: false,
      users: join(home, 'users.json'),
      resource: 'https://ahpd.test/',
      issuer: 'github',
      issuerVerify: 'jwt',
      requireIssuer: true,
      advancedTools: true,
      sessionTools: true,
      sessionToolsProviders: ['claude'],
      automations: 'memory',
      sessions: 'memory',
      usage: { per: 'report' },
      wire: join(home, 'wire.jsonl'),
      httpApi: { port: 0, host: '127.0.0.1' },
      plugins: ['a', { name: 'b', options: { x: 1 }, enabled: false }],
      updateCheck: false,
    });
    expect(options.warnings).toEqual([]);
    expect(options).toMatchObject({
      port: 0,
      host: '127.0.0.1',
      paths: [home],
      token: 'secret',
      tokenFile: join(home, 'token'),
      open: false,
      users: join(home, 'users.json'),
      resource: 'https://ahpd.test/',
      issuer: 'github',
      issuerVerify: 'jwt',
      requireIssuer: true,
      advancedTools: true,
      sessionTools: true,
      sessionToolsProviders: ['claude'],
      automations: 'memory',
      sessions: 'memory',
      usagePer: 'report',
      wire: join(home, 'wire.jsonl'),
      httpApi: { port: 0, host: '127.0.0.1' },
      plugins: ['a', { source: 'b', options: { x: 1 }, enabled: false }],
      updateCheck: false,
    });
  });

  it('takes httpApi true as the daemon\'s own listener and false as off', () => {
    expect(folded({ httpApi: true }).httpApi).toEqual({});
    expect(folded({ httpApi: false }).httpApi).toBeUndefined();
  });

  it('is under every flag that was typed', () => {
    put({ port: 1, automations: 'memory', paths: ['/from-file'], requireIssuer: true });
    const options = optionsFrom({ configFile: config, port: 2, automations: 'file', paths: ['/typed'], requireIssuer: false });
    expect(options).toMatchObject({ port: 2, automations: 'file', paths: ['/typed'], requireIssuer: false });
  });

  it('leaves the defaults where neither says anything', () => {
    const options = folded({});
    expect(options).toMatchObject({
      port: 9187, host: '127.0.0.1', open: false, requireIssuer: false, tokensPerPerson: 10, advancedTools: false, sessionTools: true, sessionToolsProviders: [], closedChats: 'hidden', archiveDirtyWorktree: 'keep', pullRequestLookup: 'url', terminalAutoApproveDefaults: 'vscode',
      automations: 'file', sessions: 'file', usagePer: 'turn', plugins: [], updateCheck: true, warnings: [],
    });
    // Absent rather than defaulted here, for the same reason: a host that says
    // nothing asks the issuer's userinfo, which is where it started.
    expect(folded({}).issuerVerify).toBeUndefined();
  });

  it('reads the tokens per person from the flag or the file, and gives ten when neither names one', () => {
    expect(folded({}).tokensPerPerson).toBe(10);
    expect(folded({ tokensPerPerson: 3 }).tokensPerPerson).toBe(3);
    expect(optionsFrom({ configFile: config, tokensPerPerson: 1 }).tokensPerPerson).toBe(1);
    // Zero is a host where nobody mints one, and is not the default.
    expect(folded({ tokensPerPerson: 0 }).tokensPerPerson).toBe(0);
  });

  it('serves the current folder, or only what is named under --no-cwd', () => {
    expect(folded({}).paths).toEqual([process.cwd()]);
    put({ paths: [home] });
    expect(optionsFrom({ configFile: config, noCwd: true }).paths).toEqual([home]);
    // Nothing named and nothing served would be a daemon with nothing to work in.
    put({});
    expect(() => optionsFrom({ configFile: config, noCwd: true })).toThrow(/--no-cwd serves only/u);
  });

  it('names the start folder only when nothing names a folder', () => {
    expect(folded({}).startFolder).toBe(process.cwd());
    expect(folded({ paths: [home] }).startFolder).toBeUndefined();
    put({});
    expect(optionsFrom({ configFile: config, paths: [home] }).startFolder).toBeUndefined();
  });
});

describe('the schema', () => {
  it('is built from the flags, so a new one is checked in the file too', () => {
    const keys = Object.keys(configSchema.properties);
    for (const key of Object.keys(serverFields)) {
      if (['stdio', 'configFile', 'noPlugins', 'noCwd', 'pluginOptions'].includes(key)) continue;
      expect(keys).toContain(key);
    }
  });

  it('gives httpApi no flag', () => {
    expect(Object.keys(flagFields)).not.toContain('httpApi');
    expect(Object.keys(serverFields)).toContain('httpApi');
  });

  it('gives usage no flag either', () => {
    expect(Object.keys(flagFields)).not.toContain('usage');
    expect(Object.keys(serverFields)).toContain('usage');
  });

  it('names the keys Config does', () => {
    expectTypeOf<keyof Config>().toEqualTypeOf<keyof typeof configSchema.properties>();
  });
});

describe('the origins key', () => {
  it('reads each origin from the file', () => {
    expect(folded({ origins: ['http://203.0.113.1:37537'] }).origins).toEqual(['http://203.0.113.1:37537']);
  });

  it('takes --origin over the file', () => {
    put({ origins: ['http://203.0.113.1:37537'] });
    expect(optionsFrom({ configFile: config, origins: ['https://ahpd.example.com/'] }).origins).toEqual(['https://ahpd.example.com']);
  });

  it('refuses an entry that is not an http or https origin, naming it', () => {
    for (const entry of ['ftp://x', 'http://x/path', 'x:37537', 'nonsense']) {
      const said = refusal({ origins: [entry] });
      expect(said).toContain(`${config} has origins entry ${JSON.stringify(entry)}`);
      expect(said).toContain('which is not an origin');
    }
  });
});

describe('the mcpServers key', () => {
  it('takes both shapes, by the name a person gave them', () => {
    const options = folded({
      mcpServers: {
        search: { type: 'stdio', command: 'mcp-search', args: ['--stdio'], env: { KEY: 'k-1' }, cwd: '/srv' },
        notes: { type: 'http', url: 'https://notes.test/mcp', headers: { Authorization: 'Bearer t-1' } },
      },
    });
    expect(options.warnings).toEqual([]);
    expect(options.mcpServers).toEqual({
      search: { type: 'stdio', command: 'mcp-search', args: ['--stdio'], env: { KEY: 'k-1' }, cwd: '/srv' },
      notes: { type: 'http', url: 'https://notes.test/mcp', headers: { Authorization: 'Bearer t-1' } },
    });
  });

  it('has no servers when the file names none', () => {
    expect(folded({}).mcpServers).toEqual({});
  });

  it('gives the key no flag', () => {
    expect(Object.keys(flagFields)).not.toContain('mcpServers');
    expect(Object.keys(serverFields)).toContain('mcpServers');
  });

  it('warns about an entry that is neither shape, and leaves it out', () => {
    const options = folded({ mcpServers: { sse: { type: 'sse', url: 'https://sse.test' }, ok: { type: 'http', url: 'https://ok.test' } } });
    expect(options.mcpServers).toEqual({ ok: { type: 'http', url: 'https://ok.test' } });
    expect(options.warnings).toEqual([`${config}: mcpServers.sse.type must be one of stdio, http`]);
  });

  it('warns about an entry with no type, or with nothing to reach it on', () => {
    expect(folded({ mcpServers: { a: { command: 'run' } } }).warnings)
      .toEqual([`${config}: mcpServers.a.type is required`]);
    expect(folded({ mcpServers: { a: { type: 'stdio' }, b: { type: 'http' } } }).warnings).toEqual([
      `${config}: mcpServers.a is a stdio server with no command; ignored`,
      `${config}: mcpServers.b is a http server with no url; ignored`,
    ]);
    expect(folded({ mcpServers: { a: { type: 'stdio' } } }).mcpServers).toEqual({});
  });

  it('refuses a value that is not a map of servers at all', () => {
    expect(refusal({ mcpServers: 'on' })).toBe(`${config}: mcpServers must be an object`);
  });

  it('reads the rest of the file whatever one entry says', () => {
    const options = folded({ port: 1234, mcpServers: { a: { type: 'stdio' } } });
    expect(options.port).toBe(1234);
    expect(options.warnings).toHaveLength(1);
  });
});

describe('the shellEnv key', () => {
  it('reads the map onto the options, as the operator wrote it', () => {
    const options = folded({ shellEnv: { XDG_CONFIG_HOME: '/home/me/.config', HOME: null } });
    expect(options.warnings).toEqual([]);
    // A null is kept as the file wrote it: it is how the file says remove
    // this variable, and reading it as absent would say nothing at all.
    expect(options.shellEnv).toEqual({ XDG_CONFIG_HOME: '/home/me/.config', HOME: null });
  });

  it('has no flag, because a map is not one', () => {
    expect(Object.keys(flagFields)).not.toContain('shellEnv');
    expect(Object.keys(serverFields)).toContain('shellEnv');
  });

  it('is absent when the file names none', () => {
    expect(folded({}).shellEnv).toBeUndefined();
  });

  it('refuses a value that is neither text nor null, naming the key', () => {
    expect(refusal({ shellEnv: { PORT: 5 } })).toBe(`${config}: shellEnv.PORT must be text or null`);
    expect(refusal({ shellEnv: { PORT: ['5'] } })).toBe(`${config}: shellEnv.PORT must be text or null`);
  });

  it('refuses a name a shell cannot export, naming it', () => {
    expect(refusal({ shellEnv: { '2FA': 'on' } })).toBe(`${config}: shellEnv.2FA is not a shell variable name`);
    expect(refusal({ shellEnv: { 'A-B': 'on' } })).toBe(`${config}: shellEnv.A-B is not a shell variable name`);
  });

  it('refuses a shellEnv that is not a map at all', () => {
    expect(refusal({ shellEnv: 'on' })).toBe(`${config}: shellEnv must be an object`);
    expect(refusal({ shellEnv: ['HOME'] })).toBe(`${config}: shellEnv must be an object`);
  });
});

/*
 * Managed permissions are held as VS Code's host holds a document before it
 * takes one: its four keys alone, and a boundary of `Domain` rules with the
 * host as VS Code's network filter normalizes it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L270-L283
 */
describe('the managedSettingsPermissions key', () => {
  it('takes a boundary of Domain rules, and refuses one that is not, naming it', () => {
    expect(folded({ managedSettingsPermissions: { limitTo: ['Domain', 'Domain(example.com)', 'Domain(*.example.com)'] } }).managedSettingsPermissions)
      .toEqual({ limitTo: ['Domain', 'Domain(example.com)', 'Domain(*.example.com)'] });
    for (const rule of ['Domain(*)', 'Domain(Example.com)', 'Domain(https://example.com)', 'Shell(curl)']) {
      expect(refusal({ managedSettingsPermissions: { limitTo: [rule] } })).toBe(`${config}: managedSettingsPermissions.limitTo holds ${JSON.stringify(rule)}, `
        + 'which is not a Domain boundary rule: Domain, or Domain(<host>) with the host written as VS Code\'s network filter normalizes it, such as Domain(example.com) or Domain(*.example.com)');
    }
  });

  it('refuses a key VS Code\'s managed permissions do not have', () => {
    expect(refusal({ managedSettingsPermissions: { allow: ['Shell'] } })).toBe(`${config}: managedSettingsPermissions.allow is not a field`);
  });

  /*
   * The runtime that takes a managed document parses every rule with a strict
   * grammar and refuses the whole document for a rule it cannot read, so the
   * start refuses one, naming it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L58-L63
   */
  const grammar = 'which the managed rule grammar refuses: Shell, Read, Write (or Edit) or Domain, alone or with an argument holding no ")" or line break:'
    + ' Shell(<command>) with a command before any trailing " *", Read(<glob>) and Write(<glob>) with no leading "!" and every brace closed,'
    + ' and Domain(<host>) that reads as a URL with a host and holds no shell substitution (Domain alone is every domain),'
    + ' such as Shell(git *), Read(src/**), Write(**/*.txt) or Domain(example.com)';

  it('takes deny rules of the managed grammar, and refuses one the grammar refuses, naming it', () => {
    const deny = ['Shell', 'Shell(git *)', 'Read(src/**)', 'Edit(**/*.txt)', 'Domain(example.com)'];
    expect(folded({ managedSettingsPermissions: { deny } }).managedSettingsPermissions).toEqual({ deny });
    expect(refusal({ managedSettingsPermissions: { deny: ['Shell( *)'] } })).toBe(`${config}: managedSettingsPermissions.deny holds "Shell( *)", ${grammar}`);
  });

  it('takes ask rules of the managed grammar, and refuses one the grammar refuses, naming it', () => {
    const ask = ['Domain', 'Domain(*.example.com)', 'Write(**/.env)'];
    expect(folded({ managedSettingsPermissions: { ask } }).managedSettingsPermissions).toEqual({ ask });
    expect(refusal({ managedSettingsPermissions: { ask: ['Domain(*)'] } })).toBe(`${config}: managedSettingsPermissions.ask holds "Domain(*)", ${grammar}`);
  });
});

describe('the modelProxy key', () => {
  it('is the model names and nothing else, with no providers of its own', () => {
    expect(folded({}).modelProxy).toEqual({ models: {}, sessionCalls: 'record' });
  });

  it('reads the names and the entries that serve each, naming a connector or an adapter', () => {
    const options = folded({
      modelProxy: {
        models: {
          'deepseek/deepseek-v4.1-flash': [{ provider: 'local-vllm', id: 'deepseek-v4.1-flash', price: { input: 0.2, output: 0.8 } }],
          'anthropic/fable-5': [{ provider: 'anthropic', id: 'fable-5' }],
        },
      },
    });
    expect(options.warnings).toEqual([]);
    expect(options.modelProxy.models).toEqual({
      'deepseek/deepseek-v4.1-flash': [{ provider: 'local-vllm', id: 'deepseek-v4.1-flash', price: { input: 0.2, output: 0.8 } }],
      'anthropic/fable-5': [{ provider: 'anthropic', id: 'fable-5' }],
    });
  });

  it('refuses a file that still writes providers, and says where a provider goes now', () => {
    expect(refusal({ modelProxy: { providers: { 'local-vllm': { endpoint: 'http://localhost:8000/v1' } }, models: {} } }))
      .toBe(`${config}: modelProxy.providers is no longer read: add each provider as a connector, see docs/server/PROXY.md`);
  });

  it('refuses a model name that is not <maker>/<name>', () => {
    for (const name of ['fable-5', 'anthropic/', '/fable-5', 'a/b/c']) {
      expect(refusal({ modelProxy: { models: { [name]: [{ provider: 'anthropic', id: 'fable-5' }] } } }))
        .toBe(`${config}: modelProxy.models.${name} is not a model name: write it as <maker>/<name>`);
    }
  });

  it('refuses a model entry with no provider, or with a provider that is not text', () => {
    expect(refusal({ modelProxy: { models: { 'anthropic/fable-5': [{ id: 'fable-5' }] } } }))
      .toBe(`${config}: modelProxy.models.anthropic/fable-5[0].provider is required`);
    expect(refusal({ modelProxy: { models: { 'anthropic/fable-5': { provider: 'anthropic', id: 'fable-5' } } } }))
      .toBe(`${config}: modelProxy.models.anthropic/fable-5 must be a list`);
  });

  it('reads sessionCalls as record when absent, takes skip, and refuses another value by name', () => {
    expect(folded({}).modelProxy.sessionCalls).toBe('record');
    expect(folded({ modelProxy: { sessionCalls: 'skip' } }).modelProxy.sessionCalls).toBe('skip');
    expect(refusal({ modelProxy: { sessionCalls: 'always' } })).toBe(`${config}: modelProxy.sessionCalls must be one of record, skip`);
  });

  it('refuses a modelProxy that is not an object', () => {
    expect(refusal({ modelProxy: 'on' })).toBe(`${config}: modelProxy must be an object`);
    expect(refusal({ modelProxy: [] })).toBe(`${config}: modelProxy must be an object`);
  });
});

/** The daemon as a process, over stdio, with this file. */
const run = (value: unknown): Promise<{ code: number | null; stderr: string }> => {
  put(value);
  const child = spawn(
    process.execPath,
    [MAIN, '--stdio', '--config-file', config, '--plugin', BACKEND, '--no-update-check'],
    {
      cwd: REPO,
      env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stdin.end();
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  child.stdout.resume();
  return new Promise((done) => { child.on('close', (code) => { done({ code, stderr }); }); });
};

describe('a key that was renamed', () => {
  it('is read under its new name, with a warning naming the file to change', () => {
    const options = folded({ http: true, proxy: { sessionCalls: 'skip' } });
    expect(options.warnings).toEqual([
      `http is now httpApi; rename it in ${config}.`,
      `proxy is now modelProxy; rename it in ${config}.`,
    ]);
    expect(options.httpApi).toEqual({});
    expect(options.modelProxy.sessionCalls).toBe('skip');
  });

  it('warns about nothing when the file already uses the new names', () => {
    expect(folded({ httpApi: true, modelProxy: { sessionCalls: 'skip' } }).warnings).toEqual([]);
  });

  it('stops the start when the file holds both names for one key', () => {
    expect(refusal({ http: true, httpApi: true }))
      .toBe(`${config} holds both http and httpApi, and they name the same setting: remove http, the old name of httpApi.`);
    expect(refusal({ proxy: {}, modelProxy: {} }))
      .toBe(`${config} holds both proxy and modelProxy, and they name the same setting: remove proxy, the old name of modelProxy.`);
  });

  it('names the new key in every message about it', () => {
    expect(refusal({ httpApi: { port: 70000 } })).toContain('httpApi.port');
    expect(refusal({ modelProxy: { sessionCalls: 'always' } })).toContain('modelProxy.sessionCalls');
  });
});

describe('the daemon', () => {
  it('starts with an unknown key and says so in its log', async () => {
    const said = await run({ plugin: [] });
    expect(said.code).toBe(0);
    expect(said.stderr).toContain(`${config}: plugin is not a setting ahpd knows; ignored`);
    expect(said.stderr).toContain('ahpd over stdio');
  }, 20000);

  it('starts with a trustToken somebody left behind, and says so in its log', async () => {
    // The key is gone, so a file that still writes it is unknown rather than
    // wrong: the run goes on and the line names the file to change.
    const said = await run({ trustToken: true });
    expect(said.code).toBe(0);
    expect(said.stderr).toContain(`${config}: trustToken is not a setting ahpd knows; ignored`);
    expect(said.stderr).toContain('ahpd over stdio');
  }, 20000);

  it('refuses to start on a wrong value, naming the file and the key', async () => {
    const said = await run({ port: '8080' });
    expect(said.code).toBe(2);
    expect(said.stderr).toContain(`${config}: port must be an integer`);
  }, 20000);

  it('starts with a modelProxy that names a model', async () => {
    const said = await run({
      modelProxy: {
        models: { 'deepseek/deepseek-v4.1-flash': [{ provider: 'local-vllm', id: 'deepseek-v4.1-flash' }] },
      },
    });
    expect(said.code).toBe(0);
    expect(said.stderr).toContain('ahpd over stdio');
  }, 20000);

  it('refuses to start when the file still writes providers', async () => {
    const said = await run({ modelProxy: { providers: { 'local-vllm': { endpoint: 'http://localhost:8000/v1' } } } });
    expect(said.code).toBe(2);
    expect(said.stderr).toContain(`${config}: modelProxy.providers is no longer read: add each provider as a connector, see docs/server/PROXY.md`);
  }, 20000);
});

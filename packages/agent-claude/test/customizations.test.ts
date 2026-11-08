import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import { parseYaml } from '@cofold/yaml';
import { customizationsOf } from '../src/session.js';
import { diskOf as readDisk } from '../src/session/disk.js';
import type { DiskRoots } from '../src/session/disk.js';
import type { Bag } from '../../sdk/src/types/common.js';

/** The disk read with the YAML the host hands a plugin, as the daemon's context does. */
const diskOf = (roots: DiskRoots) => readDisk(roots, parseYaml);

/*
 * What a session lists as loaded, and where each entry says it came from.
 *
 * The SDK names a plugin's children `<plugin>:<name>`, and `reloadPlugins()`
 * is the only place a plugin's real root is reported. The projection is a pure
 * function of what the control protocol answered, so it is driven directly
 * here; `test/toolauth.test.ts` drives the same function through a session.
 */

const PLUGIN = { name: 'acme', path: '/plugins/acme', version: '1.0.0' };
/** A copy this host handed the CLI itself, under the nonce directory it was filed in. */
const HANDED = '/copies/virtual---plugin-bundle/1683262406';
const BUNDLE = { name: 'vs-code-synced-data', path: HANDED };
const children = (one: Bag | undefined): Bag[] => (one?.children ?? []) as Bag[];
const byType = (list: Bag[], type: string): Bag | undefined => list.find((one) => one.type === type);

/**
 * A home with an `agents` folder in it, as one agent of the two below has.
 *
 * The check is the real one - a `file:` uri that names a file nobody has is
 * the same broken link as a `claude-internal:` one is not - so the folder is
 * written where the listing will look for it rather than stubbed out.
 */
function withHome(names: string[]): { home: string; restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'ahpd-home-'));
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  for (const name of names) writeFileSync(join(home, '.claude', 'agents', `${name}.md`), `---\nname: ${name}\n---\n`);
  // `os.homedir()` reads `HOME` on POSIX and `USERPROFILE` on Windows.
  const was = process.env.HOME;
  const wasProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    restore: () => {
      if (was === undefined) delete process.env.HOME; else process.env.HOME = was;
      if (wasProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = wasProfile;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Every agent leaf a listing reported, wherever it put it. */
const listed = (out: Bag[]): Bag[] =>
  out.filter((one) => one.type === 'directory' || one.type === 'plugin')
    .flatMap((one) => children(one))
    .filter((one) => one.type === 'agent');

const agentNames = (out: Bag[]): string[] => listed(out).map((one) => String(one.name));

const agentNamed = (out: Bag[], name: string): Bag | undefined => listed(out).find((one) => one.name === name);

describe('where a customization came from', () => {
  /*
   * A plugin's container is id'd by its root's URI and named by its
   * `enabledPlugins` id, the source the SDK reports, as VS Code's Claude
   * discovery projects a plugin the session loaded.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L65-L88
   */
  it('projects a reported plugin as its own container, id\'d by its root\'s URI and named by its enabledPlugins id', () => {
    const out = customizationsOf({}, [], [], undefined, [{ ...PLUGIN, source: 'acme@market' }]);
    expect(out).toHaveLength(1);
    const root = uriOf('/plugins/acme');
    expect(out[0]).toMatchObject({ type: 'plugin', id: root, uri: root, name: 'acme@market', version: '1.0.0' });
  });

  it('leaves a reported plugin version off when the manifest declared none', () => {
    const out = customizationsOf({}, [], [], undefined, [{ name: 'acme', path: '/plugins/acme' }]);
    expect(out[0]).toMatchObject({ type: 'plugin', uri: uriOf('/plugins/acme'), name: 'acme' });
    expect(out[0]).not.toHaveProperty('version');
  });

  /*
   * A plugin the CLI ships has no root, the SDK reporting `builtin` as the path
   * of every one of them, and VS Code lists a native plugin it resolves to a
   * root: no row, and what the CLI reports of it is listed as the CLI's own,
   * as no plugin's parse holds it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/scan/claudeNativePluginScan.ts#L230-L250
   */
  it('lists no row for a plugin the CLI ships, which has no root, and what it reports of one among the built-in skills', () => {
    const out = customizationsOf({}, [], [{ name: 'cc-plugin-agents-md:agents-md' }], undefined, [
      { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' },
      { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
      PLUGIN,
    ]);
    expect(out.filter((one) => one.type === 'plugin').map((one) => one.uri)).toEqual([uriOf('/plugins/acme')]);
    expect(children(out.find((one) => one.id === 'agent-builtin:/skills')).map((one) => one.name)).toEqual(['cc-plugin-agents-md:agents-md']);
  });

  it('answers the builtin skills and agents directories when there is no disk and the SDK reported no plugins', () => {
    const out = customizationsOf({
      commands: [{ name: 'review', description: 'Review the diff' }],
      agents: [{ name: 'helper', description: 'Helps' }],
    }, [], [{ name: 'writing', description: 'How to write' }]);
    expect(out.map((one) => [one.contents, one.id, one.uri])).toEqual([
      ['skill', 'agent-builtin:/skills', 'agent-builtin:/skills'],
      ['agent', 'claude-internal:/agents', 'claude-internal:/agents'],
    ]);
    expect(out.every((one) => one.name === 'builtin' && one.writable === false)).toBe(true);
    // The command is a skill, beside the skill the CLI loaded.
    expect(children(out[0]).map((one) => [one.type, one.name, one.uri])).toEqual([
      ['skill', 'writing', 'agent-builtin:/skill/writing'],
      ['skill', 'review', 'agent-builtin:/skill/review'],
    ]);
    expect(byType(out, 'plugin')).toBeUndefined();
  });

  /*
   * A Claude plugin on this disk, its manifest and the files its children are
   * listed by, each given its text or a frontmatter naming it.
   *
   * A child is named by its file's URI, as VS Code's agent host names a
   * plugin's children by the files it read them from, so the files are written
   * where the listing looks for them.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L481-L487
   */
  const pluginWith = (files: Record<string, string>): { plugin: Bag; dir: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-plugin-'));
    onTestFinished(() => { rmSync(dir, { recursive: true, force: true }); });
    for (const [file, text] of Object.entries({ '.claude-plugin/plugin.json': '{ "name": "acme" }', ...files })) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text === '' ? '---\nname: x\n---\n' : text);
    }
    return { plugin: { name: 'acme', path: dir, version: '1.0.0' }, dir };
  };

  it('moves an attributed skill under its plugin and out of the skills directory', () => {
    const { plugin: acme, dir } = pluginWith({ 'skills/acme-skill/SKILL.md': '' });
    const out = customizationsOf({}, [], [
      { name: 'acme:acme-skill', description: '(acme) A plugin skill' },
      { name: 'user-skill', description: 'A user skill from disk' },
    ], undefined, [acme]);
    const plugin = byType(out, 'plugin');
    expect(children(plugin).map((one) => one.name)).toEqual(['acme-skill']);
    // Its `SKILL.md`, by its URI, which is its id too.
    const skill = uriOf(join(dir, 'skills', 'acme-skill', 'SKILL.md'));
    expect(children(plugin)[0]).toMatchObject({ type: 'skill', id: skill, uri: skill });
    const directory = byType(out, 'directory');
    expect(children(directory).map((one) => one.name)).toEqual(['user-skill']);
    expect(children(directory).map((one) => one.name)).not.toContain('acme-skill');
  });

  /*
   * A plugin's agent under the plugin by its file, and its command among the
   * built-in skills, as VS Code's parse of a plugin reads its agents, skills,
   * rules, hooks and servers and no commands.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentPlugins/common/pluginParsers.ts#L1456-L1525
   */
  it('moves an attributed agent under its plugin by its file, and lists the plugin\'s command among the built-in skills', () => {
    const { plugin: acme, dir } = pluginWith({ 'commands/acme-command.md': '', 'agents/acme-agent.md': '' });
    const out = customizationsOf({
      commands: [{ name: 'acme:acme-command', description: '(acme) A plugin command' }],
      agents: [{ name: 'acme:acme-agent', description: 'A plugin agent' }],
    }, [], [], undefined, [acme]);
    const agent = uriOf(join(dir, 'agents', 'acme-agent.md'));
    expect(children(byType(out, 'plugin'))).toEqual([{ type: 'agent', id: agent, uri: agent, name: 'acme-agent' }]);
    expect(out.filter((one) => one.type === 'directory').map((one) => [one.id, children(one).map((child) => child.name)])).toEqual([
      ['agent-builtin:/skills', ['acme:acme-command']],
    ]);
  });

  /*
   * Every kind VS Code's `makePlugin` lists, read off the manifest and the
   * places it names, a custom one among them: the agents, the skills, the
   * rules, the hooks file and the servers, each by its file's URI, a server by
   * its file's with its name in a fragment. What the CLI reports of them is
   * listed under the plugin alone.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L65-L88
   */
  it('lists a plugin\'s agents, skills, rules, hooks and servers off its manifest, a custom place included, each by its file\'s URI', () => {
    const { plugin: acme, dir } = pluginWith({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'acme', skills: './more-skills' }),
      'agents/reviewer.md': '',
      'more-skills/lint/SKILL.md': '',
      'rules/style.mdc': '---\ndescription: The house style\n---\nWrite plainly.\n',
      'hooks/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }),
      '.mcp.json': JSON.stringify({ mcpServers: { notes: { command: 'notes' } } }),
    });
    const out = customizationsOf(
      { agents: [{ name: 'acme:reviewer' }], commands: [{ name: 'lint' }] },
      [{ name: 'notes', status: 'connected' }],
      [{ name: 'lint' }],
      undefined,
      [acme],
    );
    const at = (path: string): string => uriOf(join(dir, path));
    expect(children(byType(out, 'plugin')).map((one) => [one.type, one.name, one.id])).toEqual([
      ['agent', 'reviewer', at('agents/reviewer.md')],
      ['skill', 'lint', at('more-skills/lint/SKILL.md')],
      ['rule', 'style', at('rules/style.mdc')],
      ['hook', 'hooks.json', at('hooks/hooks.json')],
      ['mcpServer', 'notes', `${at('.mcp.json')}#mcp=notes`],
    ]);
    // Nothing the plugin holds is listed a second time outside it.
    expect(out.filter((one) => one.type !== 'plugin')).toEqual([]);
  });

  /*
   * A plugin's skill, command or agent the CLI reported with no file in the
   * plugin, listed where VS Code's Claude lists one its disk scan found no file
   * for: a skill or a command among the built-in skills, read-only, and an
   * agent among the agents with VS Code's internal uri, each by the name the
   * CLI runs it by.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeBuiltinCommands.ts#L150-L162
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L385-L394
   */
  it('lists a plugin\'s skill, command and agent with no file in the plugin where VS Code lists one it found no file for', () => {
    const out = customizationsOf({
      commands: [{ name: 'acme:acme-command', description: '(acme) A plugin command' }],
      agents: [{ name: 'acme:acme-agent', description: 'A plugin agent' }],
    }, [], [{ name: 'acme:acme-skill', description: '(acme) A plugin skill' }], undefined, [PLUGIN]);
    expect(children(byType(out, 'plugin'))).toEqual([]);
    const listedOf = (contents: string): unknown[] => children(out.find((one) => one.type === 'directory' && one.contents === contents))
      .map((one) => [one.type, one.name, one.id, one.uri]);
    expect(listedOf('skill')).toEqual([
      ['skill', 'acme:acme-skill', 'agent-builtin:/skill/acme%3Aacme-skill', 'agent-builtin:/skill/acme%3Aacme-skill'],
      ['skill', 'acme:acme-command', 'agent-builtin:/skill/acme%3Aacme-command', 'agent-builtin:/skill/acme%3Aacme-command'],
    ]);
    expect(listedOf('agent')).toEqual([
      ['agent', 'acme:acme-agent', 'claude-internal:/agent/acme%3Aacme-agent', 'claude-internal:/agent/acme%3Aacme-agent'],
    ]);
  });

  it('leaves a skill of a handed plugin out, because the host\'s own entry lists it', () => {
    const out = customizationsOf({}, [], [
      { name: 'vs-code-synced-data:advisor', description: '(vs-code-synced-data) A plugin skill' },
      { name: 'user-skill', description: 'A user skill from disk' },
    ], undefined, [BUNDLE], new Set([HANDED]));
    // The copy is what the host's entry holds, and the CLI reports the same
    // file under the plugin's name - which for a copy is the nonce its
    // directory is named. Listed from both, the skill is offered twice.
    expect(out.filter((one) => one.type === 'plugin')).toEqual([]);
    expect(children(byType(out, 'directory')).map((one) => one.name)).toEqual(['user-skill']);
    // Not moved under a container of its own either, which is where a name
    // with no plugin to attribute it to goes.
    expect(JSON.stringify(out)).not.toContain('advisor');
  });

  it('leaves a command of a handed plugin out too', () => {
    const out = customizationsOf(
      { commands: [{ name: 'vs-code-synced-data:sync-now' }] }, [], [], undefined, [BUNDLE], new Set([HANDED]),
    );
    // Nothing was attributed and nothing else was reported, so no container is
    // invented for what is left over - and what is left over is nothing.
    expect(out).toEqual([]);
  });

  it('lists a plugin this host did not hand over with what it holds', () => {
    const { plugin: acme, dir } = pluginWith({ 'skills/acme-skill/SKILL.md': '' });
    const out = customizationsOf({}, [], [
      { name: 'acme:acme-skill' },
      { name: 'vs-code-synced-data:advisor' },
    ], undefined, [acme, BUNDLE], new Set([HANDED]));
    const plugin = byType(out, 'plugin');
    expect(plugin).toMatchObject({ name: 'acme', uri: uriOf(dir) });
    expect(children(plugin).map((one) => one.name)).toEqual(['acme-skill']);
    expect(out.filter((one) => one.type === 'plugin')).toHaveLength(1);
  });

  it('never invents a container for a namespace the SDK did not report', () => {
    const out = customizationsOf({}, [], [
      { name: 'ghost:ghost-skill', description: 'No such plugin was loaded' },
    ], undefined, [PLUGIN]);
    // The reported plugin is still a container, with nothing attributed to it.
    expect(byType(out, 'plugin')).toMatchObject({ name: 'acme' });
    expect(children(byType(out, 'plugin'))).toEqual([]);
    expect(children(byType(out, 'directory')).map((one) => one.name)).toEqual(['ghost:ghost-skill']);
  });
});

/*
 * A server the CLI is still connecting to.
 *
 * The Claude backend never reports `blocking`, which is the protocol's
 * optional field for a startup a client would have to wait on: nothing here
 * holds a message back on one, so a client is told the server is starting and
 * nothing else. `blocking: false` would be a claim about a wait that does not
 * exist, and a `session/mcpServerBackgroundRequested` would then have
 * something to clear that was never raised.
 */
it('reports a server the CLI is still connecting to as starting, with no blocking flag', () => {
  const out = customizationsOf({}, [{ name: 'desk', status: 'pending' }]);
  const server = out.find((one) => one.type === 'mcpServer');
  expect(server?.state).toEqual({ kind: 'starting' });
  expect(server?.state).not.toHaveProperty('blocking');
});

describe('where an agent lives', () => {
  it('gives an agent the CLI ships, and which has no file of its own, an internal uri', () => {
    const { restore } = withHome([]);
    try {
      const out = customizationsOf({ agents: [{ name: 'Explore', description: 'Reads the code' }] }, []);
      // A `file:` uri here would name a file nobody has, and a client that
      // reads what it names gets nothing back.
      expect(agentNamed(out, 'Explore')).toMatchObject({
        type: 'agent', id: 'claude-internal:/agent/Explore', name: 'Explore', uri: 'claude-internal:/agent/Explore', description: 'Reads the code',
      });
    } finally { restore(); }
  });

  it('keeps the file uri for an agent a person wrote in their own agents folder', () => {
    const { home, restore } = withHome(['Plan']);
    try {
      const out = customizationsOf({ agents: [{ name: 'Plan' }] }, [], [], undefined, [], undefined, [], diskOf({ configDir: join(home, '.claude') }));
      expect(agentNamed(out, 'Plan')).toMatchObject({
        type: 'agent', uri: uriOf(join(home, '.claude', 'agents', 'Plan.md')),
      });
    } finally { restore(); }
  });

  it('does not list general-purpose, which is what the CLI runs when nothing is picked', () => {
    const { restore } = withHome([]);
    try {
      const out = customizationsOf({ agents: [{ name: 'general-purpose' }, { name: 'Explore' }] }, []);
      // Offering it as a choice would offer the absence of a choice, and a
      // person who picked it would be told nothing changed.
      expect(agentNames(out)).toEqual(['Explore']);
    } finally { restore(); }
  });

  it('gives a plugin agent the file under the plugin when there is one, and an internal uri when there is not', () => {
    const { restore } = withHome([]);
    const root = mkdtempSync(join(tmpdir(), 'ahpd-plugin-'));
    mkdirSync(join(root, 'agents'), { recursive: true });
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{ "name": "acme" }');
    writeFileSync(join(root, 'agents', 'scribe.md'), '---\nname: scribe\n---\n');
    try {
      const out = customizationsOf(
        { agents: [{ name: 'acme:scribe' }, { name: 'acme:ghost' }] }, [], [], undefined,
        [{ name: 'acme', path: root }],
      );
      expect(agentNamed(out, 'scribe')).toMatchObject({ uri: uriOf(join(root, 'agents', 'scribe.md')) });
      expect(agentNamed(out, 'acme:ghost')).toMatchObject({ uri: 'claude-internal:/agent/acme%3Aghost' });
    } finally { restore(); rmSync(root, { recursive: true, force: true }); }
  });
});

describe('where each entry\'s file is', () => {
  const made: string[] = [];
  afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  /** A config directory, a working directory and a managed directory, with each file of `files` written under the three. */
  function roots(files: Record<string, string>): { root: string; config: string; work: string; managed: string } {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-scopes-'));
    made.push(root);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return { root, config: join(root, 'config'), work: join(root, 'work'), managed: join(root, 'managed') };
  }
  const skill = (name: string): string => `---\nname: ${name}\n---\n`;
  const dir = (out: Bag[], id: string): Bag | undefined => out.find((one) => one.id === id);
  const leaf = (out: Bag[], id: string, name: string): Bag | undefined => children(dir(out, id)).find((one) => one.name === name);

  it('gives a skill its SKILL.md in the directory of its scope, managed first', () => {
    const { config, work, managed } = roots({
      'managed/.claude/skills/policy/SKILL.md': skill('policy'),
      'config/skills/policy/SKILL.md': skill('policy'),
      'config/skills/writing/SKILL.md': skill('writing'),
      'work/.claude/skills/build/SKILL.md': skill('build'),
      'work/.claude/skills/writing/SKILL.md': skill('writing'),
    });
    const out = customizationsOf({ commands: [{ name: 'writing' }, { name: 'build' }, { name: 'policy' }] }, [],
      [{ name: 'policy' }, { name: 'writing' }, { name: 'build' }], undefined, [], undefined, [],
      diskOf({ configDir: config, cwd: work, managedDir: managed }));
    const managedSkills = uriOf(join(managed, '.claude', 'skills'));
    expect(leaf(out, managedSkills, 'policy')).toMatchObject({ uri: uriOf(join(managed, '.claude', 'skills', 'policy', 'SKILL.md')) });
    expect(dir(out, managedSkills)).toMatchObject({ name: 'managed', writable: false });
    expect(leaf(out, uriOf(join(config, 'skills')), 'writing')).toMatchObject({ uri: uriOf(join(config, 'skills', 'writing', 'SKILL.md')) });
    expect(leaf(out, uriOf(join(work, '.claude', 'skills')), 'build')).toMatchObject({ uri: uriOf(join(work, '.claude', 'skills', 'build', 'SKILL.md')) });
    // One name in two scopes is listed once, in the scope the CLI runs it from.
    expect(children(dir(out, uriOf(join(config, 'skills')))).map((one) => one.name)).toEqual(['writing']);
    expect(children(dir(out, uriOf(join(work, '.claude', 'skills')))).map((one) => one.name)).toEqual(['build']);
  });

  /*
   * An agent of one name is the CLI's from the managed directory first, then
   * the project's, then the person's, as the CLI ranks subagents.
   * https://code.claude.com/docs/en/sub-agents
   */
  it('gives an agent its file in the directory of its scope, managed first and the project before the person', () => {
    const { config, work, managed } = roots({
      'managed/.claude/agents/auditor.md': skill('auditor'),
      'config/agents/auditor.md': skill('auditor'),
      'config/agents/scout.md': skill('scout'),
      'work/.claude/agents/scout.md': skill('scout'),
    });
    const out = customizationsOf({ agents: [{ name: 'auditor' }, { name: 'scout' }] }, [], [], undefined, [], undefined, [],
      diskOf({ configDir: config, cwd: work, managedDir: managed }));
    const managedAgents = uriOf(join(managed, '.claude', 'agents'));
    expect(leaf(out, managedAgents, 'auditor')).toMatchObject({ uri: uriOf(join(managed, '.claude', 'agents', 'auditor.md')) });
    expect(dir(out, managedAgents)).toMatchObject({ name: 'managed', writable: false });
    expect(leaf(out, uriOf(join(work, '.claude', 'agents')), 'scout')).toMatchObject({ uri: uriOf(join(work, '.claude', 'agents', 'scout.md')) });
    // One name in two scopes is listed once, in the scope the CLI runs it from.
    expect(children(dir(out, uriOf(join(config, 'agents'))))).toEqual([]);
  });

  it('matches a synced skill by its namespaced name and by its bare one', () => {
    const { config } = roots({
      'config/skills/synced/acct/manifest.json': JSON.stringify({ skills: [{ name: 'docs' }, { name: 'pdf' }] }),
      'config/skills/synced/acct/docs/SKILL.md': skill('docs'),
      'config/skills/synced/acct/pdf/SKILL.md': skill('pdf'),
    });
    const out = customizationsOf({}, [], [{ name: 'anthropic-skills:docs' }, { name: 'pdf' }], undefined, [], undefined, [], diskOf({ configDir: config }));
    const synced = uriOf(join(config, 'skills', 'synced'));
    expect(dir(out, synced)).toMatchObject({ name: 'synced', writable: false, uri: synced });
    expect(children(dir(out, synced)).map((one) => [one.name, one.uri])).toEqual([
      ['anthropic-skills:docs', uriOf(join(config, 'skills', 'synced', 'acct', 'docs', 'SKILL.md'))],
      ['pdf', uriOf(join(config, 'skills', 'synced', 'acct', 'pdf', 'SKILL.md'))],
    ]);
  });

  /*
   * Two names the CLI runs one file by are one customization, as VS Code's
   * Claude discovery keeps a container's children once by id, and an id is the
   * file's uri.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L64-L72
   */
  it('lists a synced skill the CLI reports by both its names once, by its file', () => {
    const { config } = roots({
      'config/skills/synced/acct/manifest.json': JSON.stringify({ skills: [{ name: 'docs' }] }),
      'config/skills/synced/acct/docs/SKILL.md': skill('docs'),
    });
    const out = customizationsOf({}, [], [{ name: 'anthropic-skills:docs' }, { name: 'docs' }], undefined, [], undefined, [], diskOf({ configDir: config }));
    const synced = out.find((one) => one.type === 'directory' && one.name === 'synced');
    const file = uriOf(join(config, 'skills', 'synced', 'acct', 'docs', 'SKILL.md'));
    expect(children(synced).map((one) => [one.name, one.id])).toEqual([['anthropic-skills:docs', file]]);
  });

  /*
   * As VS Code's Claude discovery lists what the CLI ships: one read-only
   * built-in skills directory, a command among its skills, and an agent among
   * the personal agents.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeBuiltinCommands.ts#L98-L176
   */
  it('puts a skill and a command with no file in the one builtin skills directory, and an agent with none among the personal agents', () => {
    const { config } = roots({});
    const out = customizationsOf({ commands: [{ name: 'code-review' }, { name: 'compact' }], agents: [{ name: 'Explore' }] }, [],
      [{ name: 'code-review' }], undefined, [], undefined, [], diskOf({ configDir: config }));
    expect(dir(out, 'agent-builtin:/skills')).toMatchObject({ uri: 'agent-builtin:/skills', name: 'builtin', writable: false, contents: 'skill' });
    expect(leaf(out, 'agent-builtin:/skills', 'code-review')).toMatchObject({ type: 'skill', uri: 'agent-builtin:/skill/code-review' });
    expect(leaf(out, 'agent-builtin:/skills', 'compact')).toMatchObject({ type: 'skill', id: 'agent-builtin:/skill/compact', uri: 'agent-builtin:/skill/compact' });
    expect(leaf(out, uriOf(join(config, 'agents')), 'Explore')).toMatchObject({ uri: 'claude-internal:/agent/Explore' });
    expect(out.filter((one) => one.type === 'directory' && one.name === 'builtin').map((one) => one.id)).toEqual(['agent-builtin:/skills']);
  });

  it('gives a plugin skill its SKILL.md when the plugin has it', () => {
    const { root } = roots({ 'acme/.claude-plugin/plugin.json': '{ "name": "acme" }', 'acme/skills/lint/SKILL.md': skill('lint') });
    const out = customizationsOf({}, [], [{ name: 'acme:lint' }, { name: 'acme:gone' }], undefined, [{ name: 'acme', path: join(root, 'acme') }]);
    const plugin = byType(out, 'plugin');
    const lint = uriOf(join(root, 'acme', 'skills', 'lint', 'SKILL.md'));
    expect(children(plugin).map((one) => [one.name, one.id, one.uri])).toEqual([['lint', lint, lint]]);
    // The one with no file there is among the built-in skills, by the name the CLI runs it by.
    expect(leaf(out, 'agent-builtin:/skills', 'acme:gone')).toMatchObject({ id: 'agent-builtin:/skill/acme%3Agone', uri: 'agent-builtin:/skill/acme%3Agone' });
  });

  it('lists a command as a skill of its scope with its file, and a command a skill has the name of once', () => {
    const { config } = roots({
      'config/commands/review.md': '# Review\n',
      'config/commands/writing.md': '# Writing\n',
      'config/skills/writing/SKILL.md': skill('writing'),
    });
    const out = customizationsOf({ commands: [{ name: 'review' }, { name: 'writing' }] }, [], [{ name: 'writing' }],
      undefined, [], undefined, [], diskOf({ configDir: config }));
    expect(children(dir(out, uriOf(join(config, 'skills')))).map((one) => [one.type, one.id, one.uri])).toEqual([
      ['skill', uriOf(join(config, 'skills', 'writing', 'SKILL.md')), uriOf(join(config, 'skills', 'writing', 'SKILL.md'))],
      ['skill', uriOf(join(config, 'commands', 'review.md')), uriOf(join(config, 'commands', 'review.md'))],
    ]);
    expect(dir(out, uriOf(join(config, 'commands')))).toBeUndefined();
  });

  it('names a skill the CLI loaded from a command file by that file', () => {
    const { config, work } = roots({ 'work/.claude/commands/deploy.md': '# Deploy\n' });
    const out = customizationsOf({ commands: [{ name: 'deploy' }] }, [], [{ name: 'deploy' }],
      undefined, [], undefined, [], diskOf({ configDir: config, cwd: work }));
    expect(leaf(out, uriOf(join(work, '.claude', 'skills')), 'deploy')).toMatchObject({ type: 'skill', uri: uriOf(join(work, '.claude', 'commands', 'deploy.md')) });
  });

  it('leaves out a file the CLI did not report', () => {
    const { config } = roots({ 'config/skills/unloaded/SKILL.md': skill('unloaded'), 'config/agents/idle.md': skill('idle') });
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: config }));
    expect(out.flatMap((one) => children(one)).filter((one) => one.type !== 'rule')).toEqual([]);
  });

  it('sends the writable directories empty too, the project ones first, at their real paths', () => {
    const { config, work } = roots({});
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: config, cwd: work }));
    expect(out.map((one) => [one.id, one.uri, one.name, one.writable])).toEqual([
      [uriOf(join(work, '.claude', 'agents')), uriOf(join(work, '.claude', 'agents')), 'agents', true],
      [uriOf(join(work, '.claude', 'skills')), uriOf(join(work, '.claude', 'skills')), 'skills', true],
      [uriOf(join(work, '.claude', 'rules')), uriOf(join(work, '.claude', 'rules')), 'rules', true],
      [uriOf(join(config, 'agents')), uriOf(join(config, 'agents')), 'agents', true],
      [uriOf(join(config, 'skills')), uriOf(join(config, 'skills')), 'skills', true],
      [uriOf(join(config, 'rules')), uriOf(join(config, 'rules')), 'rules', true],
    ]);
    // The read-only ones are sent only with something in them.
    expect(out.filter((one) => one.writable === false)).toEqual([]);
  });

  it('sends no project directories for a session with no working directory', () => {
    const { config } = roots({});
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: config }));
    expect(out.map((one) => one.id)).toEqual([uriOf(join(config, 'agents')), uriOf(join(config, 'skills')), uriOf(join(config, 'rules'))]);
  });

  it('sends the personal directories once for a session in the home folder', () => {
    const { work } = roots({ 'work/CLAUDE.md': '# Home\n' });
    // The home folder's `.claude` is the personal folder.
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: join(work, '.claude'), cwd: work }));
    const personal = join(work, '.claude');
    expect(out.map((one) => one.id)).toEqual([uriOf(join(personal, 'agents')), uriOf(join(personal, 'skills')), uriOf(join(personal, 'rules'))]);
    expect(children(dir(out, uriOf(join(personal, 'rules')))).map((one) => one.uri)).toEqual([uriOf(join(work, 'CLAUDE.md'))]);
  });

  /*
   * As VS Code's Claude discovery names a server: by the file that declares
   * it, the project's settings first, then the working directory's `.mcp.json`,
   * then the personal settings, and by an internal uri where none does.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/scan/claudeMcpScan.ts#L10-L76
   */
  it('names an MCP server by the file that declares it, and one no file declares by an internal uri', () => {
    const { config, work } = roots({
      'work/.claude/settings.json': JSON.stringify({ permissions: { allow: [] }, mcpServers: { tickets: { command: 'tickets' } } }),
      'work/.mcp.json': JSON.stringify({ desk: { url: 'https://desk.example/mcp' } }),
      'config/settings.json': JSON.stringify({ model: 'opus', mcpServers: { desk: { command: 'other' }, docs: { command: 'docs' } } }),
    });
    const reported = ['tickets', 'desk', 'docs', 'gmail', 'desk two'].map((name) => ({ name, status: 'connected' }));
    const out = customizationsOf({}, reported, [], undefined, [], undefined, [], diskOf({ configDir: config, cwd: work }));
    const project = uriOf(join(work, '.claude', 'settings.json'));
    const local = uriOf(join(work, '.mcp.json'));
    const personal = uriOf(join(config, 'settings.json'));
    expect(out.filter((one) => one.type === 'mcpServer').map((one) => [one.name, one.uri, one.id])).toEqual([
      ['tickets', project, `${project}#mcp=tickets`],
      ['desk', local, `${local}#mcp=desk`],
      ['docs', personal, `${personal}#mcp=docs`],
      ['gmail', 'claude-internal:/mcp/gmail', 'claude-internal:/mcp/gmail#mcp=gmail'],
      ['desk two', 'claude-internal:/mcp/desk%20two', 'claude-internal:/mcp/desk%20two#mcp=desk%20two'],
    ]);
  });

  /*
   * As VS Code's Claude discovery lists hooks: each settings file that
   * declares a command for a lifecycle event, in a hooks directory of its
   * scope, and none for a scope whose files declare none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/scan/claudeHookScan.ts#L11-L71
   */
  it('lists each settings file that declares hooks in a hooks directory of its scope', () => {
    const { config, work } = roots({
      'work/.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo checked' }] }] } }),
      'work/.claude/settings.local.json': JSON.stringify({ disableAllHooks: true, hooks: { Stop: [{ hooks: [{ command: 'echo done' }] }] } }),
      'config/settings.json': JSON.stringify({ hooks: { preToolUse: [{ bash: 'echo checked' }], Unheard: [{ command: 'echo' }] } }),
    });
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: config, cwd: work }));
    const project = join(work, '.claude', 'settings.json');
    const personal = join(config, 'settings.json');
    const projectHooks = uriOf(join(work, '.claude', 'hooks'));
    expect(dir(out, projectHooks)).toMatchObject({ uri: projectHooks, name: 'hooks', contents: 'hook', writable: true });
    expect(children(dir(out, projectHooks))).toEqual([
      { type: 'hook', id: uriOf(project), uri: uriOf(project), name: 'settings.json', enabled: true },
    ]);
    expect(children(dir(out, uriOf(join(config, 'hooks'))))).toEqual([
      { type: 'hook', id: uriOf(personal), uri: uriOf(personal), name: 'settings.json', enabled: true },
    ]);
    // Each scope's hooks after its rules.
    expect(out.map((one) => one.id).filter((id) => typeof id === 'string' && id.startsWith(uriOf(join(work, '.claude'))))).toEqual([
      uriOf(join(work, '.claude', 'agents')), uriOf(join(work, '.claude', 'skills')), uriOf(join(work, '.claude', 'rules')), projectHooks,
    ]);
  });

  it('sends a hooks directory for a scope whose settings name a command, and none for one whose settings name no command for a lifecycle event', () => {
    const { config, work } = roots({
      'work/.claude/settings.local.json': JSON.stringify({ hooks: { Stop: [{ type: 'command', command: 'echo done' }] } }),
      'config/settings.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: 'Is it done?' }] }], Unheard: [{ command: 'echo' }] } }),
    });
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: config, cwd: work }));
    expect(children(dir(out, uriOf(join(work, '.claude', 'hooks')))).map((one) => one.name)).toEqual(['settings.local.json']);
    expect(dir(out, uriOf(join(config, 'hooks')))).toBeUndefined();
  });

  it('lists the memory files and the rules of each scope', () => {
    const { config, work } = roots({
      'config/CLAUDE.md': '# Me\n',
      'work/CLAUDE.md': '# Project\n',
      'work/.claude/rules/api.md': '---\ndescription: The api\npaths:\n  - src/api/**\n---\n',
    });
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: config, cwd: work }));
    expect(children(dir(out, uriOf(join(config, 'rules'))))).toEqual([
      { type: 'rule', id: uriOf(join(config, 'CLAUDE.md')), uri: uriOf(join(config, 'CLAUDE.md')), name: 'CLAUDE.md', enabled: true, alwaysApply: true },
    ]);
    expect(children(dir(out, uriOf(join(work, '.claude', 'rules'))))).toEqual([
      { type: 'rule', id: uriOf(join(work, 'CLAUDE.md')), uri: uriOf(join(work, 'CLAUDE.md')), name: 'CLAUDE.md', enabled: true, alwaysApply: true },
      { type: 'rule', id: uriOf(join(work, '.claude', 'rules', 'api.md')), uri: uriOf(join(work, '.claude', 'rules', 'api.md')), name: 'api.md', enabled: true, description: 'The api', globs: ['src/api/**'] },
    ]);
  });
});

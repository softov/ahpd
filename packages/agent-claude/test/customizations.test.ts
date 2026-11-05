import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import { customizationsOf } from '../src/session.js';
import { diskOf } from '../src/session/disk.js';
import type { Bag } from '../../sdk/src/types/common.js';

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
  it('projects a reported plugin as its own container with the real path, name and version', () => {
    const out = customizationsOf({}, [], [], undefined, [PLUGIN]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'plugin', id: 'plugin:acme', uri: '/plugins/acme', name: 'acme', version: '1.0.0' });
  });

  it('leaves a reported plugin version off when the manifest declared none', () => {
    const out = customizationsOf({}, [], [], undefined, [{ name: 'acme', path: '/plugins/acme' }]);
    expect(out[0]).toMatchObject({ type: 'plugin', uri: '/plugins/acme', name: 'acme' });
    expect(out[0]).not.toHaveProperty('version');
  });

  it('gives each plugin built into the CLI a uri of its own, though the SDK reports one path for all', () => {
    // As the SDK reported them: `builtin` is every built-in's path, and only
    // `source` tells them apart. A shared uri is a shared enablement key.
    const out = customizationsOf({}, [], [], undefined, [
      { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' },
      { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
      PLUGIN,
    ]);
    expect(out.map((one) => one.uri)).toEqual(['cc-plugin-agents-md@builtin', 'cc-plugin-telemetry@builtin', '/plugins/acme']);
  });

  it('answers the three builtin containers when there is no disk and the SDK reported no plugins', () => {
    const out = customizationsOf({
      commands: [{ name: 'review', description: 'Review the diff' }],
      agents: [{ name: 'helper', description: 'Helps' }],
    }, [], [{ name: 'writing', description: 'How to write' }]);
    expect(out.map((one) => one.id)).toEqual(['directory:builtin:skills', 'directory:builtin:commands', 'directory:builtin:agents']);
    expect(out.map((one) => one.contents)).toEqual(['skill', 'prompt', 'agent']);
    expect(out.every((one) => one.name === 'builtin' && one.writable === false)).toBe(true);
    expect(byType(out, 'plugin')).toBeUndefined();
  });

  it('moves an attributed skill under its plugin and out of the skills directory', () => {
    const out = customizationsOf({}, [], [
      { name: 'acme:acme-skill', description: '(acme) A plugin skill' },
      { name: 'user-skill', description: 'A user skill from disk' },
    ], undefined, [PLUGIN]);
    const plugin = byType(out, 'plugin');
    expect(children(plugin).map((one) => one.name)).toEqual(['acme-skill']);
    // `/plugins/acme` is not on this disk, so the skill has no file to name.
    expect(children(plugin)[0]).toMatchObject({ type: 'skill', uri: 'claude-internal:/skill/acme-skill', description: '(acme) A plugin skill' });
    const directory = byType(out, 'directory');
    expect(children(directory).map((one) => one.name)).toEqual(['user-skill']);
    expect(children(directory).map((one) => one.name)).not.toContain('acme-skill');
  });

  it('moves an attributed agent and prompt under its plugin, and keeps the directories empty', () => {
    const out = customizationsOf({
      commands: [{ name: 'acme:acme-command', description: '(acme) A plugin command' }],
      agents: [{ name: 'acme:acme-agent', description: 'A plugin agent' }],
    }, [], [], undefined, [PLUGIN]);
    const plugin = byType(out, 'plugin');
    expect(children(plugin)).toEqual([
      { type: 'prompt', id: 'command:acme:acme-command', name: 'acme-command', uri: '/plugins/acme/commands/acme-command.md', enabled: true, description: '(acme) A plugin command' },
      // No file under the plugin this names, so it is the CLI's own agent and
      // carries the internal uri rather than a path to nothing.
      { type: 'agent', id: 'agent:acme:acme-agent', name: 'acme-agent', uri: 'claude-internal:/agent/acme-agent', enabled: true, description: 'A plugin agent' },
    ]);
    // Everything was attributed, so no per-kind directory is reported at all.
    expect(out.filter((one) => one.type === 'directory')).toEqual([]);
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

  it('attributes a skill to a plugin this host did not hand over, as before', () => {
    const out = customizationsOf({}, [], [
      { name: 'acme:acme-skill' },
      { name: 'vs-code-synced-data:advisor' },
    ], undefined, [PLUGIN, BUNDLE], new Set([HANDED]));
    const plugin = byType(out, 'plugin');
    expect(plugin).toMatchObject({ name: 'acme', uri: '/plugins/acme' });
    expect(children(plugin).map((one) => one.name)).toEqual(['acme-skill']);
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
        type: 'agent', id: 'agent:Explore', name: 'Explore', uri: 'claude-internal:/agent/Explore', description: 'Reads the code',
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
    writeFileSync(join(root, 'agents', 'scribe.md'), '---\nname: scribe\n---\n');
    try {
      const out = customizationsOf(
        { agents: [{ name: 'acme:scribe' }, { name: 'acme:ghost' }] }, [], [], undefined,
        [{ name: 'acme', path: root }],
      );
      expect(agentNamed(out, 'scribe')).toMatchObject({ uri: join(root, 'agents', 'scribe.md') });
      expect(agentNamed(out, 'ghost')).toMatchObject({ uri: 'claude-internal:/agent/ghost' });
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
    expect(leaf(out, 'directory:managed:skills', 'policy')).toMatchObject({ uri: uriOf(join(managed, '.claude', 'skills', 'policy', 'SKILL.md')) });
    expect(dir(out, 'directory:managed:skills')).toMatchObject({ name: 'managed', writable: false });
    expect(leaf(out, 'directory:user:skills', 'writing')).toMatchObject({ uri: uriOf(join(config, 'skills', 'writing', 'SKILL.md')) });
    expect(leaf(out, 'directory:project:skills', 'build')).toMatchObject({ uri: uriOf(join(work, '.claude', 'skills', 'build', 'SKILL.md')) });
    // One name in two scopes is listed once, in the scope the CLI runs it from.
    expect(children(dir(out, 'directory:user:skills')).map((one) => one.name)).toEqual(['writing']);
    expect(children(dir(out, 'directory:project:skills')).map((one) => one.name)).toEqual(['build']);
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
    expect(leaf(out, 'directory:managed:agents', 'auditor')).toMatchObject({ uri: uriOf(join(managed, '.claude', 'agents', 'auditor.md')) });
    expect(dir(out, 'directory:managed:agents')).toMatchObject({ name: 'managed', writable: false });
    expect(leaf(out, 'directory:project:agents', 'scout')).toMatchObject({ uri: uriOf(join(work, '.claude', 'agents', 'scout.md')) });
    // One name in two scopes is listed once, in the scope the CLI runs it from.
    expect(children(dir(out, 'directory:user:agents'))).toEqual([]);
  });

  it('matches a synced skill by its namespaced name and by its bare one', () => {
    const { config } = roots({
      'config/skills/synced/acct/manifest.json': JSON.stringify({ skills: [{ name: 'docs' }, { name: 'pdf' }] }),
      'config/skills/synced/acct/docs/SKILL.md': skill('docs'),
      'config/skills/synced/acct/pdf/SKILL.md': skill('pdf'),
    });
    const out = customizationsOf({}, [], [{ name: 'anthropic-skills:docs' }, { name: 'pdf' }], undefined, [], undefined, [], diskOf({ configDir: config }));
    expect(dir(out, 'directory:synced:skills')).toMatchObject({ name: 'synced', writable: false, uri: uriOf(join(config, 'skills', 'synced')) });
    expect(children(dir(out, 'directory:synced:skills')).map((one) => [one.name, one.uri])).toEqual([
      ['anthropic-skills:docs', uriOf(join(config, 'skills', 'synced', 'acct', 'docs', 'SKILL.md'))],
      ['pdf', uriOf(join(config, 'skills', 'synced', 'acct', 'pdf', 'SKILL.md'))],
    ]);
  });

  it('puts a skill, a command and an agent with no file in the builtin directories', () => {
    const { config } = roots({});
    const out = customizationsOf({ commands: [{ name: 'code-review' }, { name: 'compact' }], agents: [{ name: 'Explore' }] }, [],
      [{ name: 'code-review' }], undefined, [], undefined, [], diskOf({ configDir: config }));
    expect(dir(out, 'directory:builtin:skills')).toMatchObject({ uri: 'claude-internal:/skills', name: 'builtin', writable: false, contents: 'skill' });
    expect(leaf(out, 'directory:builtin:skills', 'code-review')).toMatchObject({ uri: 'claude-internal:/skill/code-review' });
    expect(leaf(out, 'directory:builtin:commands', 'compact')).toMatchObject({ uri: 'claude-internal:/command/compact' });
    expect(leaf(out, 'directory:builtin:agents', 'Explore')).toMatchObject({ uri: 'claude-internal:/agent/Explore' });
  });

  it('gives a plugin skill its SKILL.md when the plugin has it', () => {
    const { root } = roots({ 'acme/skills/lint/SKILL.md': skill('lint') });
    const out = customizationsOf({}, [], [{ name: 'acme:lint' }, { name: 'acme:gone' }], undefined, [{ name: 'acme', path: join(root, 'acme') }]);
    const plugin = byType(out, 'plugin');
    expect(children(plugin).map((one) => [one.name, one.uri])).toEqual([
      ['lint', `${join(root, 'acme')}/skills/lint/SKILL.md`],
      ['gone', 'claude-internal:/skill/gone'],
    ]);
  });

  it('gives a command its file, and leaves out a command a skill has the name of', () => {
    const { config } = roots({
      'config/commands/review.md': '# Review\n',
      'config/skills/writing/SKILL.md': skill('writing'),
    });
    const out = customizationsOf({ commands: [{ name: 'review' }, { name: 'writing' }] }, [], [{ name: 'writing' }],
      undefined, [], undefined, [], diskOf({ configDir: config }));
    expect(children(dir(out, 'directory:user:commands'))).toEqual([
      { type: 'prompt', id: 'command:review', name: 'review', uri: uriOf(join(config, 'commands', 'review.md')), enabled: true },
    ]);
    expect(leaf(out, 'directory:user:skills', 'writing')).toBeDefined();
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
      ['directory:project:agents', uriOf(join(work, '.claude', 'agents')), 'agents', true],
      ['directory:project:skills', uriOf(join(work, '.claude', 'skills')), 'skills', true],
      ['directory:project:commands', uriOf(join(work, '.claude', 'commands')), 'commands', true],
      ['directory:project:rules', uriOf(join(work, '.claude', 'rules')), 'rules', true],
      ['directory:user:agents', uriOf(join(config, 'agents')), 'agents', true],
      ['directory:user:skills', uriOf(join(config, 'skills')), 'skills', true],
      ['directory:user:commands', uriOf(join(config, 'commands')), 'commands', true],
      ['directory:user:rules', uriOf(join(config, 'rules')), 'rules', true],
    ]);
    // The read-only ones are sent only with something in them.
    expect(dir(out, 'directory:managed:skills')).toBeUndefined();
    expect(dir(out, 'directory:synced:skills')).toBeUndefined();
  });

  it('sends no project directories for a session with no working directory', () => {
    const { config } = roots({});
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: config }));
    expect(out.map((one) => one.id)).toEqual(['directory:user:agents', 'directory:user:skills', 'directory:user:commands', 'directory:user:rules']);
  });

  it('sends the personal directories once for a session in the home folder', () => {
    const { work } = roots({ 'work/CLAUDE.md': '# Home\n' });
    // The home folder's `.claude` is the personal folder.
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: join(work, '.claude'), cwd: work }));
    expect(out.map((one) => one.id)).toEqual(['directory:user:agents', 'directory:user:skills', 'directory:user:commands', 'directory:user:rules']);
    expect(children(dir(out, 'directory:user:rules')).map((one) => one.uri)).toEqual([uriOf(join(work, 'CLAUDE.md'))]);
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

  it('lists the memory files and the rules of each scope', () => {
    const { config, work } = roots({
      'config/CLAUDE.md': '# Me\n',
      'work/CLAUDE.md': '# Project\n',
      'work/.claude/rules/api.md': '---\ndescription: The api\npaths:\n  - src/api/**\n---\n',
    });
    const out = customizationsOf({}, [], [], undefined, [], undefined, [], diskOf({ configDir: config, cwd: work }));
    expect(children(dir(out, 'directory:user:rules'))).toEqual([
      { type: 'rule', id: `rule:user:${join(config, 'CLAUDE.md')}`, uri: uriOf(join(config, 'CLAUDE.md')), name: 'CLAUDE.md', enabled: true, alwaysApply: true },
    ]);
    expect(children(dir(out, 'directory:project:rules'))).toEqual([
      { type: 'rule', id: `rule:project:${join(work, 'CLAUDE.md')}`, uri: uriOf(join(work, 'CLAUDE.md')), name: 'CLAUDE.md', enabled: true, alwaysApply: true },
      { type: 'rule', id: `rule:project:${join(work, '.claude', 'rules', 'api.md')}`, uri: uriOf(join(work, '.claude', 'rules', 'api.md')), name: 'api.md', enabled: true, description: 'The api', globs: ['src/api/**'] },
    ]);
  });
});

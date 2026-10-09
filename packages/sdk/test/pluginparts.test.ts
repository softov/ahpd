import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { uriOf } from '../src/fileuri.js';
import { partsOf } from '../src/pluginparts.js';

/*
 * What a plugin holds, read off a copy of it.
 *
 * A client hands a plugin over as a tree of files, and the host copies that tree
 * to a directory here. What is read here is that directory: which of its files
 * are parts, what each part is called, and what a part is named by. A part is
 * named by the file it came from, so the ids are the URIs of the files in the
 * copy, and they are asserted as whole values rather than looked at field by
 * field.
 */

/** A plugin on this host's disk: each file by its path under the plugin root. */
const place = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-pluginparts-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
};

/** What the file at a path in the copy is named by, which is what a part of it is named by too. */
const at = (dir: string, path: string): string => uriOf(join(dir, path));

const gone = (dir: string): void => rmSync(dir, { recursive: true, force: true });

/** A hooks file that declares one command on one lifecycle. */
const HOOKS = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } });

it('lists every kind of part, in the order a client reads them', () => {
  const dir = place({
    '.claude-plugin/plugin.json': '{"name":"one"}',
    'agents/reviewer.md': '---\nname: reviewer\n---\n',
    'skills/triage/SKILL.md': '---\ndescription: triage it\n---\n',
    'rules/style.mdc': '',
    'hooks/hooks.json': HOOKS,
    '.mcp.json': '{"mcpServers":{"a":{"command":"node"}}}',
  });

  expect(partsOf(dir, uriOf(dir))).toEqual([
    { type: 'agent', id: at(dir, 'agents/reviewer.md'), uri: at(dir, 'agents/reviewer.md'), name: 'reviewer' },
    { type: 'skill', id: at(dir, 'skills/triage/SKILL.md'), uri: at(dir, 'skills/triage/SKILL.md'), name: 'triage' },
    { type: 'rule', id: at(dir, 'rules/style.mdc'), uri: at(dir, 'rules/style.mdc'), name: 'style' },
    { type: 'hook', id: at(dir, 'hooks/hooks.json'), uri: at(dir, 'hooks/hooks.json'), name: 'hooks.json' },
    {
      type: 'mcpServer',
      id: `${at(dir, '.mcp.json')}#mcp=a`,
      uri: at(dir, '.mcp.json'),
      name: 'a',
      state: { kind: 'stopped' },
    },
  ]);
  gone(dir);
});

it('reads a component where the manifest moved it, and the usual folder only where it says so', () => {
  const dir = place({
    '.plugin/plugin.json': JSON.stringify({
      agents: { paths: ['crew'], exclusive: true },
      skills: { paths: ['abilities'], exclusive: true },
      rules: ['book'],
    }),
    'crew/writer.md': '',
    'agents/stranger.md': '',
    'abilities/summarise/SKILL.md': '',
    'skills/stranger/SKILL.md': '',
    'book/tone.instructions.md': '',
    'rules/stranger.mdc': '',
  });

  // An `exclusive` path is the whole of where a component is read, so the agents
  // and the skills are the moved ones alone. A list of paths is added to the
  // usual folder instead, so the rules are both.
  expect(partsOf(dir, uriOf(dir))).toEqual([
    { type: 'agent', id: at(dir, 'crew/writer.md'), uri: at(dir, 'crew/writer.md'), name: 'writer' },
    { type: 'skill', id: at(dir, 'abilities/summarise/SKILL.md'), uri: at(dir, 'abilities/summarise/SKILL.md'), name: 'summarise' },
    { type: 'rule', id: at(dir, 'rules/stranger.mdc'), uri: at(dir, 'rules/stranger.mdc'), name: 'stranger' },
    { type: 'rule', id: at(dir, 'book/tone.instructions.md'), uri: at(dir, 'book/tone.instructions.md'), name: 'tone' },
  ]);
  gone(dir);
});

it('reads a path out of the plugin as no path at all', () => {
  const dir = place({
    '.claude-plugin/plugin.json': '{"agents":{"paths":["../elsewhere"]}}',
    'agents/here.md': '',
  });

  expect(partsOf(dir, uriOf(dir))).toEqual([
    { type: 'agent', id: at(dir, 'agents/here.md'), uri: at(dir, 'agents/here.md'), name: 'here' },
  ]);
  gone(dir);
});

it('reads the servers and the hooks a manifest holds itself', () => {
  const dir = place({
    '.claude-plugin/plugin.json': JSON.stringify({
      mcpServers: { a: { command: 'node' } },
      hooks: { SessionStart: [{ command: 'echo hi' }] },
    }),
    '.mcp.json': '{"mcpServers":{"b":{"command":"node"}}}',
    'hooks/hooks.json': HOOKS,
  });

  // A server or a hook the manifest declares is declared in the manifest, and
  // neither file on disk is read for a plugin that already said what it holds.
  const manifest = at(dir, '.claude-plugin/plugin.json');
  expect(partsOf(dir, uriOf(dir))).toEqual([
    { type: 'hook', id: manifest, uri: manifest, name: 'plugin.json' },
    { type: 'mcpServer', id: `${manifest}#mcp=a`, uri: manifest, name: 'a', state: { kind: 'stopped' } },
  ]);
  gone(dir);
});

it('reads a skill at the plugin root when the folders hold none', () => {
  const dir = place({
    '.claude-plugin/plugin.json': '{}',
    'SKILL.md': '---\nname: one\n---\n',
    'skills/.keep': '',
  });

  // A skill is named after the folder its `SKILL.md` is in, and the plugin root
  // is the folder this one is in: what the file's own frontmatter calls it is
  // not read here, because nothing but the name is.
  expect(partsOf(dir, uriOf(dir))).toEqual([
    { type: 'skill', id: at(dir, 'SKILL.md'), uri: at(dir, 'SKILL.md'), name: basename(dir) },
  ]);
  gone(dir);
});

it('names a part by a URI, escaping what a folder is really called', () => {
  const dir = place({
    '.claude-plugin/plugin.json': '{}',
    'skills/two words/SKILL.md': '',
  });

  // A folder with a space in it is one URI segment with a space in it, and a
  // reader that opened the part's uri unescaped would look for nothing.
  expect(partsOf(dir, uriOf(dir))).toEqual([
    {
      type: 'skill',
      id: `${uriOf(dir)}/skills/two%20words/SKILL.md`,
      uri: `${uriOf(dir)}/skills/two%20words/SKILL.md`,
      name: 'two words',
    },
  ]);
  gone(dir);
});

it('answers an empty list for a plugin that holds nothing', () => {
  const dir = place({ '.claude-plugin/plugin.json': '{"name":"one"}' });

  expect(partsOf(dir, uriOf(dir))).toEqual([]);
  gone(dir);
});

it('answers nothing for a format this host does not read', () => {
  // A Copilot plugin, which is a manifest at the root and no manifest this host
  // knows: its files are not read, and a plugin nobody read is not a plugin with
  // no parts.
  const dir = place({ 'plugin.json': '{"name":"one"}', 'agents/here.md': '' });

  expect(partsOf(dir, uriOf(dir))).toBeUndefined();
  gone(dir);
});

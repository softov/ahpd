import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configDirOf, filesOf, managedDirOf, projectDirOf } from '../src/session/disk.js';

/*
 * The disk read the customizations are laid out from.
 *
 * Each case writes the files where the CLI would read them, under a fresh
 * folder, and reads them back through `filesOf`.
 */

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A fresh folder with each file of `files` written under it. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-disk-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const named = (name: string): string => `---\nname: ${name}\n---\n`;

describe('the files of each scope', () => {
  it('reads the managed skills from the managed directory', () => {
    const root = tree({ 'managed/.claude/skills/policy/SKILL.md': named('policy') });
    expect(filesOf({ configDir: join(root, 'config'), managedDir: join(root, 'managed') })).toEqual([
      { kind: 'skill', name: 'policy', scope: 'managed', path: join(root, 'managed', '.claude', 'skills', 'policy', 'SKILL.md') },
    ]);
  });

  /*
   * The managed subagents, which the CLI reads from the managed directory's
   * `.claude/agents` and ranks over a project's and a person's.
   * https://code.claude.com/docs/en/sub-agents
   */
  it('reads the managed agents from the managed directory', () => {
    const root = tree({ 'managed/.claude/agents/auditor.md': named('auditor') });
    expect(filesOf({ configDir: join(root, 'config'), managedDir: join(root, 'managed') })).toEqual([
      { kind: 'agent', name: 'auditor', scope: 'managed', path: join(root, 'managed', '.claude', 'agents', 'auditor.md') },
    ]);
  });

  it('reads the personal skills, commands as skills, agents and rules from the config directory', () => {
    const root = tree({
      'skills/writing/SKILL.md': named('writing'),
      'commands/review.md': '# Review\n',
      'agents/scout.md': named('scout'),
      'CLAUDE.md': '# Me\n',
      'rules/style.md': '# Style\n',
    });
    expect(filesOf({ configDir: root })).toEqual([
      { kind: 'skill', name: 'writing', scope: 'user', path: join(root, 'skills', 'writing', 'SKILL.md') },
      { kind: 'skill', name: 'review', scope: 'user', path: join(root, 'commands', 'review.md') },
      { kind: 'agent', name: 'scout', scope: 'user', path: join(root, 'agents', 'scout.md') },
      { kind: 'rule', name: 'CLAUDE.md', scope: 'user', path: join(root, 'CLAUDE.md') },
      { kind: 'rule', name: 'style.md', scope: 'user', path: join(root, 'rules', 'style.md') },
    ]);
  });

  it('reads the project files from the working directory and its .claude, a command as a skill', () => {
    const root = tree({
      'work/.claude/skills/build/SKILL.md': named('build'),
      'work/.claude/commands/ship.md': '# Ship\n',
      'work/.claude/agents/tester.md': named('tester'),
      'work/CLAUDE.md': '# Project\n',
      'work/.claude/CLAUDE.md': '# Also project\n',
      'work/CLAUDE.local.md': '# Mine here\n',
      'work/.claude/rules/deep/api.md': '# Api\n',
    });
    const work = join(root, 'work');
    expect(filesOf({ configDir: join(root, 'config'), cwd: work })).toEqual([
      { kind: 'skill', name: 'build', scope: 'project', path: join(work, '.claude', 'skills', 'build', 'SKILL.md') },
      { kind: 'skill', name: 'ship', scope: 'project', path: join(work, '.claude', 'commands', 'ship.md') },
      { kind: 'agent', name: 'tester', scope: 'project', path: join(work, '.claude', 'agents', 'tester.md') },
      { kind: 'rule', name: 'CLAUDE.md', scope: 'project', path: join(work, 'CLAUDE.md') },
      { kind: 'rule', name: 'CLAUDE.md', scope: 'project', path: join(work, '.claude', 'CLAUDE.md') },
      { kind: 'rule', name: 'CLAUDE.local.md', scope: 'project', path: join(work, 'CLAUDE.local.md') },
      { kind: 'rule', name: 'api.md', scope: 'project', path: join(work, '.claude', 'rules', 'deep', 'api.md') },
    ]);
  });

  it('reads a session in the home folder as the personal scope alone', () => {
    const root = tree({
      '.claude/skills/writing/SKILL.md': named('writing'),
      '.claude/CLAUDE.md': '# Me\n',
      'CLAUDE.md': '# Home\n',
    });
    expect(projectDirOf({ configDir: join(root, '.claude'), cwd: root })).toBeUndefined();
    expect(filesOf({ configDir: join(root, '.claude'), cwd: root })).toEqual([
      { kind: 'skill', name: 'writing', scope: 'user', path: join(root, '.claude', 'skills', 'writing', 'SKILL.md') },
      { kind: 'rule', name: 'CLAUDE.md', scope: 'user', path: join(root, '.claude', 'CLAUDE.md') },
      { kind: 'rule', name: 'CLAUDE.md', scope: 'user', path: join(root, 'CLAUDE.md') },
    ]);
  });

  it('reads the synced skills each manifest lists', () => {
    const root = tree({
      'skills/synced/acct/manifest.json': JSON.stringify({ skills: [{ name: 'docs' }] }),
      'skills/synced/acct/docs/SKILL.md': named('docs'),
    });
    expect(filesOf({ configDir: root })).toEqual([
      { kind: 'skill', name: 'docs', scope: 'synced', path: join(root, 'skills', 'synced', 'acct', 'docs', 'SKILL.md') },
    ]);
  });
});

describe('what each file is read for', () => {
  it('names a skill by its frontmatter, and by its folder when that names nothing', () => {
    const root = tree({
      'skills/folder-a/SKILL.md': named('called-a'),
      'skills/folder-b/SKILL.md': '# No frontmatter\n',
    });
    expect(filesOf({ configDir: root }).map((one) => one.name)).toEqual(['called-a', 'folder-b']);
  });

  it('leaves out a synced skill whose file is not there, and a name that leaves its folder', () => {
    const root = tree({
      'skills/synced/acct/manifest.json': JSON.stringify({ skills: [{ name: 'gone' }, { name: '..' }, { name: 'here' }] }),
      'skills/synced/acct/here/SKILL.md': named('here'),
      'skills/synced/SKILL.md': named('outside'),
    });
    expect(filesOf({ configDir: root }).filter((one) => one.scope === 'synced').map((one) => one.name)).toEqual(['here']);
  });

  it('takes a rule\'s globs from its paths, as a list or one value', () => {
    const root = tree({
      'rules/list.md': '---\ndescription: The api\npaths:\n  - "src/api/**"\n  - test/**\n---\n',
      'rules/inline.md': '---\npaths: [src/**, docs/**]\n---\n',
      'rules/one.md': '---\npaths: lib/**\n---\n',
      'rules/always.md': '# Always\n',
    });
    expect(filesOf({ configDir: root }).map(({ name, description, globs }) => ({ name, description, globs }))).toEqual([
      { name: 'always.md', description: undefined, globs: undefined },
      { name: 'inline.md', description: undefined, globs: ['src/**', 'docs/**'] },
      { name: 'list.md', description: 'The api', globs: ['src/api/**', 'test/**'] },
      { name: 'one.md', description: undefined, globs: ['lib/**'] },
    ]);
  });

  it('reads only a regular file, and only the first 64 KB of it', () => {
    const root = tree({
      'skills/near/SKILL.md': `---\nname: inside\n---\n${'x'.repeat(70 * 1024)}`,
      'skills/far/SKILL.md': `---\npad: ${'x'.repeat(70 * 1024)}\nname: beyond\n---\n`,
    });
    // A folder named like the file is not one.
    mkdirSync(join(root, 'skills', 'hollow', 'SKILL.md'), { recursive: true });
    expect(filesOf({ configDir: root }).map((one) => one.name)).toEqual(['far', 'inside']);
  });

  it('returns nothing, and throws nothing, for a missing folder or one the read fails on', () => {
    // A file where a folder should be fails the read of that folder.
    const root = tree({ skills: 'not a folder', agents: 'not a folder' });
    expect(filesOf({ configDir: root, cwd: join(root, 'missing'), managedDir: join(root, 'missing') })).toEqual([]);
  });
});

describe('where the scopes are', () => {
  it('answers the managed directory of each platform', () => {
    expect(managedDirOf('linux')).toBe('/etc/claude-code');
    expect(managedDirOf('freebsd')).toBe('/etc/claude-code');
    expect(managedDirOf('darwin')).toBe('/Library/Application Support/ClaudeCode');
    expect(managedDirOf('win32')).toBe('C:\\Program Files\\ClaudeCode');
  });

  it('takes the config directory a session sets over the default', () => {
    expect(configDirOf({ CLAUDE_CONFIG_DIR: '/elsewhere' })).toBe('/elsewhere');
  });
});

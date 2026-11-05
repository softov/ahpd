import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/** What a customization file is, in the protocol's words for it. */
export type DiskKind = 'skill' | 'prompt' | 'agent' | 'rule';

/**
 * Where a customization file was read from.
 *
 * `managed` is what an administrator installs for every person on the
 * machine, `user` is the person's own config directory, `project` is the
 * working directory's `.claude`, and `synced` is the skills a person's account
 * syncs into the config directory.
 */
export type DiskScope = 'managed' | 'user' | 'synced' | 'project';

/** One customization file found on disk. */
export interface DiskFile {
  kind: DiskKind;
  /** The name the CLI knows it by. */
  name: string;
  scope: DiskScope;
  /** The absolute path of the file. */
  path: string;
  /** A rule's own description, from its frontmatter. */
  description?: string;
  /** A rule's `paths`, the files it applies to. */
  globs?: string[];
}

/** Where each scope is read from. */
export interface DiskRoots {
  /** The personal scope: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
  configDir: string;
  /** The session's working directory, whose `.claude` is the project scope. */
  cwd?: string;
  /** The managed directory, whose `.claude/skills` and `.claude/agents` an administrator writes. */
  managedDir?: string;
}

/** What a session's customizations are laid out from: the scopes and what was found in them. */
export type Disk = DiskRoots & { files: DiskFile[] };

/** The most of a file read for its frontmatter. */
const FILE_MOST = 64 * 1024;

/** How deep the rules folders are walked, which a link back up stops at. */
const RULE_DEPTH = 32;

/** The most rule files read from one folder, so a huge tree is not a walk per switch. */
const RULE_MOST = 1000;

/** The personal scope for an environment: its `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export const configDirOf = (env?: Record<string, unknown>): string => {
  const set = env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR;
  return typeof set === 'string' && set !== '' ? set : join(homedir(), '.claude');
};

/** Where the CLI reads managed settings and skills on each platform. */
export const managedDirOf = (platform: NodeJS.Platform = process.platform): string =>
  platform === 'darwin' ? '/Library/Application Support/ClaudeCode'
    : platform === 'win32' ? 'C:\\Program Files\\ClaudeCode'
      : '/etc/claude-code';

/**
 * The project scope's folder, `<cwd>/.claude`, or none. A session started in
 * the home folder has the personal folder as that, and one folder is one scope:
 * the personal one.
 */
export const projectDirOf = (roots: DiskRoots): string | undefined => {
  if (roots.cwd === undefined) return undefined;
  const project = join(roots.cwd, '.claude');
  return resolve(project) === resolve(roots.configDir) ? undefined : project;
};

const unquote = (raw: string): string => {
  const value = raw.trim();
  return value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]
    ? value.slice(1, -1)
    : value;
};

/**
 * The frontmatter of a file, as flat keys with a value or a list of values.
 *
 * Only a regular file is read, and only its first 64 KB: a path here can be a
 * link a person made, and a device or a huge file would hold the host up for
 * a name. A file that cannot be read is `undefined`, and a file with no
 * frontmatter is an empty record.
 *
 * Enough of YAML for what a customization file carries: `key: value`, a
 * `key:` followed by `- item` lines, and `key: [a, b]`.
 */
export function frontmatterOf(path: string): Record<string, string | string[]> | undefined {
  let text: string;
  try {
    if (!statSync(path).isFile()) return undefined;
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(FILE_MOST);
      text = buffer.subarray(0, readSync(fd, buffer, 0, FILE_MOST, 0)).toString('utf8');
    }
    finally { closeSync(fd); }
  }
  catch { return undefined; }
  const out: Record<string, string | string[]> = {};
  if (!text.startsWith('---')) return out;
  const lines = (text.split(/^---\r?$/m)[1] ?? '').split(/\r?\n/);
  for (let at = 0; at < lines.length; at += 1) {
    const found = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[at] as string);
    if (found === null) continue;
    const key = found[1] as string;
    const raw = (found[2] as string).trim();
    if (raw === '') {
      const items: string[] = [];
      while (at + 1 < lines.length && /^\s+-\s/.test(lines[at + 1] as string)) {
        at += 1;
        items.push(unquote((lines[at] as string).replace(/^\s+-\s/, '')));
      }
      if (items.length > 0) out[key] = items;
    }
    else if (raw.startsWith('[') && raw.endsWith(']')) {
      out[key] = raw.slice(1, -1).split(',').map(unquote).filter((one) => one !== '');
    }
    else out[key] = unquote(raw);
  }
  return out;
}

const text = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** The names in a folder, or none when it is missing or cannot be read. */
const namesIn = (dir: string): string[] => {
  try { return readdirSync(dir).sort(); }
  catch { return []; }
};

const isFile = (path: string): boolean => {
  try { return statSync(path).isFile(); }
  catch { return false; }
};

/** A name that is one path segment, so a manifest cannot point outside its folder. */
const oneSegment = (name: string): boolean => name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name);

/** The skills of one folder, each in `<folder>/<skill>/SKILL.md` one level down. */
function skillsIn(dir: string, scope: DiskScope): DiskFile[] {
  const out: DiskFile[] = [];
  for (const folder of namesIn(dir)) {
    const path = join(dir, folder, 'SKILL.md');
    const front = frontmatterOf(path);
    if (front === undefined) continue;
    out.push({ kind: 'skill', name: text(front.name) ?? folder, scope, path });
  }
  return out;
}

/**
 * The synced skills, listed by the `manifest.json` of each folder under
 * `skills/synced`. A skill whose `SKILL.md` is not there is left out.
 */
function syncedIn(dir: string): DiskFile[] {
  const out: DiskFile[] = [];
  for (const id of namesIn(dir)) {
    const manifest = join(dir, id, 'manifest.json');
    let skills: unknown;
    try {
      const held = statSync(manifest);
      if (!held.isFile() || held.size > FILE_MOST * 16) continue;
      skills = (JSON.parse(readFileSync(manifest, 'utf8')) as { skills?: unknown }).skills;
    }
    catch { continue; }
    if (!Array.isArray(skills)) continue;
    for (const skill of skills) {
      const name = (skill as { name?: unknown } | null)?.name;
      if (typeof name !== 'string' || !oneSegment(name)) continue;
      const path = join(dir, id, name, 'SKILL.md');
      if (isFile(path)) out.push({ kind: 'skill', name, scope: 'synced', path });
    }
  }
  return out;
}

/** The `*.md` files of one folder, not of its subfolders, as commands or agents. */
function markdownIn(dir: string, kind: 'prompt' | 'agent', scope: DiskScope): DiskFile[] {
  const out: DiskFile[] = [];
  for (const file of namesIn(dir)) {
    if (!file.toLowerCase().endsWith('.md')) continue;
    const path = join(dir, file);
    const front = frontmatterOf(path);
    if (front === undefined) continue;
    const own = file.slice(0, -3);
    // An agent is run by the name its frontmatter gives; a command by its file's.
    out.push({ kind, name: kind === 'agent' ? (text(front.name) ?? own) : own, scope, path });
  }
  return out;
}

/** Every `*.md` under a folder, in path order, as far down as `RULE_DEPTH`. */
function markdownUnder(dir: string, depth = 0, found: string[] = []): string[] {
  if (depth > RULE_DEPTH) return found;
  for (const name of namesIn(dir)) {
    if (found.length >= RULE_MOST) break;
    const path = join(dir, name);
    let held;
    try { held = statSync(path); }
    catch { continue; }
    if (held.isDirectory()) markdownUnder(path, depth + 1, found);
    else if (held.isFile() && name.toLowerCase().endsWith('.md')) found.push(path);
  }
  return found;
}

/** A memory file, `CLAUDE.md` and its siblings, which applies always. */
const memory = (path: string, scope: DiskScope): DiskFile[] =>
  isFile(path) ? [{ kind: 'rule', name: basename(path), scope, path }] : [];

/** The rules of a `rules` folder, each scoped to the files its `paths` names. */
function rulesIn(dir: string, scope: DiskScope): DiskFile[] {
  const out: DiskFile[] = [];
  for (const path of markdownUnder(dir)) {
    const front = frontmatterOf(path);
    if (front === undefined) continue;
    const paths = front.paths;
    const globs = (Array.isArray(paths) ? paths : typeof paths === 'string' ? [paths] : []).filter((one) => one !== '');
    const description = text(front.description);
    out.push({
      kind: 'rule',
      name: basename(path),
      scope,
      path,
      ...(description !== undefined ? { description } : {}),
      ...(globs.length > 0 ? { globs } : {}),
    });
  }
  return out;
}

/**
 * The skill, command, agent and rule files of each scope.
 *
 * Read from disk because the CLI reports what it loaded and never where it
 * came from. A folder that is missing or cannot be read gives nothing, and
 * nothing here throws.
 */
export function filesOf(roots: DiskRoots): DiskFile[] {
  const { configDir, cwd, managedDir } = roots;
  const project = projectDirOf(roots);
  const out: DiskFile[] = [];
  if (managedDir !== undefined) {
    out.push(...skillsIn(join(managedDir, '.claude', 'skills'), 'managed'));
    /*
     * The managed subagents, which the CLI reads from the managed settings
     * directory's `.claude/agents` and ranks over a project's and a person's.
     * https://code.claude.com/docs/en/sub-agents
     */
    out.push(...markdownIn(join(managedDir, '.claude', 'agents'), 'agent', 'managed'));
  }
  out.push(...skillsIn(join(configDir, 'skills'), 'user'));
  if (project !== undefined) out.push(...skillsIn(join(project, 'skills'), 'project'));
  out.push(...syncedIn(join(configDir, 'skills', 'synced')));
  for (const [root, scope] of [[configDir, 'user'], ...(project === undefined ? [] : [[project, 'project']])] as [string, DiskScope][]) {
    out.push(...markdownIn(join(root, 'commands'), 'prompt', scope));
    out.push(...markdownIn(join(root, 'agents'), 'agent', scope));
  }
  out.push(...memory(join(configDir, 'CLAUDE.md'), 'user'), ...rulesIn(join(configDir, 'rules'), 'user'));
  if (cwd !== undefined) {
    // The home folder's own memory files are the personal scope's, as its `.claude` is.
    const own: DiskScope = project === undefined ? 'user' : 'project';
    out.push(
      ...memory(join(cwd, 'CLAUDE.md'), own),
      ...(project === undefined ? [] : memory(join(project, 'CLAUDE.md'), own)),
      ...memory(join(cwd, 'CLAUDE.local.md'), own),
      ...(project === undefined ? [] : rulesIn(join(project, 'rules'), own)),
    );
  }
  return out;
}

/** The scopes, with what the disk read finds in them now. */
export const diskOf = (roots: DiskRoots): Disk => ({ ...roots, files: filesOf(roots) });

import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/**
 * What a customization file is, in the protocol's words for it. A command is
 * a `skill`, as VS Code's Claude scan folds one into the skills. An
 * `mcpServer` is a server a settings or `.mcp.json` file declares, and its
 * path is the file that declares it; a `hook` is a settings file that
 * declares hooks.
 */
export type DiskKind = 'skill' | 'agent' | 'rule' | 'hook' | 'mcpServer';

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
  /** A skill's, an agent's or a rule's own description, from its frontmatter. */
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
    const description = text(front.description);
    out.push({ kind: 'skill', name: text(front.name) ?? folder, scope, path, ...(description !== undefined ? { description } : {}) });
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

/** The `*.md` files of one folder, not of its subfolders, as commands (skills) or agents. */
function markdownIn(dir: string, kind: 'skill' | 'agent', scope: DiskScope): DiskFile[] {
  const out: DiskFile[] = [];
  for (const file of namesIn(dir)) {
    if (!file.toLowerCase().endsWith('.md')) continue;
    const path = join(dir, file);
    const front = frontmatterOf(path);
    if (front === undefined) continue;
    const own = file.slice(0, -3);
    const description = text(front.description);
    // An agent is run by the name its frontmatter gives; a command by its file's.
    out.push({ kind, name: kind === 'agent' ? (text(front.name) ?? own) : own, scope, path, ...(description !== undefined ? { description } : {}) });
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

/** A JSON file's object, or nothing when it is missing, too large, not a regular file or not an object. */
const objectIn = (path: string): Record<string, unknown> | undefined => {
  try {
    const held = statSync(path);
    if (!held.isFile() || held.size > FILE_MOST * 16) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  }
  catch { return undefined; }
};

/**
 * The MCP servers the settings and `.mcp.json` files declare, each named by
 * the file that declares it, as VS Code's Claude scan reads them: the
 * project's `settings.json`, then the working directory's `.mcp.json`, then
 * the personal `settings.json`, the first file to declare a name taking it. A
 * `settings.json` declares its `mcpServers` block, and a `.mcp.json` its
 * `mcpServers` block or, with none, its whole object.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/scan/claudeMcpScan.ts#L10-L76
 */
function serversIn(roots: DiskRoots): DiskFile[] {
  // The home folder's own files are the personal scope's, as its `.claude` is.
  const own: DiskScope = projectDirOf(roots) === undefined ? 'user' : 'project';
  const sources: [string, DiskScope][] = [
    ...(roots.cwd === undefined ? [] : [
      [join(roots.cwd, '.claude', 'settings.json'), own],
      [join(roots.cwd, '.mcp.json'), own],
    ] as [string, DiskScope][]),
    [join(roots.configDir, 'settings.json'), 'user'],
  ];
  const out: DiskFile[] = [];
  for (const [path, scope] of sources) {
    const object = objectIn(path);
    if (object === undefined) continue;
    const block = Object.hasOwn(object, 'mcpServers') ? object.mcpServers : path.endsWith('.mcp.json') ? object : undefined;
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    for (const [name, config] of Object.entries(block)) {
      if (typeof config !== 'object' || config === null || Array.isArray(config)) continue;
      if (out.some((one) => one.name === name)) continue;
      out.push({ kind: 'mcpServer', name, scope, path });
    }
  }
  return out;
}

/** The lifecycle events a hook is declared for, in Claude's spelling and in Copilot's. */
const HOOK_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'UserPromptTransformed', 'PreToolUse', 'PostToolUse',
  'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'ErrorOccurred',
  'sessionStart', 'sessionEnd', 'userPromptSubmitted', 'userPromptTransformed', 'preToolUse', 'postToolUse',
  'preCompact', 'subagentStart', 'agentStop', 'subagentStop', 'errorOccurred',
]);

/**
 * Whether a settings file declares a hook, as VS Code's parser reads one: the
 * file does not say `disableAllHooks`, and its `hooks` block (or the file
 * itself) names a lifecycle event with a command, an item's own or one of its
 * nested `hooks`. A command has no `type` or the type `command`, and a command
 * line for some platform.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentPlugins/common/pluginParsers.ts#L774-L957
 */
const declaresHooks = (object: Record<string, unknown>): boolean => {
  if (object.disableAllHooks === true) return false;
  const block = typeof object.hooks === 'object' && object.hooks !== null && !Array.isArray(object.hooks)
    ? object.hooks as Record<string, unknown>
    : object;
  const isCommand = (raw: unknown): boolean => {
    if (typeof raw !== 'object' || raw === null) return false;
    const command = raw as Record<string, unknown>;
    return (command.type === undefined || command.type === 'command')
      && ['command', 'bash', 'powershell', 'windows', 'linux', 'osx'].some((key) => typeof command[key] === 'string' && command[key] !== '');
  };
  return Object.entries(block).some(([event, items]) => HOOK_EVENTS.has(event) && Array.isArray(items) && items.some((item) => {
    const nested = typeof item === 'object' && item !== null ? (item as Record<string, unknown>).hooks : undefined;
    return Array.isArray(nested) ? nested.some(isCommand) : isCommand(item);
  }));
};

/**
 * The settings files that declare hooks, as VS Code's Claude scan reads them:
 * the working directory's `.claude/settings.json` and `settings.local.json`,
 * then the personal `settings.json`, each file once.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/scan/claudeHookScan.ts#L11-L71
 */
function hooksIn(roots: DiskRoots): DiskFile[] {
  // The home folder's own files are the personal scope's, as its `.claude` is.
  const own: DiskScope = projectDirOf(roots) === undefined ? 'user' : 'project';
  const sources: [string, DiskScope][] = [
    ...(roots.cwd === undefined ? [] : [
      [join(roots.cwd, '.claude', 'settings.json'), own],
      [join(roots.cwd, '.claude', 'settings.local.json'), own],
    ] as [string, DiskScope][]),
    [join(roots.configDir, 'settings.json'), 'user'],
  ];
  const out: DiskFile[] = [];
  for (const [path, scope] of sources) {
    if (out.some((one) => resolve(one.path) === resolve(path))) continue;
    const object = objectIn(path);
    if (object !== undefined && declaresHooks(object)) out.push({ kind: 'hook', name: basename(path), scope, path });
  }
  return out;
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
 * The skill, command, agent and rule files of each scope, its settings files
 * that declare hooks, and the MCP servers its settings declare.
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
  /*
   * A scope's commands, as skills after its skills, so a skill of one name is
   * the one found, as VS Code's Claude scan folds them.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/scan/claudeAgentSkillScan.ts#L58-L74
   */
  for (const [root, scope] of [[configDir, 'user'], ...(project === undefined ? [] : [[project, 'project']])] as [string, DiskScope][]) {
    out.push(...markdownIn(join(root, 'commands'), 'skill', scope));
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
  out.push(...hooksIn(roots), ...serversIn(roots));
  return out;
}

/** The scopes, with what the disk read finds in them now. */
export const diskOf = (roots: DiskRoots): Disk => ({ ...roots, files: filesOf(roots) });

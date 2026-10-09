/**
 * The parts a plugin holds, read off the copy on this host's disk.
 *
 * A client hands a session a plugin as a URI and a revision, and the host copies
 * it to a directory here before any backend can open it. What the plugin holds
 * is read here: its agents, skills, rules, hooks and MCP servers, as the
 * `children` of its entry in the session's customizations. A client reads that
 * list to show what a plugin brings, and switches one of its servers off from it.
 *
 * Two formats are read, which are the two a plugin is handed over in: a Claude
 * plugin, whose manifest is `.claude-plugin/plugin.json`, and an Open Plugins
 * one, whose manifest is `.plugin/plugin.json`. A directory with neither is a
 * plugin this host lists with no parts rather than one it guesses a format for.
 * Both formats keep their hooks in `hooks/hooks.json` and their servers in
 * `.mcp.json`, and both let the manifest move any of that or declare it inline.
 *
 * A part is named the way VS Code's agent host names one: by the URI of its own
 * file inside this copy, and that URI is the part's id as well. The copy is what
 * is read, so the copy is what a part is named by, and a client that reads one
 * reads the file the host would. A server has no file of its own - several sit
 * in one - so the URI of the file that declares it carries the server's name in
 * a fragment, which is what tells two servers of one file apart.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { readJsonObject } from './jsonfile.js';
import { isRecord, strings } from './values.js';
import type { Bag } from './types/common.js';

/** One part as it was found: what it is called, and the file it came out of. */
interface Found {
  readonly name: string;
  readonly path: string;
}

/** Where one format keeps its manifest, and the hooks file it reads when the manifest names none. */
interface Format {
  readonly manifest: string;
  readonly hooks: string;
}

/**
 * The two formats this host reads, in the order it looks for one.
 *
 * A Claude plugin and an Open Plugins one agree on where everything else is and
 * differ in the manifest alone, so the manifest is all that is listed here.
 */
const FORMATS: readonly Format[] = [
  { manifest: '.claude-plugin/plugin.json', hooks: 'hooks/hooks.json' },
  { manifest: '.plugin/plugin.json', hooks: 'hooks/hooks.json' },
];

/** The suffix a rule's file carries, and the longer one the other spelling carries. */
const RULE_SUFFIX = '.mdc';
const INSTRUCTION_SUFFIX = '.instructions.md';

/** The lifecycle events a hooks file may name, in either spelling a format writes them. */
const HOOK_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'ErrorOccurred',
  'sessionStart', 'sessionEnd', 'userPromptSubmitted', 'preToolUse', 'postToolUse',
  'agentStop', 'subagentStop', 'errorOccurred',
]);

/** The fields a hook entry runs its command from, the command itself first. */
const COMMAND_FIELDS = ['command', 'bash', 'powershell', 'windows', 'linux', 'osx'];

/** A file that is there. */
const isFile = (path: string): boolean => {
  try { return statSync(path).isFile(); } catch { return false; }
};

/** A directory that is there. */
const isDir = (path: string): boolean => {
  try { return statSync(path).isDirectory(); } catch { return false; }
};

/** What is directly under a directory, and nothing at all for a directory that is not there. */
const children = (dir: string, wanted: (path: string) => boolean): string[] => {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.map((name) => join(dir, name)).filter(wanted);
};

/** The files directly under one, which is where the parts of a component sit. */
const filesIn = (dir: string): string[] => children(dir, isFile);

/** The directories directly under one, which is where a skill's `SKILL.md` is looked for. */
const dirsIn = (dir: string): string[] => children(dir, isDir);

/** A path inside another, which is where every path a manifest names has to land. */
const within = (root: string, path: string): boolean => {
  const rest = relative(root, path);
  return !rest.startsWith('..') && !isAbsolute(rest);
};

/** One part before another, by the name a person reads. */
const byName = (one: Found, other: Found): number => one.name.localeCompare(other.name);

/**
 * Where a component's files are, as a manifest names them.
 *
 * A manifest names one place as a string, as a list of strings, or as an object
 * with `paths` and `exclusive`. `exclusive` drops the conventional folder, so a
 * plugin that says where its skills are has its skills only there.
 */
interface Places {
  readonly paths: readonly string[];
  readonly exclusive: boolean;
}

/** A manifest that names nowhere, which is every manifest that does not mention the component. */
const NOWHERE: Places = { paths: [], exclusive: false };

/** The names in a manifest's list, each without the space around it and none of them empty. */
const namesIn = (values: unknown): string[] =>
  strings(values).map((one) => one.trim()).filter((one) => one !== '');

const placesIn = (named: unknown): Places => {
  if (typeof named === 'string') {
    const one = named.trim();
    return one === '' ? NOWHERE : { paths: [one], exclusive: false };
  }
  if (Array.isArray(named)) return { paths: namesIn(named), exclusive: false };
  if (isRecord(named) && Array.isArray(named.paths)) {
    return { paths: namesIn(named.paths), exclusive: named.exclusive === true };
  }
  return NOWHERE;
};

/**
 * The places a component is read from: the conventional one, unless the manifest
 * drops it, and then whatever the manifest names instead.
 *
 * A path that leaves the plugin is dropped rather than read. The copy is the
 * client's content, and a manifest is not a way to reach past what it sent.
 */
const placesFor = (dir: string, usual: string, section: unknown): string[] => {
  const places = placesIn(section);
  const found = places.exclusive ? [] : [join(dir, usual)];
  for (const one of places.paths) {
    const at = join(dir, one);
    if (within(dir, at)) found.push(at);
  }
  return found;
};

/** Whether a component is declared in the manifest file itself: an object that names no `paths`. */
const declaredInline = (section: unknown): Record<string, unknown> | undefined =>
  (isRecord(section) && !Object.hasOwn(section, 'paths') ? section : undefined);

/** Every file a place holds: the place itself where it is a file, and otherwise what is directly under it. */
const filesAt = (places: readonly string[]): string[] =>
  places.flatMap((place) => (isFile(place) ? [place] : filesIn(place)));

/** The files of a component by their name, the first of a name winning, sorted by name. */
const namedFiles = (paths: readonly string[], nameOf: (path: string) => string | undefined): Found[] => {
  const found = new Map<string, Found>();
  for (const path of paths) {
    const name = nameOf(path);
    if (name !== undefined && !found.has(name)) found.set(name, { name, path });
  }
  return [...found.values()].sort(byName);
};

/** The `.md` files of a component, each named without the suffix, which is how an agent is named. */
const markdownIn = (places: readonly string[]): Found[] =>
  namedFiles(filesAt(places), (path) =>
    (extname(path).toLowerCase() === '.md' ? basename(path).slice(0, -'.md'.length) : undefined));

/** The suffix a rule's file carries, which is what comes off the name, or nothing where the file is not a rule. */
const ruleSuffix = (path: string): string | undefined => {
  const name = basename(path).toLowerCase();
  if (name.endsWith(RULE_SUFFIX)) return RULE_SUFFIX;
  if (name.endsWith(INSTRUCTION_SUFFIX)) return INSTRUCTION_SUFFIX;
  return undefined;
};

/** The rule files of a component, each named without its suffix. */
const rulesIn = (places: readonly string[]): Found[] =>
  namedFiles(filesAt(places), (path) => {
    const suffix = ruleSuffix(path);
    return suffix === undefined ? undefined : basename(path).slice(0, -suffix.length);
  });

/**
 * The skills a plugin holds, each named after the directory its `SKILL.md` is in.
 *
 * A place that has a `SKILL.md` of its own is one skill named after the place,
 * so a `triage` folder is a skill and so is a `skills` folder holding one file.
 * Otherwise every directory under the place with a `SKILL.md` is a skill.
 */
const skillsIn = (places: readonly string[]): Found[] => {
  const found = new Map<string, Found>();
  const add = (name: string, path: string): void => {
    if (!found.has(name)) found.set(name, { name, path });
  };
  for (const place of places) {
    const own = join(place, 'SKILL.md');
    if (isFile(own)) { add(basename(place), own); continue; }
    for (const dir of dirsIn(place)) {
      const skill = join(dir, 'SKILL.md');
      if (isFile(skill)) add(basename(dir), skill);
    }
  }
  return [...found.values()].sort(byName);
};

/** The skills of a plugin, and the `SKILL.md` at its own root where it holds none anywhere else. */
const skillsOf = (dir: string, places: readonly string[]): Found[] => {
  const found = skillsIn(places);
  if (found.length > 0) return found;
  const root = join(dir, 'SKILL.md');
  return isFile(root) ? [{ name: basename(dir), path: root }] : [];
};

/** Whether one hook entry runs a command of its own. */
const namesCommand = (entry: unknown): boolean => {
  if (!isRecord(entry)) return false;
  if (entry.type !== undefined && entry.type !== 'command') return false;
  return COMMAND_FIELDS.some((one) => typeof entry[one] === 'string' && entry[one] !== '');
};

/** Whether one entry of a lifecycle runs a command: its own, or one under the `hooks` it carries. */
const entryCommands = (entry: unknown): boolean =>
  (isRecord(entry) && Array.isArray(entry.hooks) ? entry.hooks.some(namesCommand) : namesCommand(entry));

/** Whether a hooks file declares anything: a lifecycle this host knows, with a command under it. */
const declaresHooks = (json: unknown): boolean => {
  if (!isRecord(json) || json.disableAllHooks === true) return false;
  const events = isRecord(json.hooks) ? json.hooks : json;
  return Object.entries(events).some(([id, entries]) =>
    (HOOK_EVENTS.has(id) && Array.isArray(entries) && entries.some(entryCommands)));
};

/**
 * The hooks file a plugin declares in, which is one part or none.
 *
 * A manifest may hold the hooks itself rather than name a file, and then the
 * manifest is the file they are declared in. Otherwise the places are read in
 * order and the first that is there and declares a command is the one.
 */
const hooksIn = (dir: string, format: Format, section: unknown): Found[] => {
  const manifest = join(dir, format.manifest);
  const inline = declaredInline(section);
  if (inline !== undefined && declaresHooks(inline)) return [{ name: basename(manifest), path: manifest }];
  for (const place of placesFor(dir, format.hooks, section)) {
    const read = readJsonObject(place);
    if (read.ok && declaresHooks(read.value)) return [{ name: basename(place), path: place }];
  }
  return [];
};

/** The servers a file declares: the map under `mcpServers`, or the file itself where it holds them bare. */
const serversIn = (json: unknown): string[] => {
  if (!isRecord(json)) return [];
  const map = isRecord(json.mcpServers) ? json.mcpServers : json;
  // A name whose value is not an object names no server: the protocol asks for a
  // configuration, and a string in its place is a server this host cannot read.
  return Object.entries(map)
    .filter(([, config]) => isRecord(config))
    .map(([name]) => name)
    .sort((one, other) => one.localeCompare(other));
};

/**
 * The servers a plugin declares, each with the file it is declared in.
 *
 * Servers the manifest holds itself are declared in the manifest, and they win
 * over anything on disk when there are any. Otherwise each place is read and the
 * first file to declare a name is the one that server is in, so a second file
 * naming it again does not move it.
 */
const serversOf = (dir: string, format: Format, section: unknown): Found[] => {
  const manifest = join(dir, format.manifest);
  const inline = declaredInline(section);
  const written = inline === undefined
    ? []
    : serversIn({ mcpServers: inline }).map((name) => ({ name, path: manifest }));
  if (written.length > 0) return written;
  const found = new Map<string, Found>();
  for (const place of placesFor(dir, '.mcp.json', section)) {
    const read = readJsonObject(place);
    if (!read.ok) continue;
    for (const name of serversIn(read.value)) {
      if (!found.has(name)) found.set(name, { name, path: place });
    }
  }
  return [...found.values()].sort(byName);
};

/**
 * The parts a plugin holds, or nothing where its format is not one this host reads.
 *
 * `dir` is the plugin's directory on this host's disk and `uri` is that same
 * directory as a URI, which is what its parts are named under: a part is read
 * from a path here and named by where it landed, so the two are handed over
 * together rather than one being worked out from the other.
 *
 * A plugin whose manifest is there and which holds nothing answers an empty
 * list, and that is a different answer from this one: an empty list is a plugin
 * that was read and contributes nothing, and nothing at all is a plugin nobody
 * has read yet.
 *
 * The order is VS Code's, which is the order a client reads a plugin in: agents,
 * skills, rules, hooks, then servers. Two parts with one id are one part, so a
 * file reached by two of the manifest's places is listed once.
 */
export function partsOf(dir: string, uri: string): Bag[] | undefined {
  const format = FORMATS.find((one) => existsSync(join(dir, one.manifest)));
  if (format === undefined) return undefined;
  const read = readJsonObject(join(dir, format.manifest));
  const manifest: Bag = read.ok ? read.value : {};

  // The URI a part hangs under. A directory handed over with a trailing slash
  // would otherwise name every part of it with two.
  const base = uri.endsWith('/') ? uri.slice(0, -1) : uri;
  /**
   * What one file of this copy is called: the copy's URI, then the file's path
   * under it, one URI segment at a time.
   *
   * A folder or a file is named in a URI as an escaped segment, so the name goes
   * in escaped: a file called `my agent.md` is `my%20agent.md`, which is what a
   * reader of the part's URI opens.
   */
  const at = (path: string): string =>
    `${base}/${relative(dir, path).split(sep).map(encodeURIComponent).join('/')}`;
  /** One part named by its file, which is a part with a file of its own: everything but a server. */
  const part = (type: string, one: Found): Bag => {
    const where = at(one.path);
    return { type, id: where, uri: where, name: one.name };
  };
  /**
   * One server's part.
   *
   * Its file is the one that declares it, and the server's own name goes in a
   * fragment of the id, so two servers of one file are two parts. A `#` the
   * file's URI already carries is escaped first, so a name that looks like a
   * fragment cannot collide with one that was there.
   *
   * The state is the one a declared server is in: no backend has started it, and
   * `stopped` is what says so without claiming a turn is coming.
   */
  const server = (one: Found): Bag => {
    const where = at(one.path);
    return {
      type: 'mcpServer',
      id: `${where.replace(/#/g, '%23')}#mcp=${encodeURIComponent(one.name)}`,
      uri: where,
      name: one.name,
      state: { kind: 'stopped' },
    };
  };

  const agents = markdownIn(placesFor(dir, 'agents', manifest.agents));
  const skills = skillsOf(dir, placesFor(dir, 'skills', manifest.skills));
  const rules = rulesIn(placesFor(dir, 'rules', manifest.rules));
  const hooks = hooksIn(dir, format, manifest.hooks);
  const servers = serversOf(dir, format, manifest.mcpServers);

  const parts: Bag[] = [];
  const listed = new Set<string>();
  const add = (one: Bag): void => {
    if (listed.has(one.id as string)) return;
    listed.add(one.id as string);
    parts.push(one);
  };
  for (const one of agents) add(part('agent', one));
  for (const one of skills) add(part('skill', one));
  for (const one of rules) add(part('rule', one));
  for (const one of hooks) add(part('hook', one));
  for (const one of servers) add(server(one));
  return parts;
}

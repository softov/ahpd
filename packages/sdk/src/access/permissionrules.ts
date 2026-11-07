import { posix } from 'node:path';
import { escapeRegExpCharacters, globRegexOf } from './commandautoapprover.js';
import type { PermissionKind } from '../types/permissions.js';

/*
 * VS Code's permission rules, the grammar a session's and the host's
 * `permissions` lists are written in: `Shell`, `Shell(<command>)`,
 * `Shell(commandLine:<pattern>)`, `WebFetch(<url pattern>)`,
 * `Read(<path>)`, `Edit(<path>)`, and a bare tool name.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts
 */

/** Where a grant picked from a question's options is kept: the session's `permissions`, or the host's. */
export type PermissionGrantScope = 'session' | 'host';

const SESSION_GRANT_OPTION_PREFIX = 'allow-session-rules:';
const HOST_GRANT_OPTION_PREFIX = 'allow-always-rules:';
const SHELL_REGEX_SPECIFIER = /^\/(?<pattern>.*)\/(?<flags>[dgimsuvy]*)$/;

/** A grant as the id of the option that offers it. */
export const permissionGrantOptionId = (scope: PermissionGrantScope, rules: readonly string[]): string =>
  (scope === 'session' ? SESSION_GRANT_OPTION_PREFIX : HOST_GRANT_OPTION_PREFIX) + JSON.stringify(rules);

/** The grant an option's id carries, or nothing for any other id or a payload that does not read. */
export const parsePermissionGrantOptionId = (id: string): { scope: PermissionGrantScope; rules: string[] } | undefined => {
  const prefix = [SESSION_GRANT_OPTION_PREFIX, HOST_GRANT_OPTION_PREFIX].find((one) => id.startsWith(one));
  if (prefix === undefined) return undefined;
  try {
    const rules: unknown = JSON.parse(id.slice(prefix.length));
    return Array.isArray(rules) && rules.every((one) => typeof one === 'string')
      ? { scope: prefix === SESSION_GRANT_OPTION_PREFIX ? 'session' : 'host', rules: rules as string[] }
      : undefined;
  }
  catch {
    return undefined;
  }
};

/** What a question asks for, whatever the backend calls its tool. */
export interface PermissionRequest {
  kind: PermissionKind | undefined;
  toolName: string;
  shellLanguage?: 'bash' | 'powershell';
  url?: string;
  /** An absolute path, for a read or a write. */
  path?: string;
}

/** The folder a relative path rule is read against, and the home a `~/` one is. */
export interface PermissionRuleContext {
  workingDirectory?: string;
  homeDirectory: string;
  ignorePathCase?: boolean;
}

/** A rule's tool and its specifier, absent for `*` and for none. */
interface ParsedRule {
  tool: string;
  specifier?: string;
}

/** Whether a rule names a whole request: a bare `Shell`, a `WebFetch`, a `Read` or `Edit` path, or a tool's name. */
export const matchesPermissionRule = (rule: string, request: PermissionRequest, context: PermissionRuleContext): boolean => {
  const parsed = parseRule(rule);
  if (parsed === undefined) return false;
  switch (parsed.tool) {
    case 'Shell':
      return request.kind === 'shell' && parsed.specifier === undefined;
    case 'WebFetch':
      return request.kind === 'url' && (parsed.specifier === undefined || matchesWebFetch(parsed.specifier, request.url));
    case 'Read':
    case 'Edit':
      return request.kind === (parsed.tool === 'Read' ? 'read' : 'write')
        && (parsed.specifier === undefined || matchesPath(parsed.specifier, request.path, context));
    default:
      return parsed.specifier === undefined && parsed.tool === request.toolName;
  }
};

/** Whether a `Shell` rule names one sub-command, by its text, a wildcard or a `/regex/flags`; PowerShell ignores case. */
export const matchesShellSubCommand = (rule: string, subCommand: string, language: 'bash' | 'powershell'): boolean => {
  const parsed = parseRule(rule);
  return parsed?.tool === 'Shell'
    && parsed.specifier?.startsWith('commandLine:') !== true
    && (parsed.specifier === undefined || matchesShellSpecifier(parsed.specifier, subCommand, language));
};

/** Whether a `Shell(commandLine:<pattern>)` rule names the whole command line. */
export const matchesShellCommandLine = (rule: string, commandLine: string, language: 'bash' | 'powershell'): boolean => {
  const parsed = parseRule(rule);
  return parsed?.tool === 'Shell' && parsed.specifier?.startsWith('commandLine:') === true
    && matchesShellSpecifier(parsed.specifier.slice('commandLine:'.length), commandLine, language);
};

const matchesShellSpecifier = (specifier: string, command: string, language: 'bash' | 'powershell'): boolean => {
  if (specifier === '') return false;
  const regex = SHELL_REGEX_SPECIFIER.exec(specifier);
  if (regex?.groups !== undefined) {
    try {
      const flags = regex.groups.flags ?? '';
      return new RegExp(regex.groups.pattern ?? '', language === 'powershell' && !flags.includes('i') ? `${flags}i` : flags).test(command.trim());
    }
    catch {
      return false;
    }
  }
  const pattern = specifier.endsWith(':*') ? `${specifier.slice(0, -2)} *` : specifier;
  const prefix = pattern.endsWith(' *') && pattern.indexOf('*') === pattern.length - 1;
  const expression = prefix
    ? `${escapeRegExpCharacters(pattern.slice(0, -2))}(?: .*)?`
    : pattern.split('*').map(escapeRegExpCharacters).join('.*');
  return new RegExp(`^${expression}$`, language === 'powershell' ? 'is' : 's').test(command.trim());
};

/** A grant for every command that starts with a prefix, the bare prefix among them. */
export const shellPrefixRule = (prefix: string): string => {
  const command = prefix.trim();
  return command.startsWith('commandLine:')
    ? `Shell(${String(new RegExp(`^${escapeRegExpCharacters(command)}(?: .*)?$`, 's'))})`
    : `Shell(${command} *)`;
};

/** A grant for one command exactly, or nothing for an empty one, a wildcard or unbalanced parentheses. */
export const shellExactRule = (subCommand: string): string | undefined => {
  const command = subCommand.trim();
  if (command === '' || command.includes('*') || !balanced(command)) return undefined;
  return command.startsWith('commandLine:') || SHELL_REGEX_SPECIFIER.test(command)
    ? `Shell(${String(new RegExp(`^${escapeRegExpCharacters(command)}$`))})`
    : `Shell(${command})`;
};

/** A grant for fetching from a URL pattern. */
export const webFetchRule = (pattern: string): string => `WebFetch(${pattern})`;

/** A grant for one absolute file, or a folder and everything under it, or nothing for a glob or unbalanced parentheses. */
export const pathRule = (tool: 'Read' | 'Edit', absolutePath: string, recursive: boolean): string | undefined => {
  const normalized = normalizePath(absolutePath);
  if (!isAbsolutePath(normalized) || /[*?[\]{}]/.test(absolutePath) || !balanced(absolutePath)) return undefined;
  const specifier = recursive ? posix.join(normalized, '**') : normalized;
  return `${tool}(${normalized.startsWith('/') ? '/' : '//'}${specifier})`;
};

/** Whether a `Read` or `Edit` rule names one absolute path, with no glob. */
export const isExactAbsolutePathRule = (rule: string): boolean => {
  const parsed = parseRule(rule);
  if ((parsed?.tool !== 'Read' && parsed?.tool !== 'Edit') || parsed.specifier === undefined) return false;
  const specifier = parsed.specifier.replace(/\\/g, '/');
  return (specifier.startsWith('//') || /^[a-z]:\//i.test(specifier)) && !/[*?[\]{}]/.test(specifier);
};

/** A rule's tool and specifier: the first `(` and the closing `)` delimit the specifier. */
const parseRule = (rule: string): ParsedRule | undefined => {
  const value = rule.trim();
  const opening = value.indexOf('(');
  const tool = opening === -1 ? value : value.slice(0, opening);
  if (tool === '' || /[\s()]/.test(tool)) return undefined;
  if (opening === -1) return { tool };
  if (!value.endsWith(')')) return undefined;
  const specifier = value.slice(opening + 1, -1);
  const shellRegex = tool === 'Shell' && (specifier.startsWith('/') || specifier.startsWith('commandLine:/'));
  if (specifier.trim() === '' || (!shellRegex && !balanced(specifier))) return undefined;
  return specifier === '*' ? { tool } : { tool, specifier };
};

const balanced = (value: string): boolean => {
  let depth = 0;
  for (const character of value) {
    if (character === '(') depth += 1;
    else if (character === ')' && --depth < 0) return false;
  }
  return depth === 0;
};

/*
 * A `WebFetch` pattern against a URL, as VS Code's URL approval reads one: an
 * http(s) URL's scheme, its host with a `*.` subdomain wildcard and `:*` any
 * port, and its path as a prefix with `*` wildcards; a pattern with no scheme
 * is an https one. Read through the WHATWG URL parser, which lowercases a host
 * and resolves a path the way a fetch would.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/url/common/urlGlob.ts
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/url/common/urlApprovalPatterns.ts#L161-L183
 */
const matchesWebFetch = (specifier: string, url: string | undefined): boolean => {
  if (url === undefined) return false;
  let target: { scheme: string; authority: string; path: string } | undefined;
  try {
    const parsed = new URL(url);
    target = parsed.host === '' || parsed.username !== '' || parsed.password !== ''
      ? undefined
      : { scheme: parsed.protocol.slice(0, -1), authority: parsed.host, path: parsed.pathname.replace(/\/+$/, '') };
  }
  catch {
    return false;
  }
  // The pattern's own parts, which a wildcard keeps out of the URL parser: its
  // scheme before `://`, https where it names none, its host up to the first
  // `/`, `?` or `#`, and its path to the first `?` or `#`.
  const cut = specifier.indexOf('://');
  const named = cut !== -1 && ['.', '/', ':'].every((one) => !specifier.slice(0, cut).includes(one));
  const scheme = named ? specifier.slice(0, cut) : 'https';
  const rest = named ? specifier.slice(cut + 3) : specifier;
  const ends = ['/', '?', '#'].map((one) => rest.indexOf(one)).filter((one) => one !== -1);
  const hostEnd = ends.length === 0 ? rest.length : Math.min(...ends);
  const tail = rest.slice(hostEnd);
  const pathEnd = ['?', '#'].map((one) => tail.indexOf(one)).filter((one) => one !== -1);
  const glob = {
    scheme: scheme.toLowerCase(),
    authority: rest.slice(0, hostEnd).toLowerCase(),
    path: (tail.startsWith('/') ? tail.slice(0, pathEnd.length === 0 ? tail.length : Math.min(...pathEnd)) : '').replace(/\/+$/, ''),
  };
  if (target === undefined || glob.authority === '') return false;
  if (!urlPartMatches(target.scheme, glob.scheme) || !urlPartMatches(target.authority, glob.authority, true)) return false;
  if (glob.path === '' || glob.path === '/') return true;
  return urlPartMatches(target.path, glob.path);
};

/** One part of a URL against a pattern's: equal, a prefix up to a `/`, or `*` wildcards, `*.` for subdomains and `:*` for any port. */
const urlPartMatches = (part: string, glob: string, portLogic = false): boolean => {
  if (part === glob) return true;
  if (!glob.includes('*')) return part.startsWith(`${glob}/`);
  const pending = new Map<number, Set<number>>();
  const add = (at: number, globAt: number): void => {
    const held = pending.get(at) ?? new Set<number>();
    held.add(globAt);
    pending.set(at, held);
  };
  add(0, 0);
  for (let at = 0; at <= part.length && pending.size > 0; at++) {
    const offsets = pending.get(at);
    if (offsets === undefined) continue;
    for (const globAt of offsets) {
      const anyPort = portLogic && glob[globAt] === ':' && glob[globAt + 1] === '*';
      if (at === part.length) {
        if (globAt === glob.length || (anyPort && globAt + 2 === glob.length)) return true;
        continue;
      }
      if (globAt === glob.length) {
        if (part[at] === '/') return true;
        continue;
      }
      if (part[at] === glob[globAt]) add(at + 1, globAt + 1);
      if (glob[globAt] === '*') {
        if (globAt + 1 === glob.length) return true;
        if (glob[globAt + 1] === '.') {
          if (!['/', ':'].includes(part[at] ?? '')) add(at + 1, globAt);
          if (at === 0 || part[at - 1] === '.') add(at, globAt + 2);
        }
        add(at + 1, at + 1 === part.length ? globAt + 1 : globAt);
        add(at, globAt + 1);
      }
      if (anyPort) {
        let end = at;
        if (part[at] === ':') {
          end += 1;
          do { end += 1; } while (/[0-9]/.test(part[end] ?? ''));
        }
        add(end, globAt + 2);
      }
    }
    pending.delete(at);
  }
  return false;
};

/** A path rule against a path: `//` absolute, `~/` the home's, anything else the working folder's; read without following links. */
const matchesPath = (specifier: string, path: string | undefined, context: PermissionRuleContext): boolean => {
  if (path === undefined) return false;
  const candidate = normalizePath(path);
  if (!isAbsolutePath(candidate)) return false;
  let pattern = specifier.replace(/\\/g, '/');
  if (pattern.startsWith('//')) {
    pattern = pattern.slice(1);
    if (/^\/[a-z]:\//i.test(pattern)) pattern = pattern.slice(1);
  }
  else if (pattern.startsWith('~/')) {
    const home = normalizePath(context.homeDirectory);
    if (!isAbsolutePath(home)) return false;
    pattern = posix.join(home, pattern.slice(2));
  }
  else if (!/^[a-z]:\//i.test(pattern)) {
    const folder = context.workingDirectory === undefined ? undefined : normalizePath(context.workingDirectory);
    if (folder === undefined || !isAbsolutePath(folder)) return false;
    pattern = posix.join(folder, pattern.startsWith('/') ? pattern.slice(1) : pattern);
  }
  const absolute = normalizePath(pattern);
  const glob = ['*', '?', '[', '{'].some((character) => absolute.includes(character));
  if (glob) return globRegexOf(absolute, context.ignorePathCase === true).test(candidate);
  return context.ignorePathCase === true ? absolute.toLowerCase() === candidate.toLowerCase() : absolute === candidate;
};

const normalizePath = (path: string): string => posix.normalize(path.replace(/\\/g, '/'));

const isAbsolutePath = (path: string): boolean => path.startsWith('/') || /^[a-z]:\//i.test(path);

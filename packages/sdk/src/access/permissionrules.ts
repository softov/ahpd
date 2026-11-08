import { posix } from 'node:path';
import type { PermissionKind } from '../types/permissions.js';
import { match } from '../vscode/glob.js';
import { escapeRegExpCharacters, regExpLeadsToEndlessLoop } from '../vscode/strings.js';
import { URI } from '../vscode/uri.js';
import { isUrlApproved } from '../vscode/urlapproval.js';

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
  const written = SHELL_REGEX_SPECIFIER.exec(specifier);
  if (written?.groups !== undefined) {
    try {
      const flags = written.groups.flags ?? '';
      const regex = new RegExp(written.groups.pattern ?? '', language === 'powershell' && !flags.includes('i') ? `${flags}i` : flags);
      return (regex.source === '.*' || !regExpLeadsToEndlessLoop(regex)) && regex.test(command.trim());
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

/** A `WebFetch` pattern as the URL approval pattern it is, https where it names no scheme. */
const normalizeWebFetchPattern = (pattern: string): string => (/^[^./:]*:\/\//.test(pattern) ? pattern : `https://${pattern}`);

/**
 * A `WebFetch` pattern against a URL, read by VS Code's URL approval: the
 * URL's scheme, its host with a `*.` subdomain wildcard and `:*` any port,
 * and its path as a prefix with `*` wildcards, both normalized as VS Code
 * normalizes a URL for trust.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L242-L251
 */
const matchesWebFetch = (specifier: string, url: string | undefined): boolean => {
  if (url === undefined || url === '') return false;
  try {
    return isUrlApproved(URI.parse(url), { [normalizeWebFetchPattern(specifier)]: true }, true);
  }
  catch {
    return false;
  }
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
  if (glob) return match(absolute, candidate, { ignoreCase: context.ignorePathCase === true });
  return context.ignorePathCase === true ? absolute.toLowerCase() === candidate.toLowerCase() : absolute === candidate;
};

const normalizePath = (path: string): string => posix.normalize(path.replace(/\\/g, '/'));

const isAbsolutePath = (path: string): boolean => path.startsWith('/') || /^[a-z]:\//i.test(path);

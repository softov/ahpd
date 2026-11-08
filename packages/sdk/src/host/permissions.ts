import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { realPathOf, suggestAutoApproveRuleKeys } from '../access/commandautoapprover.js';
import {
  isExactAbsolutePathRule, matchesPermissionRule, matchesShellCommandLine, matchesShellSubCommand, parsePermissionGrantOptionId,
  pathRule, permissionGrantOptionId, shellExactRule, shellPrefixRule, webFetchRule,
} from '../access/permissionrules.js';
import type { CommandApprovalEvaluation, CommandApprovalOptions, SensitiveEditLocation } from '../access/commandautoapprover.js';
import type { PermissionGrantScope, PermissionRequest, PermissionRuleContext } from '../access/permissionrules.js';
import type { Bag } from '../types/common.js';
import type { ManagedSettingsPermissions } from '../types/permissions.js';
import { extractDomainFromUri, matchesDomainPattern } from '../vscode/domainmatcher.js';
import { match } from '../vscode/glob.js';
import { buildManagedRule, ManagedRuleFamily } from '../vscode/managedrules.js';
import { matchesScheme, Schemas } from '../vscode/network.js';
import { URI } from '../vscode/uri.js';

/*
 * The questions a backend puts to a person about a tool call, as this host puts
 * them: whether a rule refuses it before anybody is asked, whether a setting or
 * a permission answers it, the options it offers, and the grants an answer
 * keeps, as VS Code's `SessionPermissionManager` owns them for every agent of
 * its host.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L203-L207
 */

/** The id of the option that keeps an approval for the session and the tool. */
export const ALLOW_SESSION_OPTION_ID = 'allow-session';
const ALLOW_ONCE_OPTION: Bag = { id: 'allow-once', label: 'Allow Once', kind: 'approve' };
const SKIP_OPTION: Bag = { id: 'skip', label: 'Skip', kind: 'deny', group: 2 };

/**
 * The options a question offers where its backend offers none, in VS Code's
 * words: an approval kept for the session and the tool, first; one for this
 * call alone; and the refusal.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L67-L76
 */
export const CONFIRMATION_OPTIONS: readonly Bag[] = [
  { id: ALLOW_SESSION_OPTION_ID, label: 'Allow in this Session', kind: 'approve', group: 1 },
  ALLOW_ONCE_OPTION,
  SKIP_OPTION,
];

/**
 * The options a question about a tool the operator's rule names offers, the
 * options of every backend included: an answer for this call alone, as VS
 * Code's host offers a question a managed policy asks.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L566-L610
 */
export const MANAGED_CONFIRMATION_OPTIONS: readonly Bag[] = [ALLOW_ONCE_OPTION, SKIP_OPTION];

/**
 * Whether the operator's rule makes a tool ask every time.
 *
 * `rules` is the daemon's `eligibleForAutoApproval`, VS Code's map of tool
 * name to boolean, and `false` is the one value that asks. An exact name is
 * read first and answers on its own: a `true` there keeps the tool eligible
 * even when its server is named with `false`. A name that is not there falls
 * back to `<server>/*`, one key for every tool of that server - the part of
 * the name before its first slash. No rules name no tool.
 */
export const asksForTool = (rules: Readonly<Record<string, boolean>> | undefined, tool: string): boolean => {
  if (rules === undefined) return false;
  if (Object.hasOwn(rules, tool)) return rules[tool] === false;
  const slash = tool.indexOf('/');
  if (slash <= 0) return false;
  return rules[`${tool.slice(0, slash)}/*`] === false;
};

/**
 * The MCP server a call's tool belongs to, by its name: the customization the
 * call's `contributor` names among the session's, a plugin's children
 * included, as AHP names an MCP tool's server on the call itself. Nothing for
 * a call no MCP server contributes.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1338-L1344
 */
export const mcpServerOf = (contributor: unknown, customizations: unknown): string | undefined => {
  const named = contributor as Bag | undefined;
  if (named?.kind !== 'mcp' || typeof named.customizationId !== 'string') return undefined;
  const every = (Array.isArray(customizations) ? customizations as Bag[] : [])
    .flatMap((one) => [one, ...(Array.isArray(one.children) ? one.children as Bag[] : [])]);
  const found = every.find((one) => one.id === named.customizationId);
  return typeof found?.name === 'string' ? found.name : undefined;
};

/**
 * Whether the operator's rule makes a question about a call's tool ask every
 * time, read from the name the call carries by each name the rule gives that
 * tool.
 *
 * Whose tool a call runs is its `contributor`'s to say, as AHP has a call say
 * it. A client's tool and a backend's own are named by the call's full tool
 * name. An MCP server's tool is `<server>/<tool>` to the rule, its server the
 * customization the contributor names among the session's: a rule names it
 * where its tool part is the call's tool name or the end of it after a `__`,
 * the way an MCP client names a server's tool, and `<server>/*` names every
 * tool of the server. A call no client and no MCP server of the session
 * contributes is a server-side tool's, and one of the tools this host offered,
 * `offered`, is `host/<name>`, a tool of the server VS Code's Claude carries
 * the host's tools on, its name read from the call's the same way. A rule
 * naming the tool answers on its own, as `asksForTool` reads an exact name
 * before the server's `<server>/*`.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1321-L1346
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeServerToolMcpServer.ts#L21
 */
export const alwaysAsks = (
  rules: Readonly<Record<string, boolean>> | undefined,
  toolName: string,
  offered: readonly string[],
  contributor?: unknown,
  customizations?: unknown,
): boolean => {
  if (asksForTool(rules, toolName)) return true;
  const server = mcpServerOf(contributor, customizations);
  const hosted = server === undefined && (contributor as Bag | undefined)?.kind !== 'client'
    ? offered.find((name) => toolName === name || toolName.endsWith(`__${name}`))
    : undefined;
  if (hosted !== undefined && asksForTool(rules, `host/${hosted}`)) return true;
  if (rules === undefined || server === undefined) return false;
  const named = Object.entries(rules).flatMap(([key, value]) =>
    (key.startsWith(`${server}/`) ? [{ tool: key.slice(server.length + 1), value }] : []));
  const exact = named.filter((one) => one.tool !== '*' && (one.tool === toolName || toolName.endsWith(`__${one.tool}`)));
  if (exact.length > 0) return exact.some((one) => one.value === false);
  return named.some((one) => one.tool === '*' && one.value === false);
};

/**
 * The options a question that asks to leave the sandbox offers: Allow, this
 * call alone, and Skip, as VS Code's host offers them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L77-L81
 */
export const SANDBOX_CONFIRMATION_OPTIONS: readonly Bag[] = [{ ...ALLOW_ONCE_OPTION, label: 'Allow' }, SKIP_OPTION];

/** The `_meta` key a question that asks to leave the sandbox is marked with, so no grant is kept from its answer. */
export const SANDBOX_BYPASS_META_KEY = 'agentHost.sandboxBypass';

/**
 * Writes that ask whatever the edit patterns say, VS Code's
 * `ALWAYS_CHECKED_EDIT_PATTERNS`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/chat/common/chatSettings.ts#L112-L126
 */
export const ALWAYS_CHECKED_EDIT_PATTERNS: Readonly<Record<string, boolean>> = {
  '**/.mcp.json': false,
  '**/.npmrc': false,
  '**/.vscode/*.json': false,
  '**/.github/agents/**': false,
  '**/.github/hooks/**': false,
  '**/.github/copilot/settings.json': false,
  '**/.github/copilot/settings.local.json': false,
  '**/.claude/agents/**': false,
  '**/.claude/settings.json': false,
  '**/.claude/settings.local.json': false,
  '**/.codex/agents/**': false,
  '**/.codex/config.toml': false,
  '**/.codex/hooks.json': false,
};

/** A permission list's rules: what it allows, refuses and asks about. */
export interface PermissionRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

/**
 * The rules of every `permissions` value given, each read as VS Code's host
 * reads one, an object whose `allow`, `deny` and `ask` are lists of rules and
 * any other value none, added together: the session's and the host's lists
 * are additive.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L888-L901
 */
export const permissionRulesOf = (...values: unknown[]): PermissionRules => {
  const read = values.flatMap((value): PermissionRules[] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const held = value as Bag;
    const lists = [held.allow, held.deny, held.ask];
    if (!lists.every((one) => one === undefined || (Array.isArray(one) && one.every((rule) => typeof rule === 'string')))) return [];
    return [{ allow: (held.allow ?? []) as string[], deny: (held.deny ?? []) as string[], ask: (held.ask ?? []) as string[] }];
  });
  return {
    allow: [...new Set(read.flatMap((one) => one.allow))],
    deny: [...new Set(read.flatMap((one) => one.deny))],
    ask: [...new Set(read.flatMap((one) => one.ask))],
  };
};

/**
 * A `permissions` value with rules added to `allow`, its `deny` and `ask` kept
 * as they are, or nothing where every rule is there already: VS Code's host
 * keeps a grant picked from a question as `allow` rules, in the session's
 * value or the host's. A value that is not one is read as no rules.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L1058-L1070
 */
export const withGrant = (value: unknown, rules: readonly string[]): Bag | undefined => {
  const lists = (one: unknown): boolean => one === undefined || (Array.isArray(one) && one.every((rule) => typeof rule === 'string'));
  const valid = typeof value === 'object' && value !== null && !Array.isArray(value)
    && lists((value as Bag).allow) && lists((value as Bag).deny) && lists((value as Bag).ask);
  const permissions: Bag = valid ? value as Bag : { allow: [], deny: [] };
  const allowed = (permissions.allow ?? []) as string[];
  const allow = [...new Set([...allowed, ...rules])];
  if (allow.length === allowed.length) return undefined;
  return { ...permissions, allow };
};

/** What the host's approval chain reads to decide a question, gathered by the host from the call, its session and its config. */
export interface ToolApproval {
  /** What the call asks for, by VS Code's kinds. */
  request: PermissionRequest;
  /** The command line of a shell call. */
  commandLine?: string;
  /** The call asks to leave its sandbox. */
  requestSandboxBypass?: boolean;
  /** A managed rule asks about the call. */
  managedApprovalRequired?: boolean;
  /** The session's and the host's permission rules, together. */
  rules: PermissionRules;
  /** The folder a relative rule is read against, and the home. */
  context: PermissionRuleContext;
  /** The session's working folders, as paths. */
  workingDirectories: readonly string[];
  /** The folder this host keeps the session's attachment snapshots in, where it keeps them as files. */
  attachmentsDirectory?: string;
  /** The local files and folders a person attached to the chat's turns. */
  attached: readonly string[];
  /** VS Code's global Allow All, `globalAutoApproveEnabled`. */
  globalAutoApprove: boolean;
  /** The session's own Allow All, its `autoApprove` level. */
  sessionAutoApprove: boolean;
  /** The managed lock that takes Allow All away. */
  bypassLocked: boolean;
  /** `terminalAutoApproveEnabled` is not off. */
  terminalAutoApprove: boolean;
  /**
   * The edit patterns a write inside the working folders is read against;
   * absent for a turn whose writes the patterns answer none of, which on a
   * host with people is a turn its session's owner did not send.
   */
  editPatterns?: Record<string, boolean>;
  /** The session's `sensitiveEditLocations`. */
  sensitive: readonly SensitiveEditLocation[];
  /** The host's command rules over a line, a permission's decision on each command and on the line laid on. */
  evaluateShell?: (options: Pick<CommandApprovalOptions, 'classify' | 'classifyCommandLine'>) => CommandApprovalEvaluation;
  /** Whether a path exists, for the folder grant's git root. */
  exists: (path: string) => boolean;
}

/** A path and the path it really is, links followed, or nothing where it cannot be read, which asks. */
const resolvedPaths = (path: string): string[] | undefined => {
  const real = realPathOf(path);
  if (real === undefined) return undefined;
  return real === path ? [path] : [path, real];
};

/** Whether a path is a folder or under it, blind to case where the platform's paths are. */
const inside = (path: string, folder: string, ignoreCase: boolean): boolean => {
  const spelled = (one: string): string => (ignoreCase ? one.toLowerCase() : one);
  const at = spelled(normalize(path));
  const parent = spelled(normalize(folder));
  return at === parent || at.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
};

/** The request's own name for a shell rule's language. */
const shellOf = (approval: ToolApproval): 'bash' | 'powershell' => approval.request.shellLanguage ?? 'bash';

/**
 * A permission's decision on a command, and on a whole line, from the
 * session's and the host's `Shell` rules: `ask` before `allow`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L715-L726
 */
const shellClassifiers = (approval: ToolApproval): Pick<CommandApprovalOptions, 'classify' | 'classifyCommandLine'> => {
  const { rules, request, context } = approval;
  const language = shellOf(approval);
  const classify = (matches: (rule: string) => boolean): 'allow' | 'ask' | undefined =>
    (rules.ask.some(matches) ? 'ask' : rules.allow.some(matches) ? 'allow' : undefined);
  return {
    classify: (command) => classify((rule) => matchesPermissionRule(rule, request, context) || matchesShellSubCommand(rule, command, language)),
    classifyCommandLine: (line) => classify((rule) => matchesShellCommandLine(rule, line, language)),
  };
};

/**
 * Whether a write is one an always-checked edit pattern names, or lands in a
 * sensitive location of the session.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L788-L814
 */
const requiresEditConfirmation = (paths: readonly string[], approval: ToolApproval): boolean => {
  const { ignorePathCase } = approval.context;
  if (paths.some((path) => Object.keys(ALWAYS_CHECKED_EDIT_PATTERNS).some((pattern) => match(pattern, path, { ignoreCase: ignorePathCase === true })))) return true;
  return approval.workingDirectories.some((folder) => approval.sensitive.some((location) => {
    const at = join(folder, location.path);
    const places = resolvedPaths(at) ?? [at];
    return paths.some((path) => places.some((place) => (location.isDirectory
      ? inside(path, place, ignorePathCase === true)
      : (ignorePathCase === true ? path.toLowerCase() === place.toLowerCase() : path === place))));
  }));
};

/**
 * Whether a write lands somewhere that always asks: a dotfile or dot-folder of
 * the home, or a platform's configuration folder unless the working folder is
 * inside it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L856-L871
 */
const platformRestricted = (path: string, folder: string, approval: ToolApproval): boolean => {
  const home = approval.context.homeDirectory;
  const ignoreCase = approval.context.ignorePathCase === true;
  if (inside(path, home, ignoreCase) && relative(home, path).split(sep)[0]?.startsWith('.') === true) return true;
  const restricted = process.platform === 'win32'
    ? [process.env.APPDATA, process.env.LOCALAPPDATA].filter((one): one is string => one !== undefined)
    : process.platform === 'darwin' ? [join(home, 'Library')] : [];
  for (const one of restricted) {
    if (inside(path, one, ignoreCase)) return !inside(folder, one, ignoreCase);
  }
  return false;
};

/**
 * Whether the edit patterns approve a write, as VS Code's host reads them:
 * from an approved start, the configured patterns and then the always-checked
 * ones, each that matches the path setting the answer to its own, so the last
 * matching pattern decides.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L873-L886
 */
const matchesEditAutoApprovePatterns = (path: string, patterns: Readonly<Record<string, boolean>>, ignoreCase: boolean): boolean => {
  let approved = true;
  for (const patternSet of [patterns, ALWAYS_CHECKED_EDIT_PATTERNS]) {
    for (const [pattern, configuredApproval] of Object.entries(patternSet)) {
      const isApproved = configuredApproval === true;
      if (isApproved !== approved && match(pattern, path, { ignoreCase })) approved = isApproved;
    }
  }
  return approved;
};

/**
 * Whether the session's or the host's permissions refuse the call before
 * anybody is asked: a rule naming the whole request, a shell rule naming the
 * line or one command of it, a path rule naming the path or the path it
 * really is.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L397-L433
 */
export const isDeniedByPermissions = (approval: ToolApproval, subCommands: readonly string[]): boolean => {
  const { rules, request, context } = approval;
  if (rules.deny.length === 0) return false;
  if (rules.deny.some((rule) => matchesPermissionRule(rule, request, context))) return true;
  if (request.kind === 'shell' && approval.commandLine !== undefined) {
    const language = shellOf(approval);
    if (rules.deny.some((rule) => matchesShellCommandLine(rule, approval.commandLine ?? '', language))) return true;
    const commands = subCommands.length > 0 ? subCommands : [approval.commandLine.trim()];
    return commands.some((command) => rules.deny.some((rule) => matchesShellSubCommand(rule, command, language)));
  }
  if ((request.kind === 'read' || request.kind === 'write') && request.path !== undefined) {
    const paths = resolvedPaths(request.path);
    if (paths === undefined) return rules.deny.some((rule) => rule.trim().startsWith(request.kind === 'read' ? 'Read(' : 'Edit('));
    return paths.some((path) => rules.deny.some((rule) => matchesPermissionRule(rule, { ...request, path }, context)));
  }
  return false;
};

/**
 * A managed rule's family and argument as the managed grammar reads the rule,
 * or nothing for a rule it refuses. The first `(` and a trailing `)` delimit
 * the argument; the family is `Shell`, `Read`, `Write` (with its alias `Edit`)
 * or `Domain`; and an argument is one VS Code's rule builder builds, written as
 * it writes it. The runtime that takes a managed document parses every rule
 * with this grammar and refuses the whole document for one it cannot read.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L58-L63
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L73-L203
 */
export const managedRuleOf = (rule: string): { family: ManagedRuleFamily; argument?: string } | undefined => {
  const opening = rule.indexOf('(');
  const named = opening === -1 ? rule : rule.slice(0, opening);
  const spelled = named === 'Edit' ? ManagedRuleFamily.Write : named;
  const family = Object.values(ManagedRuleFamily).find((one) => one === spelled);
  if (family === undefined) return undefined;
  if (opening === -1) return { family };
  if (!rule.endsWith(')')) return undefined;
  const built = buildManagedRule(family, rule.slice(opening + 1, -1));
  return built === undefined ? undefined : { family, argument: built.slice(family.length + 1, -1) };
};

/**
 * A managed `Shell`, `Read` or `Write` rule as the permission rule VS Code's
 * checks read it by, for the questions of its kind, or nothing for any other
 * rule: the family alone as every request of its kind, `Write` as `Edit`, and
 * `Shell(<command>)` with no wildcard as the command with its arguments too,
 * as VS Code reads the bare form.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L73-L177
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L190-L191
 */
const asPermissionRule = (rule: string): string[] => {
  const read = managedRuleOf(rule);
  if (read === undefined || read.family === ManagedRuleFamily.Domain) return [];
  const tool = read.family === ManagedRuleFamily.Write ? 'Edit' : read.family;
  if (read.argument === undefined) return [tool];
  return [`${tool}(${read.family === ManagedRuleFamily.Shell && !read.argument.includes('*') ? `${read.argument} *` : read.argument})`];
};

/**
 * Whether a managed `Domain` rule names a URL request's domain: the family
 * alone every one, and `Domain(<pattern>)`, an argument the managed grammar
 * reads as a URL with an implicit `https://`, a domain the pattern matches as
 * VS Code's network filter matches one. That is by the host alone, so a rule
 * names its host whatever the URL's scheme, port or path.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L179-L203
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L141-L146
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/networkFilter/common/domainMatcher.ts#L208-L241
 */
const domainRuleNames = (rule: string, domain: string | undefined): boolean => {
  const read = managedRuleOf(rule);
  if (read?.family !== ManagedRuleFamily.Domain) return false;
  return read.argument === undefined || (domain !== undefined && matchesDomainPattern(domain, read.argument));
};

/**
 * Whether the operator's managed rules refuse a call, or make it ask, read
 * on every question from every backend beside the session's permissions:
 * `deny` before `ask`, each rule on the questions of its kind (`Shell` on a
 * command, `Read` and `Write` on a file's read and write, `Domain` on a URL
 * request), so a managed deny is refused before anybody is asked and a
 * managed ask is put as a question a managed rule raised. `Shell`, `Read` and
 * `Write` are matched by the checks the session's own rules are, and `Domain`
 * by the domain VS Code's network filter reads from the URL.
 *
 * `limitTo` is the boundary of VS Code's network filter: a URL request it
 * applies to whose domain no rule of it names is refused as a deny is. It
 * applies to a URL with an authority and to an http, https, ws or wss one,
 * and a file URL passes it.
 *
 * This host's own check, carrying the enforcement VS Code's policy inventory
 * records as partial for its agents; a runtime that enforces managed settings
 * itself is handed them too, for the calls it never asks the host about.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostPolicySupport.ts#L46-L56
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/networkFilter/common/networkFilterService.ts#L20-L25
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/networkFilter/common/networkFilterService.ts#L104-L134
 */
export const managedDecision = (managed: ManagedSettingsPermissions | undefined, approval: ToolApproval, subCommands: readonly string[]): 'deny' | 'ask' | undefined => {
  if (managed === undefined) return undefined;
  const { request } = approval;
  let uri: URI | undefined;
  if (request.kind === 'url' && request.url !== undefined) {
    try {
      uri = URI.parse(request.url);
    }
    catch {
      uri = undefined;
    }
  }
  const domain = uri === undefined ? undefined : extractDomainFromUri(uri);
  const names = (rules: readonly string[] | undefined): boolean => {
    if (request.kind === 'url' && (rules ?? []).some((rule) => domainRuleNames(rule, domain))) return true;
    const read = (rules ?? []).flatMap(asPermissionRule);
    return read.length > 0 && isDeniedByPermissions({ ...approval, rules: { allow: [], deny: read, ask: [] } }, subCommands);
  };
  if (names(managed.deny)) return 'deny';
  if (request.kind === 'url' && managed.limitTo !== undefined) {
    const filtered = uri !== undefined && [Schemas.http, Schemas.https, 'ws', 'wss'].some((scheme) => matchesScheme(uri, scheme));
    const passes = uri !== undefined && (matchesScheme(uri, Schemas.file) || (!uri.authority && !filtered)
      || (domain === undefined ? !filtered : managed.limitTo.some((rule) => domainRuleNames(rule, domain))));
    if (!passes) return 'deny';
  }
  return names(managed.ask) ? 'ask' : undefined;
};

/**
 * Whether a write is of a snapshot this host keeps of an attachment, which the
 * model never edits, so the call is refused before anybody is asked.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L460-L477
 */
export const isForbiddenSnapshotWrite = (approval: ToolApproval): boolean =>
  approval.request.kind === 'write' && approval.request.path !== undefined && approval.attachmentsDirectory !== undefined
  && inside(approval.request.path, approval.attachmentsDirectory, approval.context.ignorePathCase === true);

/**
 * Whether the host answers a question itself, and how: `setting` where a
 * setting or a permission approved it, `not-needed` where the call needs no
 * approval at all, nothing where a person is asked. VS Code's chain, for what
 * this host has: a call that asks to leave its sandbox asks; global, then the
 * session's, Allow All approve, unless the managed lock took them away; an
 * ask rule asks, a protected write asks unless an exact path grant names it,
 * an allow rule approves; a read inside the working folders, of an attachment
 * snapshot or of something attached approves; a write inside the working
 * folders the edit patterns allow approves; and a shell line the rules and
 * the host's command table approve, its writes included, approves.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L238-L395
 */
export const getAutoApproval = (approval: ToolApproval): 'setting' | 'not-needed' | undefined => {
  const { request, rules, context } = approval;
  if (approval.requestSandboxBypass === true) return undefined;
  if (!approval.bypassLocked && (approval.globalAutoApprove || approval.sessionAutoApprove)) return 'setting';
  const writes = request.kind === 'write' && request.path !== undefined ? resolvedPaths(request.path) : undefined;
  if (request.kind === 'write' && request.path !== undefined && writes === undefined) return undefined;
  let allowing: string[] = [];
  if (rules.allow.length > 0 || rules.ask.length > 0) {
    const requests = writes !== undefined
      ? writes.map((path) => ({ ...request, path }))
      : (request.kind === 'read' && request.path !== undefined ? resolvedPaths(request.path)?.map((path) => ({ ...request, path })) : [request]);
    if (requests === undefined || rules.ask.some((rule) => requests.some((one) => matchesPermissionRule(rule, one, context)))) return undefined;
    const canonical = requests.at(-1);
    if (request.kind !== 'shell' && canonical !== undefined) allowing = rules.allow.filter((rule) => matchesPermissionRule(rule, canonical, context));
  }
  if (writes !== undefined && !allowing.some(isExactAbsolutePathRule) && requiresEditConfirmation(writes, approval)) return undefined;
  if (allowing.length > 0) return 'setting';
  if (request.kind === 'read' && request.path !== undefined) {
    if (approval.attachmentsDirectory !== undefined && inside(request.path, approval.attachmentsDirectory, context.ignorePathCase === true)) return 'not-needed';
    const reads = resolvedPaths(request.path);
    if (reads === undefined) return undefined;
    const within = (folders: readonly string[]): boolean => folders.some((folder) => {
      const roots = resolvedPaths(folder);
      return roots !== undefined && reads.every((one) => roots.some((root) => inside(one, root, context.ignorePathCase === true)));
    });
    return within(approval.workingDirectories) || within(approval.attached) ? 'not-needed' : undefined;
  }
  if (writes !== undefined) {
    const patterns = approval.editPatterns;
    const allowed = patterns !== undefined && approval.workingDirectories.some((folder) => writes.every((path) =>
      inside(path, folder, context.ignorePathCase === true) && !platformRestricted(path, folder, approval)
      && matchesEditAutoApprovePatterns(path, patterns, context.ignorePathCase === true)));
    return allowed ? 'not-needed' : undefined;
  }
  if (request.kind === 'shell' && approval.commandLine !== undefined) {
    if (request.shellLanguage === undefined || !approval.terminalAutoApprove || approval.evaluateShell === undefined) return undefined;
    if (approval.evaluateShell(shellClassifiers(approval)).result !== 'approved') return undefined;
    return rules.allow.some((rule) => matchesPermissionRule(rule, request, context)) ? 'setting' : 'not-needed';
  }
  return undefined;
};

/** An option that keeps a grant, in the session or for the host. */
const grantOption = (label: string, rules: readonly string[], scope: PermissionGrantScope = 'session'): Bag =>
  ({ id: permissionGrantOptionId(scope, rules), label, kind: 'approve', group: 1 });

/**
 * The grants a question about a read or a write offers: the file, in the
 * session and always, and the folder it is in, up to its git root, unless the
 * write is one that always asks.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L926-L988
 */
const pathConfirmationOptions = (approval: ToolApproval): Bag[] => {
  const { request } = approval;
  if ((request.kind !== 'read' && request.kind !== 'write') || request.path === undefined || !isAbsolute(request.path)) return [];
  const write = request.kind === 'write';
  const paths = resolvedPaths(request.path);
  const canonical = paths?.at(-1);
  if (paths === undefined || canonical === undefined) return [];
  const tool = write ? 'Edit' : 'Read';
  const options: Bag[] = [];
  const always: Bag[] = [];
  const fileRule = pathRule(tool, canonical, false);
  const base = basename(request.path) || request.path;
  if (fileRule !== undefined) {
    options.push(grantOption(write ? `Allow Edits to ${base} in this Session` : `Allow Reading ${base} in this Session`, [fileRule]));
    always.push(grantOption(write ? `Always Allow Edits to ${base}` : `Always Allow Reading ${base}`, [fileRule], 'host'));
  }
  if (write && requiresEditConfirmation(paths, approval)) return [...options, ...always];
  let folder = dirname(request.path);
  for (let at = folder; ; at = dirname(at)) {
    if (approval.exists(join(at, '.git'))) {
      folder = at;
      break;
    }
    if (dirname(at) === at) break;
  }
  const folders = resolvedPaths(folder);
  const canonicalFolder = folders?.at(-1);
  if (canonicalFolder === undefined) return [...options, ...always];
  const folderRule = pathRule(tool, canonicalFolder, true);
  if (folderRule !== undefined && inside(canonical, canonicalFolder, approval.context.ignorePathCase === true)) {
    const name = basename(folder) || folder;
    options.push(grantOption(write ? `Allow Edits in ${name} in this Session` : `Allow Reading Files in ${name} in this Session`, [folderRule]));
    always.push(grantOption(write ? `Always Allow Edits in ${name}` : `Always Allow Reading Files in ${name}`, [folderRule], 'host'));
  }
  return [...options, ...always];
};

/**
 * The options a question offers that grant what it asks for, by its kind:
 * the commands of a shell line no rule approved, by their prefixes and
 * exactly, the host a fetch goes to, and the path a read or write is of, each
 * in the session and always, between Allow Once and Skip. Nothing for any
 * other kind.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L990-L1042
 */
const scopedConfirmationOptions = (approval: ToolApproval): Bag[] | undefined => {
  const { request } = approval;
  if (request.kind !== 'shell' && request.kind !== 'url' && request.kind !== 'read' && request.kind !== 'write') return undefined;
  const options: Bag[] = [ALLOW_ONCE_OPTION];
  if (request.kind === 'shell' && request.shellLanguage !== undefined && approval.terminalAutoApprove && approval.commandLine !== undefined
    && approval.evaluateShell !== undefined) {
    const evaluation = approval.evaluateShell(shellClassifiers(approval));
    const unapproved = evaluation.unapprovedSubCommands ?? [];
    if (evaluation.hasUnsafeSubCommand !== true && evaluation.hasAskRule !== true && unapproved.length > 0) {
      const { subCommandKeys, offerExactCommandLine } = suggestAutoApproveRuleKeys(approval.commandLine, unapproved);
      const always: Bag[] = [];
      if (subCommandKeys.length > 0) {
        const commands = subCommandKeys.map((key) => `\`${key} …\``).join(', ');
        const label = subCommandKeys.length === 1 ? commands : `Commands ${commands}`;
        const prefixes = subCommandKeys.map(shellPrefixRule);
        options.push(grantOption(`Allow ${label} in this Session`, prefixes));
        always.push(grantOption(`Always Allow ${label}`, prefixes, 'host'));
      }
      const exact = unapproved.map(shellExactRule);
      if (offerExactCommandLine && exact.every((one): one is string => one !== undefined)) {
        options.push(grantOption('Allow Exact Command in this Session', exact));
        always.push(grantOption('Always Allow Exact Command', exact, 'host'));
      }
      options.push(...always);
    }
  }
  else if (request.kind === 'url' && request.url !== undefined) {
    try {
      const url = new URL(request.url);
      if (url.hostname !== '') {
        const pattern = url.protocol === 'https:' ? url.hostname : `${url.protocol}//${url.hostname}`;
        const fetches = [webFetchRule(pattern)];
        options.push(grantOption(`Allow Fetching ${pattern} in this Session`, fetches));
        options.push(grantOption(`Always Allow Fetching ${pattern}`, fetches, 'host'));
      }
    }
    catch { /* a URL that does not read offers the one-time answer alone */ }
  }
  if (request.kind === 'read' || request.kind === 'write') options.push(...pathConfirmationOptions(approval));
  options.push(SKIP_OPTION);
  return options;
};

/**
 * The options a question offers, and the `_meta` it carries, as VS Code's
 * host builds a ready action: Allow Once and Skip for a question a managed
 * rule asks, Allow and Skip for one that asks to leave the sandbox, marked so
 * no grant is kept from it, its own where a sandbox path grant offers them,
 * the grants of what it asks for where it says what that is, else the
 * backend's own options, else VS Code's three.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L560-L610
 */
export const confirmationOptions = (approval: ToolApproval, own: readonly Bag[] | undefined, meta: Bag | undefined): { options: Bag[]; meta?: Bag } => {
  const sandbox = approval.requestSandboxBypass === true;
  const marked = sandbox ? { meta: { ...meta, [SANDBOX_BYPASS_META_KEY]: true } } : meta === undefined ? {} : { meta };
  if (approval.managedApprovalRequired === true) return { options: (sandbox ? SANDBOX_CONFIRMATION_OPTIONS : MANAGED_CONFIRMATION_OPTIONS).slice(), ...marked };
  if (sandbox) return { options: meta?.['vscode.sandboxPathGrant'] !== undefined && own !== undefined ? own.slice() : SANDBOX_CONFIRMATION_OPTIONS.slice(), ...marked };
  return { options: scopedConfirmationOptions(approval) ?? (own !== undefined ? own.slice() : CONFIRMATION_OPTIONS.slice()), ...marked };
};

/**
 * What an approval picked keeps, as VS Code's host keeps it: nothing for a
 * question that asked to leave the sandbox or an answer that is not the
 * approval the call holds; the rules of a grant, in the session's
 * `permissions` or the host's; and the tool's name, in the session's, for
 * Allow in this Session.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L612-L650
 */
export const grantOf = (call: Bag, optionId: string | undefined): { scope: PermissionGrantScope; rules: string[] } | undefined => {
  const picked = call.selectedOption as Bag | undefined;
  if ((call._meta as Bag | undefined)?.[SANDBOX_BYPASS_META_KEY] === true || picked?.id !== optionId || picked?.kind !== 'approve' || optionId === undefined) return undefined;
  const grant = parsePermissionGrantOptionId(optionId);
  if (grant !== undefined) return grant;
  return optionId === ALLOW_SESSION_OPTION_ID && typeof call.toolName === 'string' ? { scope: 'session', rules: [call.toolName] } : undefined;
};

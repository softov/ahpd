import type { Bag } from '../types/common.js';

/*
 * The questions a backend puts to a person about a tool call, as this host puts
 * them: the options each offers, the operator's rule that makes a tool ask
 * every time, and the "Allow in this Session" answers a session keeps, as VS
 * Code's `SessionPermissionManager` owns them for every agent of its host.
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
 * `eligibleForAutoApproval` is VS Code's map of tool name to boolean, kept in
 * root config, and `false` is the one value that asks. An exact name is read
 * first and answers on its own: a `true` there keeps the tool eligible even
 * when its server is named with `false`. A name that is not there falls back
 * to `<server>/*`, one key for every tool of that server - the part of the
 * name before its first slash.
 *
 * A value that is not a boolean is not the `false` that asks, and a rule that
 * is not an object names nothing: both leave the call as it was. The rule is
 * read where it is kept, on each call, so a push reaches a session already
 * running.
 */
export const asksForTool = (rootConfig: Record<string, unknown>, tool: string): boolean => {
  const held = rootConfig.eligibleForAutoApproval;
  if (held === null || typeof held !== 'object' || Array.isArray(held)) return false;
  const rules = held as Record<string, unknown>;
  if (Object.hasOwn(rules, tool)) return rules[tool] === false;
  const slash = tool.indexOf('/');
  if (slash <= 0) return false;
  return rules[`${tool.slice(0, slash)}/*`] === false;
};

/**
 * Whether the operator's rule makes a question about a call's tool ask every
 * time, read from the name the call carries by each name a backend gives that
 * tool when it asks `getAutoApproval`.
 *
 * A backend's own tool is its own name, and a tool this host offered, one of
 * `offered`, is `ahp/<name>`. An MCP server's tool is `mcp__<server>__<tool>`
 * on a call and `<server>/<tool>` to the rule. The CLI hands that name as one
 * string, so it is cut at the first `__` after the server's first character,
 * as the CLI and the backends cut it. A rule's server is the prefix's as it is
 * written, or as the Claude CLI spells a server's name in a tool's: every
 * character outside letters, digits, `_` and `-` an underscore, and a
 * `claude.ai` server's underscores run together and trimmed, as the CLI that
 * `@anthropic-ai/claude-agent-sdk` 0.3.301 bundles spells it. A rule naming
 * the tool answers on its own, as `asksForTool` reads an exact name before
 * the server's `<server>/*`.
 */
export const alwaysAsks = (rootConfig: Record<string, unknown>, toolName: string, offered: readonly string[]): boolean => {
  if (asksForTool(rootConfig, toolName)) return true;
  if (offered.includes(toolName) && asksForTool(rootConfig, `ahp/${toolName}`)) return true;
  const held = rootConfig.eligibleForAutoApproval;
  const prefix = 'mcp__';
  const cut = toolName.startsWith(prefix) ? toolName.indexOf('__', prefix.length + 1) : -1;
  if (held === null || typeof held !== 'object' || Array.isArray(held) || cut === -1 || cut + 2 >= toolName.length) return false;
  const server = toolName.slice(prefix.length, cut);
  const tool = toolName.slice(cut + 2);
  const spelled = (name: string): string => {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return name.startsWith('claude.ai ') ? safe.replace(/_+/g, '_').replace(/^_|_$/g, '') : safe;
  };
  const rules = Object.entries(held as Record<string, unknown>).flatMap(([key, value]) => {
    const slash = key.indexOf('/');
    const named = slash > 0 && (key.slice(0, slash) === server || spelled(key.slice(0, slash)) === server);
    return named ? [{ tool: key.slice(slash + 1), value }] : [];
  });
  const exact = rules.filter((one) => one.tool === tool);
  if (exact.length > 0) return exact.some((one) => one.value === false);
  return rules.some((one) => one.tool === '*' && one.value === false);
};

/** A session's permission rules: the lists of tools it allows, refuses and asks about. */
interface PermissionRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

/**
 * A `permissions` value as VS Code's host reads one: an object whose `allow`,
 * `deny` and `ask`, each where present, are lists of rules. Any other value is
 * no rules at all.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L277-L310
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L1059-L1070
 */
const permissionRulesOf = (value: unknown): PermissionRules | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = value as Bag;
  const lists = [held.allow, held.deny, held.ask];
  if (!lists.every((one) => one === undefined || (Array.isArray(one) && one.every((rule) => typeof rule === 'string')))) return undefined;
  return { allow: (held.allow ?? []) as string[], deny: (held.deny ?? []) as string[], ask: (held.ask ?? []) as string[] };
};

/**
 * How a session's `permissions` answer a question about a tool: `deny` where
 * a rule in `deny` names it, `allow` where one in `allow` does and none in
 * `ask` does, and nothing otherwise, as VS Code's host turns a call a deny
 * rule names away before anything else and reads an ask rule before an allow
 * rule.
 *
 * A rule names a tool by its name, or as `<name>(*)`. A rule with any other
 * specifier, `Shell(npm run *)` or `Read(./src/**)`, scopes a request by what
 * it runs or touches, which a backend's question does not say here, so it
 * names no call.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L287-L315
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L402-L425
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L106-L124
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L208-L228
 */
export const answeredInSession = (value: unknown, toolName: string): 'allow' | 'deny' | undefined => {
  const rules = permissionRulesOf(value);
  if (rules === undefined) return undefined;
  const names = (rule: string): boolean => rule.trim() === toolName || rule.trim() === `${toolName}(*)`;
  if (rules.deny.some(names)) return 'deny';
  return rules.allow.some(names) && !rules.ask.some(names) ? 'allow' : undefined;
};

/**
 * A session's `permissions` with a tool added to `allow`, its `deny` and `ask`
 * kept as they are, or nothing where the tool is already there: VS Code's
 * host keeps an "Allow in this Session" answer as a rule naming the tool.
 * A value that is not one is read as no rules, as VS Code's host reads it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L1059-L1070
 */
export const withSessionGrant = (value: unknown, toolName: string): Bag | undefined => {
  const rules = permissionRulesOf(value);
  const permissions: Bag = rules === undefined ? { allow: [], deny: [] } : value as Bag;
  const allowed = rules?.allow ?? [];
  const allow = [...new Set([...allowed, toolName])];
  if (allow.length === allowed.length) return undefined;
  return { ...permissions, allow };
};

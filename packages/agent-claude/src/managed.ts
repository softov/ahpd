import { posix } from 'node:path';
import { managedRuleOf, normalizeDomainPattern } from '@ahpd/sdk';
import type { Start } from '@ahpd/sdk';
import type { Settings } from '@anthropic-ai/claude-agent-sdk';
import { CLAUDE_CLIENT_MCP_SERVER_NAME, CLAUDE_SERVER_TOOL_MCP_SERVER_NAME, isHostInjectedMcpServerName } from './session/clienttools.js';

/*
 * The operator's managed settings as the CLI's own policy tier.
 *
 * The host hands every backend the operator's managed rules and per-tool
 * eligibility on `Start.managedSettings`, as VS Code hands its runtime
 * `managedSettings: { permissions }`. The SDK's `managedSettings` option is
 * Claude Code's policy tier for the application that starts the CLI: rules the
 * CLI holds above every settings file and flag, on every call, the calls it
 * answers without `canUseTool` among them. Claude Code keeps the values that
 * restrict, its deny and ask rules and its bypass lock among them.
 * https://code.claude.com/docs/en/settings#settings-precedence
 * https://code.claude.com/docs/en/permissions#settings-precedence
 * https://code.claude.com/docs/en/managed-settings#let-an-embedding-host-add-policy
 *
 * A rule is written in Claude Code's grammar where a Claude Code rule names the
 * calls the managed rule names, and is left out where each would name more or
 * fewer, as VS Code's bridge writes a setting in its runtime's grammar.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L27-L30
 *
 * `limitTo` stays with the host's check: a boundary denies every domain but its
 * own, and a deny rule in Claude Code holds over every allow rule beside it.
 * https://code.claude.com/docs/en/permissions#manage-permissions
 */

/**
 * The fields of a shell tool's input, `Bash`'s and `PowerShell`'s alike, which
 * Claude Code reads `<field>:<value>` in a rule as a match on.
 * https://code.claude.com/docs/en/permissions#match-by-input-parameter
 * https://code.claude.com/docs/en/tools-reference#powershell-tool
 */
const SHELL_FIELDS: readonly string[] = ['command', 'timeout', 'description', 'run_in_background', 'dangerouslyDisableSandbox'];

/**
 * A `Shell` argument the host reads as a regular expression, in the form VS
 * Code's permission rules give one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L24
 */
const SHELL_REGEX = /^\/.*\/[dgimsuvy]*$/;

/**
 * The Claude Code rules naming the calls one managed rule names, or none where
 * Claude Code's grammar names other calls. The host reads a managed rule's
 * family as VS Code's permission rules read it, and a `Domain` rule by the host
 * VS Code's network filter reads from a URL.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L79-L88
 */
const claudeRulesOf = (rule: string, behavior: 'deny' | 'ask', cwd: string): string[] => {
  const read = managedRuleOf(rule);
  if (read === undefined) return [];
  const { family, argument } = read;
  switch (family) {
    case 'Shell': {
      /*
       * Every command, in both shells: the family names `Bash` and
       * `PowerShell` alike, and Claude Code's bare `Bash` and `PowerShell`
       * each match every command of their own.
       * https://code.claude.com/docs/en/permissions#match-all-uses-of-a-tool
       * https://code.claude.com/docs/en/permissions#powershell
       */
      if (argument === undefined || argument === '*') return ['Bash', 'PowerShell'];
      /*
       * A command pattern, which the host reads as Claude Code reads one: `*`
       * any text, a trailing ` *` or `:*` the bare command as well, and a
       * command written with no `*` the command bare and with arguments. Left
       * out: a pattern the host reads as a regular expression or against the
       * whole line, one Claude Code reads as a match on an input field, one
       * with an unmatched `(`, which the host reads as naming nothing, and one
       * with space at its edges.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L141-L161
       * https://code.claude.com/docs/en/permissions#wildcard-patterns
       */
      const colon = argument.indexOf(':');
      if (SHELL_REGEX.test(argument) || argument.startsWith('commandLine:') || argument.includes('(')
        || argument !== argument.trim() || (colon > 0 && SHELL_FIELDS.includes(argument.slice(0, colon).trim()))) return [];
      const pattern = argument.includes('*') ? argument : `${argument} *`;
      return [`Bash(${pattern})`, `PowerShell(${pattern})`];
    }
    case 'Read':
    case 'Write': {
      /*
       * A read deny in Claude Code refuses the edits and the writes of its
       * path as well, so a managed read deny stays with the host's check.
       * https://code.claude.com/docs/en/tools-reference#configure-tools-with-permission-rules-and-hooks
       */
      if (family === 'Read' && behavior === 'deny') return [];
      const tool = family === 'Read' ? 'Read' : 'Edit';
      /*
       * Every read, or every edit and write: Claude Code's bare `Read` matches
       * all file reads, and its `Edit` rules every tool that edits a file.
       * https://code.claude.com/docs/en/permissions#match-all-uses-of-a-tool
       * https://code.claude.com/docs/en/permissions#what-read-and-edit-rules-cover
       */
      if (argument === undefined) return [tool];
      /*
       * A path pattern, anchored where the host anchors it: `//` at the root,
       * `~/` at the home, and any other in the session's folder, written as
       * Claude Code's `//` absolute form. Left out: brackets and braces, which
       * VS Code's glob and Claude Code's gitignore patterns read apart, a
       * trailing `/`, which gitignore reads as a folder, an unmatched `(`, a
       * drive letter, and a pattern in the session's folder where that folder
       * has a path of another platform.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L254-L286
       * https://code.claude.com/docs/en/permissions#how-path-patterns-match
       */
      if (['(', '[', ']', '{', '}'].some((one) => argument.includes(one)) || argument.endsWith('/')
        || /^(?:\/\/)?[a-z]:\//i.test(argument)) return [];
      if (argument.startsWith('~/')) return posix.normalize(argument) === argument ? [`${tool}(${argument})`] : [];
      const absolute = argument.startsWith('//') ? posix.normalize(argument.slice(1))
        : cwd.startsWith('/') ? posix.join(cwd, argument.startsWith('/') ? argument.slice(1) : argument) : undefined;
      return absolute === undefined ? [] : [`${tool}(/${absolute})`];
    }
    case 'Domain': {
      /*
       * Every domain, or one by its host: the host names a domain by the host
       * VS Code's network filter reads from a URL, a `*.` pattern the domain
       * and its subdomains, and Claude Code's `domain:` rules match a fetch's
       * host name, a `*.` one its subdomains at any depth. Left out: a host
       * with any other wildcard or character.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/networkFilter/common/domainMatcher.ts#L208-L241
       * https://code.claude.com/docs/en/permissions#webfetch
       */
      if (argument === undefined) return ['WebFetch(domain:*)'];
      const host = normalizeDomainPattern(argument);
      const domain = host?.startsWith('*.') === true ? host.slice(2) : host;
      if (host === undefined || domain === undefined || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(domain)) return [];
      return domain === host ? [`WebFetch(domain:${host})`] : [`WebFetch(domain:${domain})`, `WebFetch(domain:${host})`];
    }
  }
};

/**
 * The Claude Code rule naming one tool of an MCP server, or every tool of it
 * for `*`, as `mcp__<server>__<tool>`; none where the name reads another way
 * there: a server or a tool with a character the CLI rewrites, a `__` of its
 * own, or a `_` at the seam.
 * https://code.claude.com/docs/en/permissions#mcp
 */
const mcpToolRule = (server: string, tool: string): string[] =>
  (/^[\w-]+$/.test(server) && !server.includes('__') && !server.endsWith('_')
    && (tool === '*' || (/^[\w-]+$/.test(tool) && !tool.includes('__') && !tool.startsWith('_')))
    ? [`mcp__${server}__${tool}`]
    : []);

/**
 * The `ask` rules naming each tool the operator's eligibility sets `false`, by
 * Claude Code's names for it, VS Code's per-tool translation for a grammar that
 * names a tool. A name the host reads as a backend's own tool is the CLI's tool
 * of that name and a client's tool of it, which the CLI calls
 * `mcp__client__<name>`; `ahp/<name>` is the host's tool, `mcp__host__<name>`;
 * `<server>/<tool>` is `mcp__<server>__<tool>`; and `<server>/*` is
 * `mcp__<server>__*` where no key keeps a tool of the server eligible, an ask
 * rule holding over every allow rule.
 *
 * Claude Code asks about a call an ask rule names in every permission mode,
 * `bypassPermissions` included, so the rules alone keep each such call asking.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L31-L42
 * https://code.claude.com/docs/en/permissions#manage-permissions
 * https://code.claude.com/docs/en/permission-modes#actions-no-mode-auto-approves
 */
const toolRulesOf = (eligible: Readonly<Record<string, boolean>>): string[] =>
  Object.entries(eligible).flatMap(([key, value]) => {
    if (value !== false) return [];
    const slash = key.indexOf('/');
    if (slash === -1) {
      if (!/^[\w-]+$/.test(key)) return [];
      if (!key.startsWith('mcp__')) return [key, ...mcpToolRule(CLAUDE_CLIENT_MCP_SERVER_NAME, key)];
      const [server = '', tool = '', ...more] = key.slice('mcp__'.length).split('__');
      return more.length === 0 ? mcpToolRule(server, tool) : [];
    }
    const owner = key.slice(0, slash);
    const tool = key.slice(slash + 1);
    // A key on one of the CLI's two in-process servers names no tool to the host, which names
    // the host's tools `ahp/<name>` and a client's tool by its own name.
    if (isHostInjectedMcpServerName(owner)) return [];
    const server = owner === 'ahp' ? CLAUDE_SERVER_TOOL_MCP_SERVER_NAME : owner;
    if (tool !== '*') return mcpToolRule(server, tool);
    return Object.entries(eligible).some(([other, on]) => on === true && other.startsWith(`${owner}/`)) ? [] : mcpToolRule(server, '*');
  });

/**
 * The CLI's `managedSettings` for the operator's managed settings: the deny and
 * ask rules Claude Code's grammar carries, an ask rule for each tool the
 * eligibility sets `false`, and the bypass lock as Claude Code's own, which
 * takes `bypassPermissions` away. Absent where none of them is set.
 * https://code.claude.com/docs/en/permissions#permission-modes
 */
export const claudeManagedSettingsOf = (given: Start['managedSettings'], cwd: string): Settings | undefined => {
  const managed = given?.permissions;
  const deny = [...new Set((managed?.deny ?? []).flatMap((rule) => claudeRulesOf(rule, 'deny', cwd)))];
  const ask = [...new Set([
    ...(managed?.ask ?? []).flatMap((rule) => claudeRulesOf(rule, 'ask', cwd)),
    ...toolRulesOf(given?.eligibleForAutoApproval ?? {}),
  ])];
  const locked = managed?.disableBypassPermissionsMode === 'disable';
  if (deny.length === 0 && ask.length === 0 && !locked) return undefined;
  return {
    permissions: {
      ...(deny.length > 0 ? { deny } : {}),
      ...(ask.length > 0 ? { ask } : {}),
      ...(locked ? { disableBypassPermissionsMode: 'disable' as const } : {}),
    },
  };
};

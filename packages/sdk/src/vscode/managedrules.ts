/**
 * The managed permission rule grammar VS Code writes rules in for the Copilot
 * runtime, and the canonical `Domain` rule a boundary holds.
 *
 * Vendored from VS Code's `agentHostManagedRules.ts`: the families, the rule
 * builder with its argument checks and the boundary rule's check, as VS Code
 * has them. The adaptations are this package's: the families are a frozen
 * object where VS Code has a `const enum`, since Node runs this package's
 * sources with their types stripped and an enum is not a type it can strip,
 * and the dashes of its comments are written as other punctuation.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L24-L35
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L73-L203
 */

import { normalizeDomainPattern } from './domainmatcher.js';

/** Validates the bridge's canonical hostname subset, not arbitrary runtime-managed rule syntax. */
export function isManagedDomainBoundaryRule(rule: string): boolean {
  if (rule === 'Domain') {
    return true;
  }
  if (!rule.startsWith('Domain(') || !rule.endsWith(')')) {
    return false;
  }
  const argument = rule.slice(7, -1);
  return argument !== '*' && normalizeDomainPattern(argument) === argument
    && buildManagedRule(ManagedRuleFamily.Domain, argument) === rule;
}

/**
 * Rule families the SDK understands. Any other family is a parse error for the
 * whole document, so there is deliberately no escape hatch for arbitrary tool
 * names: see `parse_managed_rule`'s "Unsupported managed permission rule
 * family" branch.
 */
export const ManagedRuleFamily = Object.freeze({
  /** Shell/terminal commands. Matches `Bash` and `PowerShell` on the SDK side too. */
  Shell: 'Shell',
  /** File reads. */
  Read: 'Read',
  /** File writes. The SDK treats `Edit` as an alias. */
  Write: 'Write',
  /** Network access, matched as a URL pattern. */
  Domain: 'Domain',
});

export type ManagedRuleFamily = typeof ManagedRuleFamily[keyof typeof ManagedRuleFamily];

/**
 * Builds a single managed permission rule, or returns `undefined` when the
 * argument cannot be expressed in the SDK grammar.
 *
 * Callers must treat `undefined` as "this restriction is not translatable" and
 * skip it; never fall back to a broader rule, which would silently over-restrict.
 */
export function buildManagedRule(family: ManagedRuleFamily, argument: string): string | undefined {
  // Deliberately not trimmed: the SDK parser treats the raw argument as
  // significant, so `Shell( *)` is rejected for having no command prefix.
  // Trimming here would turn that into a valid match-everything rule.
  if (!argument.trim() || !isValidRuleArgument(argument)) {
    return undefined;
  }
  switch (family) {
    case ManagedRuleFamily.Shell:
      return isValidShellArgument(argument) ? `${family}(${argument})` : undefined;
    case ManagedRuleFamily.Read:
    case ManagedRuleFamily.Write:
      return isValidPathArgument(argument) ? `${family}(${normalizePathSeparators(argument)})` : undefined;
    case ManagedRuleFamily.Domain:
      return isValidDomainArgument(argument) ? `${family}(${argument})` : undefined;
  }
}

/**
 * Structural constraints `parse_rule` applies to every argument regardless of
 * family: a rule is delimited by the first `(` and a trailing `)`, so an
 * argument containing `)` would truncate the parse.
 */
function isValidRuleArgument(argument: string): boolean {
  return !argument.includes(')') && !argument.includes('\n');
}

/**
 * The SDK rewrites a trailing `" *"` into a command-boundary match, so
 * `Shell(git *)` matches `git` and `git status` but not `gitea`. A bare `" *"`
 * with no command prefix is rejected there, so it is rejected here.
 */
function isValidShellArgument(argument: string): boolean {
  if (argument === '*') {
    return true;
  }
  const prefix = argument.endsWith(' *') ? argument.slice(0, -2).trimEnd() : argument;
  return prefix.length > 0;
}

/**
 * Path arguments are compiled as globs with `literal_separator` enabled and
 * backslash escaping disabled. The runtime's glob engine has no negation
 * syntax, so a VS Code pattern such as `!foo/**` (legal in
 * `base/common/glob.ts`) must be rejected rather than passed through, where it
 * would fail `validate_glob` and reject the whole document.
 */
function isValidPathArgument(argument: string): boolean {
  if (argument.startsWith('!')) {
    return false;
  }
  // Unbalanced brace alternation fails to compile in the runtime's glob engine.
  let depth = 0;
  for (const char of argument) {
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      if (--depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

/** The runtime normalizes Windows separators before compiling the glob. */
function normalizePathSeparators(argument: string): string {
  return argument.replace(/\\/g, '/');
}

/**
 * Domain arguments are normalized by parsing them as a URL (with an implicit
 * `https://` when no scheme is present), so anything without a host, or
 * carrying shell-substitution syntax the runtime refuses, cannot be expressed.
 */
function isValidDomainArgument(argument: string): boolean {
  if (argument.includes('$(') || argument.includes('${') || argument.includes('`')) {
    return false;
  }
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(argument);
  if (!hasScheme && argument.includes('//')) {
    return false;
  }
  // A bare `*` parses as a host but matches nothing; the family rule is the
  // correct way to express "all domains".
  if (argument === '*') {
    return false;
  }
  try {
    const url = new URL(hasScheme ? argument : `https://${argument}`);
    return url.hostname.length > 0;
  } catch {
    return false;
  }
}

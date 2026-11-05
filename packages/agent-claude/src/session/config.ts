import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { ConfigTaken, Session } from '@ahpd/sdk';
import { bag, str } from './common.js';
import type { SessionContext } from './context.js';

/**
 * The effort levels this backend has, weakest first: what a model's own
 * `thinkingLevel` form offers and a turn's message names, the five VS Code's
 * Claude resolves a model selection to.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/claudeModelConfig.ts#L66-L81
 */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** What a person reads instead of an effort level. The reference client's words. */
export const EFFORT_LABELS: Record<typeof EFFORTS[number], string> = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max',
};

/**
 * The SDK's alias row for the model the CLI is set to use, which names a
 * model the list already holds, so it is no model of its own to offer, as
 * VS Code's Claude agent leaves it out.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L147-L164
 */
export const SDK_DEFAULT_MODEL_VALUE = 'default';

/**
 * What each effort does, in VS Code's words for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/reasoningEffort.ts#L72-L84
 */
export const EFFORT_DESCRIPTIONS: Record<typeof EFFORTS[number], string> = {
  low: 'Faster responses with less reasoning',
  medium: 'Balanced reasoning and speed',
  high: 'Greater reasoning depth but slower',
  xhigh: 'Highest reasoning depth but slowest',
  max: 'Absolute maximum capability with no constraints',
};

/** One client-generated script, sourced before every shell command. */
interface ShellInitScript { shell: 'bash' | 'powershell'; script: string }

/** A generated script is a few hundred bytes; anything near this is not one. */
const MAX_SHELL_INIT_SCRIPT = 64 * 1024;

/**
 * The `shellInitScripts` value, checked to VS Code's `isShellInitScriptList`.
 *
 * A list of at most one `{ shell, script }`, its script non-empty and no
 * longer than a generated one could be. `undefined` for anything else, which
 * is what keeps it off the disk.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/shellInitScript.ts#L110-L126
 */
const shellInitScripts = (value: unknown): ShellInitScript[] | undefined => {
  if (!Array.isArray(value) || value.length > 1) return undefined;
  const list: ShellInitScript[] = [];
  for (const entry of value) {
    const one = bag(entry);
    if ((one.shell !== 'bash' && one.shell !== 'powershell') || typeof one.script !== 'string') return undefined;
    if (one.script.length === 0 || one.script.length > MAX_SHELL_INIT_SCRIPT) return undefined;
    list.push({ shell: one.shell, script: one.script });
  }
  return list;
};

/**
 * What goes in front of a shell command while a script is in force.
 *
 * Sourced, so what it sets is there for the command; its stderr dropped, as
 * the reference runtime drops it; and a nonzero status reported rather than
 * hidden, since a profile that fails is something the model should hear.
 */
const sourcing = (path: string): string => `{ . '${path.replaceAll("'", "'\\''")}'; } 2>/dev/null || printf 'shell init script exited %s\\n' "$?"`;

/**
 * A `permissions` value, if it is one.
 *
 * `undefined` for anything else, which is what makes `setConfig` able to
 * refuse: a client sending a string where the schema says an object should
 * hear that the value was not taken rather than have it quietly ignored.
 */
export const listsOf = (value: unknown): { allow: string[]; deny: string[] } | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const held = value as { allow?: unknown; deny?: unknown };
  const names = (one: unknown): string[] =>
    (Array.isArray(one) ? one : []).filter((entry): entry is string => typeof entry === 'string');
  if (held.allow === undefined && held.deny === undefined) return undefined;
  return { allow: names(held.allow), deny: names(held.deny) };
};

/** What this area offers the rest of the session, and its `Session` methods. */
export interface Config {
  /** The path the shell init script is written to, and removed from. */
  initScript: string;
  /** Take a `shellInitScripts` value, or say why it is not one. */
  setShellInit: (value: unknown) => true | string;
  /** The `PreToolUse` hook that puts that script in front of a command. */
  sourceFirst: HookCallback;
  /**
   * The command a call was written as, before `sourceFirst` put the script's
   * line in front of it, by the call's id.
   *
   * The owner's rules match the line the model wrote, and `canUseTool` is
   * handed the rewritten input: this is where the original is kept for it.
   */
  unprefixed: Map<string, string>;
  methods: {
    setConfig: (key: string, value: unknown) => ConfigTaken | Promise<ConfigTaken>;
    settings: () => Record<string, unknown>;
  };
}

export function createConfig(ctx: SessionContext): Config {
  /*
   * The shell init script, on disk where a shell can source it.
   *
   * The reference client pushes `shellInitScripts` for the profile and the
   * Python environment it has selected, and the SDK's shell tool has no
   * setting for one - so a `PreToolUse` hook on `Bash` puts a `source` of
   * this file in front of every command. One path for the session's life,
   * rewritten on each change, because the hook is built once with the query
   * and reads the file by name. The bash entry only: the CLI's shell tool is
   * bash on every platform it runs on. The operator's environment reaches the
   * same shells through the CLI's own environment (`query.ts`), so the script
   * sourced here can still change what the operator set.
   */
  const initScript = join(tmpdir(), `ahpd-shell-init-${crypto.randomUUID()}.sh`);
  let sourced = false;
  /*
   * What each rewritten command was before the script's line was put in
   * front of it, by the call's id.
   *
   * The hook is told the id of the call it is rewriting, and `canUseTool` is
   * told the same id when the CLI asks about it. Kept between the two so the
   * owner's rules match the line the model wrote rather than the one the
   * session runs.
   */
  const unprefixed = new Map<string, string>();
  const setShellInit = (value: unknown): true | string => {
    const list = shellInitScripts(value);
    /*
     * A malformed value is held as it was set and the last valid script stays
     * in force, as VS Code's Copilot ignores one and keeps the script it had.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8469-L8473
     */
    if (list === undefined) {
      console.warn('@ahpd/agent-claude: ignoring a malformed shellInitScripts; the last valid script stays in force');
      ctx.settings.shellInitScripts = value;
      return true;
    }
    const bash = list.find((one) => one.shell === 'bash');
    try {
      if (bash === undefined) rmSync(initScript, { force: true });
      else writeFileSync(initScript, bash.script, { mode: 0o600 });
    }
    catch (error) {
      return `Could not write the shell init script: ${error instanceof Error ? error.message : String(error)}`;
    }
    sourced = bash !== undefined;
    ctx.settings.shellInitScripts = list;
    return true;
  };
  const sourceFirst: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const given = bag(input.tool_input);
    const command = str(given.command);
    // No script in force: the command goes as the model wrote it.
    if (command === undefined || !sourced) return {};
    // Kept for the question the CLI asks about this call after the hook runs.
    unprefixed.set(input.tool_use_id, command);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...given, command: `${sourcing(initScript)}\n${command}` } } };
  };

  const methods: Config['methods'] = {
    /**
     * Every key a client sets, taken as VS Code's host takes any key but its
     * own: `permissions`, `shellInitScripts` and `permissionMode` act on the
     * CLI, and any other is held as it was set. A value the CLI cannot take
     * is refused, so a client never shows a session in a state it is not in.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13606-L13610
     */
    setConfig: async (key, value) => {
      /*
       * The lists, which really do move on a running session.
       *
       * The SDK takes `allowedTools` / `disallowedTools` when the query is
       * built and has nowhere to put a later change, so a list set halfway
       * through would be a control that reported success and did nothing.
       * `canUseTool` is the other half and reads `allowed` on every call -
       * which is where a change made now takes effect.
       */
      if (key === 'permissions') {
        const held = listsOf(value);
        if (!held) return `${key} takes an object with allow and deny, not ${typeof value}`;
        ctx.allowed = held;
        ctx.settings.permissions = held;
        return true;
      }
      if (key === 'shellInitScripts') return setShellInit(value);
      if (key !== 'permissionMode') {
        ctx.settings[key] = value;
        return true;
      }
      // The schema's own property, whose five values are the CLI's.
      const said = typeof value === 'string' ? value : '';
      const modes = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const;
      const found = modes.find((one) => one === said);
      if (!found) return `The harness has no permission mode called ${said}`;
      ctx.settings.permissionMode = found;
      void ctx.handle.setPermissionMode(found).catch(() => {});
      return true;
    },

    settings: () => ({ ...ctx.settings, ...(ctx.chosen ? { model: ctx.chosen } : {}) }),
  };

  return { initScript, setShellInit, sourceFirst, unprefixed, methods };
}

import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookCallback, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { isShellName } from '@ahpd/sdk';
import type { ConfigTaken, Session, ShellEnv } from '@ahpd/sdk';
import { bag, str } from './common.js';
import type { SessionContext } from './context.js';

/**
 * The effort levels this backend has, weakest first.
 *
 * One list, because two of them drifted: a model's own `thinkingLevel` form
 * and the session-wide `effortLevel` key are the same five words reaching the
 * same setting, and a client that read one set of labels from one control and
 * another set from the other is being told they are different things.
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
 * The `shellInitScripts` value, checked to the reference host's rule.
 *
 * A list of `{ shell, script }`, each script non-empty and no longer than a
 * generated one could be. `undefined` for anything else, which is what lets
 * `setConfig` refuse it rather than write it to disk.
 */
const shellInitScripts = (value: unknown): ShellInitScript[] | undefined => {
  if (!Array.isArray(value)) return undefined;
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
 * One word, quoted for a POSIX shell, by the rule `terminals.ts` uses.
 *
 * Single quotes make everything literal except the quote itself, which is
 * written by closing, escaping and reopening: `it's` becomes `'it'\''s'`.
 */
const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

/**
 * The operator's environment, as the lines that give a shell it.
 *
 * One `export` for each name the operator set the value of and one `unset` for
 * each name they removed. A name that is not a shell variable name is left
 * out: `export 2FA=on` is a syntax error, and a session whose every command
 * failed to parse would be worse than one variable a deployment cannot set
 * this way. The daemon refuses such a name in its config as well; this is what
 * keeps a session built by hand from writing the line.
 */
const shellEnvLines = (shellEnv?: ShellEnv): string => {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(shellEnv ?? {})) {
    if (!isShellName(name)) continue;
    lines.push(value === null ? `unset ${name}` : `export ${name}=${quoted(value)}`);
  }
  return lines.join('\n');
};

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
  /** The `PreToolUse` hook that puts the operator's environment and that script in front of a command. */
  sourceFirst: HookCallback;
  /**
   * The command a call was written as, before `sourceFirst` put the operator's
   * lines in front of it, by the call's id.
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
   * bash on every platform it runs on.
   *
   * The operator's `shellEnv` goes through the same hook and ahead of the
   * script, because a Bash command is the one place this session reaches a
   * shell at all - the CLI starts no other.
   */
  const initScript = join(tmpdir(), `ahpd-shell-init-${crypto.randomUUID()}.sh`);
  let sourced = false;
  /*
   * What each rewritten command was before the operator's lines were put in
   * front of it, by the call's id.
   *
   * The hook is told the id of the call it is rewriting, and `canUseTool` is
   * told the same id when the CLI asks about it. Kept between the two so the
   * owner's rules match the line the model wrote rather than the one the
   * session runs.
   */
  const unprefixed = new Map<string, string>();
  /*
   * The operator's environment, as the lines that go in front of every
   * command.
   *
   * Built once, when the session starts: the map is the operator's and cannot
   * move under a running session, the way the session's own `shellInitScripts`
   * can. The operator's lines come before a client's script, so a script can
   * still change what the operator set - which is what `shellInitScripts` is
   * for.
   */
  const environment = shellEnvLines(ctx.options.shellEnv);
  const setShellInit = (value: unknown): true | string => {
    const list = shellInitScripts(value);
    if (list === undefined) return 'shellInitScripts takes a list of { shell, script }';
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
    if (command === undefined) return {};
    // The operator's lines, then the client's script, then the command.
    const before = [environment, sourced ? sourcing(initScript) : ''].filter((one) => one !== '').join('\n');
    // Nothing to put in front of it: the command goes as the client wrote it.
    if (before === '') return {};
    // Kept for the question the CLI asks about this call after the hook runs.
    unprefixed.set(input.tool_use_id, command);
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...given, command: `${before}\n${command}` } } };
  };

  const methods: Config['methods'] = {
    /**
     * A key this backend's schema declares, and the model a turn may name.
     *
     * A refusal for anything else, since only a key the schema declares may
     * be changed, and a refusal is a real answer: a setter that reported
     * success and changed nothing would leave a client showing a session in a
     * state it is not in.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L604-L608
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
      const said = typeof value === 'string' ? value : '';
      if (key === 'model') {
        try {
          await ctx.handle.setModel(said === 'default' ? undefined : said);
          ctx.chosen = said;
          ctx.settings.model = said;
          return true;
        }
        catch { return `The harness would not take model ${said}`; }
      }
      if (key === 'effortLevel') {
        const found = EFFORTS.find((one) => one === said);
        if (!found) return `The harness has no effort level called ${said}`;
        ctx.settings.effortLevel = found;
        // The level in force from here, over any a turn's model set.
        ctx.turnEffort = undefined;
        void ctx.handle.applyFlagSettings({ effortLevel: found }).catch(() => {});
        return true;
      }
      if (key !== 'permissionMode') return `${key} is not a config key this backend takes`;
      // The schema's own property, whose six values are the CLI's.
      const modes = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk', 'auto'] as const;
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

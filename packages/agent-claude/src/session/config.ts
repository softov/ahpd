import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookCallback, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { Session } from '@ahpd/sdk';
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
 * A permission mode a client asked for in somebody else's vocabulary.
 *
 * This backend advertises `permissionMode` and its own six values, which is
 * what the protocol asks a backend to do - the config schema is deliberately
 * generic, and VS Code's own hosts advertise different properties for Copilot
 * and for Claude. So the schema stays this harness's.
 *
 * What arrives is another matter. A client draws controls from the schema and
 * *also* dispatches two conventional keys of its own: `autoApprove` (how much
 * may run unasked) and `mode` (how the agent works). VS Code sends both at
 * session creation whatever a host advertises, and this host used to answer
 * `autoApprove is not a config key this backend takes` and leave the session
 * where it was.
 *
 * So they are accepted and mapped here, on the way in, and nothing about what
 * is advertised changes. Planning wins over any approval level - a plan that
 * ran a command would not be a plan - and `autopilot` is the mode axis saying
 * what `autoApprove` says at its top, which is why VS Code's own migration
 * moved `autoApprove: 'autopilot'` onto that axis.
 *
 * `assisted` is the inexact one: VS Code means "assess the risk first" and
 * this harness has no risk model, so it gets `acceptEdits`, which is the rung
 * it does have in that place.
 *
 * Undefined for a key or a value neither axis knows, so a caller refuses it
 * rather than collapsing it into `default`.
 */
export function permissionFor(key: string, value: string): PermissionMode | undefined {
  if (key === 'mode') {
    if (value === 'plan') return 'plan';
    if (value === 'autopilot') return 'bypassPermissions';
    if (value === 'interactive') return 'default';
    return undefined;
  }
  if (key !== 'autoApprove') return undefined;
  if (value === 'autoApprove' || value === 'autopilot') return 'bypassPermissions';
  if (value === 'assisted') return 'acceptEdits';
  if (value === 'default') return 'default';
  return undefined;
}

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
  /** The `PreToolUse` hook that sources that script in front of a command. */
  sourceFirst: HookCallback;
  methods: {
    setConfig: (key: string, value: unknown) => true | string | Promise<true | string>;
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
   */
  const initScript = join(tmpdir(), `ahpd-shell-init-${crypto.randomUUID()}.sh`);
  let sourced = false;
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
    if (!sourced || input.hook_event_name !== 'PreToolUse') return {};
    const given = bag(input.tool_input);
    const command = str(given.command);
    if (command === undefined) return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...given, command: `${sourcing(initScript)}\n${command}` } } };
  };

  const methods: Config['methods'] = {
    /**
     * A key this backend does not advertise, taken anyway when it means one.
     *
     * `autoApprove` and `mode` are conventional names a client sends whatever
     * a host advertises, and both mean something this harness can do. Mapped
     * onto the mode the CLI takes and recorded there, so the control this
     * backend *does* advertise shows what actually happened.
     *
     * False for anything else, and false is a real answer: a setter that
     * reported success and changed nothing would leave a client showing a
     * session in a state it is not in.
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
        void ctx.handle.applyFlagSettings({ effortLevel: found }).catch(() => {});
        return true;
      }
      /*
       * The mode this backend advertises, and the two conventional names for
       * the same axis.
       *
       * `permissionMode` is the schema's own property and its six values are
       * the CLI's. `autoApprove` and `mode` are what a client sends whatever a
       * host advertises, and `permissionFor` maps them onto the same axis.
       */
      const modes = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk', 'auto'] as const;
      const found = key === 'permissionMode'
        ? modes.find((one) => one === said)
        : permissionFor(key, said);
      if (!found) {
        return key === 'permissionMode' || key === 'autoApprove' || key === 'mode'
          ? `The harness has no permission mode called ${said}`
          : `${key} is not a config key this backend takes`;
      }
      ctx.settings.permissionMode = found;
      void ctx.handle.setPermissionMode(found).catch(() => {});
      return true;
    },

    settings: () => ({ ...ctx.settings, ...(ctx.chosen ? { model: ctx.chosen } : {}) }),
  };

  return { initScript, setShellInit, sourceFirst, methods };
}

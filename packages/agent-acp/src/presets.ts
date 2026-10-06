/**
 * The agents this package ships a row for.
 *
 * A row is what running one known agent takes: the program, the arguments that
 * put it in ACP mode, the switch that stops it updating itself, and the sign-in
 * it needs once a key is there. A preset takes a row by naming it as its own
 * key or as its `base`, and whatever the preset writes itself wins over the row.
 *
 * The rows are kept by hand rather than read from the ACP registry, which lists
 * a command and nothing else: the switch that stops an agent updating itself
 * and the variable that says it has been signed in are not in it. They were
 * checked against each agent's own command on 2026-10-03, and that date is what
 * a rename is noticed at. Versions are not here either: a machine pins them,
 * and one place does that.
 *
 * Only an agent that ships an ACP server is here. Crush has none.
 */

import type { Seed } from '@ahpd/sdk';
import type { AcpMachine } from './types.js';

/** One shipped agent: the fields `AcpOptions` takes, less the id and the sign-in. */
export interface AcpPreset {
  /** What a client reads instead of the id. */
  name: string;
  /** The program to spawn as the ACP server. */
  command: string;
  /** The arguments to give it. */
  args?: string[];
  /**
   * The variables it is spawned with, over the daemon's own.
   *
   * Each is a switch that has to be off for a host that does not want the
   * agent replacing itself under a session that is running.
   */
  env?: Record<string, string>;
  /**
   * The sign-in it needs, and the daemon variables that say it has one.
   *
   * A variable counts as set when the daemon's own environment has it or the
   * preset's `env` does, so a deployment that keeps its key out of the daemon
   * still says the preset is signed in. With none of them set the agent
   * registers with no sign-in at all, and a session the server refuses ends
   * with the sentence naming the methods its handshake offered.
   */
  authenticate?: { methodId: string; fromEnv: string[] };
  /**
   * What a machine needs to run it: the part its CLI comes from, the variables
   * that point its configuration at a state directory, and that directory with
   * the host files it is seeded from.
   *
   * Set only in a machine, never on a spawn on this host. A key is not here: a
   * person fills its variable in their own preset's `machine.env`.
   */
  machine?: AcpMachine;
}

/** A state directory at `/ahpd/<id>`, seeded from the given host paths. */
const stateOf = (id: string, seed: Seed[]): Pick<AcpMachine, 'state' | 'seed'> => ({ state: `/ahpd/${id}`, seed });

/**
 * The machine of an agent that reads its configuration from
 * `$XDG_CONFIG_HOME/<dir>` and its data from `$XDG_DATA_HOME`, both moved under
 * its state directory and seeded from `~/.config/<dir>`.
 *
 * The variables are the whole machine's, so a nested `ahpd` in the same
 * machine keeps its own folder in that state directory too, which is writable.
 */
const xdgOf = (id: string, files: string[]): AcpMachine => ({
  part: id,
  env: { XDG_CONFIG_HOME: `/ahpd/${id}/config`, XDG_DATA_HOME: `/ahpd/${id}/data` },
  ...stateOf(id, files.map((file) => ({ source: `~/.config/${id}/${file}`, target: `config/${id}/${file}` }))),
});

/** Every shipped row, by the key a preset names. */
export const presets: Record<string, AcpPreset> = {
  codex: {
    name: 'Codex',
    command: 'codex-acp',
    // The `codex` CLI has no ACP mode of its own; this is Codex behind an
    // adapter, installed with `npm i -g @agentclientprotocol/codex-acp`.
    authenticate: { methodId: 'api-key', fromEnv: ['CODEX_API_KEY', 'OPENAI_API_KEY'] },
    machine: {
      part: 'codex',
      env: { CODEX_HOME: '/ahpd/codex' },
      ...stateOf('codex', [{ source: '~/.codex/config.toml' }, { source: '~/.codex/AGENTS.md' }, { source: '~/.codex/skills' }]),
    },
  },
  gemini: {
    name: 'Gemini',
    command: 'gemini',
    args: ['--acp'],
    machine: {
      part: 'gemini',
      env: { GEMINI_CLI_HOME: '/ahpd/gemini' },
      // The sign-in Gemini keeps in its settings is dropped; a key reaches the
      // machine as a variable.
      ...stateOf('gemini', [
        { source: '~/.gemini/settings.json', target: '.gemini/settings.json', drop: ['security.auth'] },
        { source: '~/.gemini/GEMINI.md', target: '.gemini/GEMINI.md' },
      ]),
    },
  },
  copilot: {
    name: 'Copilot',
    command: 'copilot',
    args: ['--acp'],
    env: { COPILOT_AUTO_UPDATE: 'false' },
    machine: {
      part: 'copilot',
      env: { COPILOT_HOME: '/ahpd/copilot' },
      // Never `config.json`, which holds the sign-in.
      ...stateOf('copilot', ['settings.json', 'mcp-config.json', 'copilot-instructions.md', 'agents', 'skills']
        .map((one) => ({ source: `~/.copilot/${one}` }))),
    },
  },
  opencode: {
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    env: { OPENCODE_DISABLE_AUTOUPDATE: '1' },
    machine: xdgOf('opencode', ['opencode.json', 'agent', 'command']),
  },
  kilo: {
    name: 'Kilo',
    command: 'kilo',
    args: ['acp'],
    // Kilo is an OpenCode fork and reads its own copy of the switch.
    env: { OPENCODE_DISABLE_AUTOUPDATE: '1' },
    machine: xdgOf('kilo', ['kilo.json', 'agent', 'command']),
  },
  goose: {
    name: 'Goose',
    command: 'goose',
    args: ['acp'],
    // A headless host has no keyring, and a session that cannot read one fails
    // its first turn rather than its start.
    env: { GOOSE_DISABLE_KEYRING: '1' },
    machine: {
      part: 'goose',
      env: { GOOSE_PATH_ROOT: '/ahpd/goose' },
      ...stateOf('goose', [{ source: '~/.config/goose/config.yaml', target: 'config/config.yaml' }]),
    },
  },
  pi: {
    name: 'Pi',
    command: 'pi-acp',
    machine: {
      part: 'pi',
      env: { PI_CODING_AGENT_DIR: '/ahpd/pi' },
      // Never `auth.json`, which holds the sign-in.
      ...stateOf('pi', [{ source: '~/.pi/agent/settings.json' }, { source: '~/.pi/agent/models.json' }]),
    },
  },
  dsh: {
    name: 'dsh',
    command: 'dsh',
    args: ['--profile', 'acp'],
    machine: {
      part: 'dsh',
      env: { DSH_HOME: '/ahpd/dsh' },
      ...stateOf('dsh', [{ source: '~/.dsh/profiles/acp', target: 'profiles/acp' }]),
    },
  },
  devin: {
    name: 'Devin',
    command: 'devin',
    args: ['acp'],
    machine: xdgOf('devin', ['config.json', 'mcp_config.json']),
  },
  cursor: {
    name: 'Cursor',
    command: 'cursor-agent',
    args: ['acp'],
    // `cursor_login` is the one method Cursor advertises; with the key set it
    // signs in without a browser.
    authenticate: { methodId: 'cursor_login', fromEnv: ['CURSOR_API_KEY'] },
    machine: {
      part: 'cursor',
      env: { CURSOR_CONFIG_DIR: '/ahpd/cursor' },
      ...stateOf('cursor', [{ source: '~/.cursor/cli-config.json' }]),
    },
  },
  amp: {
    // The Amp CLI is the ACP server's own harness, so the binary that speaks
    // the protocol is this one rather than `amp` itself.
    name: 'Amp',
    command: 'amp-acp',
    // The part holds both `amp` and `amp-acp`, and the server is told which
    // `amp` to run. Amp has no variable that moves its settings, so it has no
    // state directory here.
    machine: { part: 'amp', env: { AMP_CLI_PATH: 'amp' } },
  },
  qwen: {
    name: 'Qwen Code',
    command: 'qwen',
    args: ['--acp'],
    machine: {
      part: 'qwen',
      env: { QWEN_HOME: '/ahpd/qwen' },
      ...stateOf('qwen', [{ source: '~/.qwen/settings.json' }]),
    },
  },
};

/**
 * The agents this package ships a row for.
 *
 * A row is what running one known agent takes: the program, the arguments that
 * put it in ACP mode, the switch that stops it updating itself, and the sign-in
 * it needs once a key is there. A record takes a row by naming it as its own id
 * or as its `base`, and whatever the record writes itself wins over the row.
 *
 * The name and the command of each row come from `knownAgents` in `@ahpd/sdk`,
 * which the daemon also reads: a setup offers an agent it finds on PATH, and it
 * has to look up the same command this package spawns. What is left here is what
 * only the spawn needs - arguments, environment, sign-in and machine - because
 * the server never starts an agent itself.
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

import { knownAgents, type AgentTemplate, type Seed } from '@ahpd/sdk';
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
   * Whether this agent asks before it loads a project's own configuration.
   *
   * Set for a row whose agent has a trust of its own and puts the question to
   * whoever is there. Absent, a session of this agent in a folder the host did
   * not vouch for is refused rather than started: ACP carries no trust field,
   * so the folder is otherwise the agent's to read.
   */
  honoursTrust?: boolean;
  /**
   * The approval modes the agent's server names, as the server names them.
   *
   * Set only where the agent's own source or documentation lists them, and the
   * row says where. They are the agent's schema's list; the modes a session's
   * server offers are that session's own `availableApprovalModes`.
   */
  modes?: { id: string; name: string }[];
  /**
   * What a machine needs to run it: the part its CLI comes from, the variables
   * that point its configuration at a state directory, and that directory with
   * the host files it is seeded from.
   *
   * Set only in a machine, never on a spawn on this host. A key is not here: a
   * person fills its variable in their own record's `machine.env`.
   */
  machine?: AcpMachine;
}

/**
 * The name and command of one row, from the list the daemon also reads.
 *
 * The row is written by hand in `knownAgents`, so a key here that names none is
 * a mistake in this file rather than something a person typed; failing where it
 * is read says which key instead of spawning `undefined` later.
 */
const rowOf = (id: string): Pick<AcpPreset, 'name' | 'command'> => {
  const agent = knownAgents[id];
  if (agent === undefined) throw new Error(`knownAgents has no ${id}`);
  return { name: agent.name, command: agent.command };
};

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
    ...rowOf('codex'),
    // The `codex` CLI has no ACP mode of its own; this is Codex behind an
    // adapter, installed with `npm i -g @agentclientprotocol/codex-acp`.
    // The modes are the adapter's own `AgentMode` class:
    // https://github.com/agentclientprotocol/codex-acp/blob/main/src/AgentMode.ts
    modes: [
      { id: 'read-only', name: 'Read-only' },
      { id: 'workspace-write', name: 'Workspace access' },
      { id: 'agent', name: 'Auto review' },
      { id: 'agent-full-access', name: 'Full access' },
    ],
    authenticate: { methodId: 'api-key', fromEnv: ['CODEX_API_KEY', 'OPENAI_API_KEY'] },
    machine: {
      part: 'codex',
      env: { CODEX_HOME: '/ahpd/codex' },
      ...stateOf('codex', [{ source: '~/.codex/config.toml' }, { source: '~/.codex/AGENTS.md' }, { source: '~/.codex/skills' }]),
    },
  },
  gemini: {
    ...rowOf('gemini'),
    args: ['--acp'],
    // `buildAvailableModes` names these, and adds `plan` only where the agent's
    // plan mode is enabled, so the list here is the one every session has:
    // https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/acpUtils.ts
    modes: [
      { id: 'default', name: 'Default' },
      { id: 'autoEdit', name: 'Auto Edit' },
      { id: 'yolo', name: 'YOLO' },
    ],
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
    ...rowOf('copilot'),
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
    ...rowOf('opencode'),
    args: ['acp'],
    env: { OPENCODE_DISABLE_AUTOUPDATE: '1' },
    machine: xdgOf('opencode', ['opencode.json', 'agent', 'command']),
  },
  kilo: {
    ...rowOf('kilo'),
    args: ['acp'],
    // Kilo is an OpenCode fork and reads its own copy of the switch.
    env: { OPENCODE_DISABLE_AUTOUPDATE: '1' },
    machine: xdgOf('kilo', ['kilo.json', 'agent', 'command']),
  },
  goose: {
    ...rowOf('goose'),
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
    ...rowOf('pi'),
    machine: {
      part: 'pi',
      env: { PI_CODING_AGENT_DIR: '/ahpd/pi' },
      // Never `auth.json`, which holds the sign-in.
      ...stateOf('pi', [{ source: '~/.pi/agent/settings.json' }, { source: '~/.pi/agent/models.json' }]),
    },
  },
  dsh: {
    ...rowOf('dsh'),
    args: ['--profile', 'acp'],
    machine: {
      part: 'dsh',
      env: { DSH_HOME: '/ahpd/dsh' },
      ...stateOf('dsh', [{ source: '~/.dsh/profiles/acp', target: 'profiles/acp' }]),
    },
  },
  devin: {
    ...rowOf('devin'),
    args: ['acp'],
    // `devin-browser` is the one method Devin advertises; with the key set it
    // is sent, so a session does not wait on a browser.
    authenticate: { methodId: 'devin-browser', fromEnv: ['WINDSURF_API_KEY'] },
    machine: xdgOf('devin', ['config.json', 'mcp_config.json']),
  },
  cursor: {
    ...rowOf('cursor'),
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
    ...rowOf('amp'),
    env: { AMP_SKIP_UPDATE_CHECK: '1' },
    // The part holds both `amp` and `amp-acp`, and the server is told which
    // `amp` to run. Amp has no variable that moves its settings, so it has no
    // state directory here.
    machine: { part: 'amp', env: { AMP_CLI_PATH: 'amp' } },
  },
  qwen: {
    ...rowOf('qwen'),
    args: ['--acp'],
    // `APPROVAL_MODE_INFO` in this package's bundle names these five, and its
    // own `docs/features/approval-mode.md` lists the same modes in this order:
    // https://www.npmjs.com/package/@qwen-code/qwen-code/v/0.26.4
    modes: [
      { id: 'plan', name: 'Plan' },
      { id: 'default', name: 'Default' },
      { id: 'auto-edit', name: 'Auto Edit' },
      { id: 'auto', name: 'Auto' },
      { id: 'yolo', name: 'YOLO' },
    ],
    machine: {
      part: 'qwen',
      env: { QWEN_HOME: '/ahpd/qwen' },
      ...stateOf('qwen', [{ source: '~/.qwen/settings.json' }]),
    },
  },
  cline: {
    ...rowOf('cline'),
    args: ['--acp'],
  },
  omp: {
    ...rowOf('omp'),
    args: ['acp'],
  },
};

/**
 * The environment variables one row's vendor reads as keys.
 *
 * The variables `knownAgents` marks secret, plus the ones the row signs in
 * with: a variable its vendor documents as a credential and one its server
 * takes as the sign-in are the same thing to a record, which may hold either
 * in its own vault scope. Every other variable is the host's to set, which is
 * the channel's rule for an engine's `keyVariables`.
 */
export const keyVariablesOf = (id: string): string[] => {
  const known = knownAgents[id];
  const names = new Set<string>((known?.variables ?? []).filter((one) => one.secret).map((one) => one.name));
  for (const one of presets[id]?.authenticate?.fromEnv ?? []) names.add(one);
  return [...names];
};

/** Every key variable any shipped row reads, sorted, which is a record's `keyVariables`. */
export const KEY_VARIABLES: string[] = [...new Set(Object.keys(presets).flatMap(keyVariablesOf))].sort();

/**
 * The host mark each row shows, by the key a preset names.
 *
 * The mark is the vendor's, taken from Simple Icons, and the host resolves it
 * when the plugin loads. A row with no mark here shows the engine's own icon
 * instead, because no clear source and licence was found for one.
 */
const MARKS: Record<string, string> = {
  codex: 'openai',
  gemini: 'gemini',
  copilot: 'copilot',
  opencode: 'opencode',
  cursor: 'cursor',
  qwen: 'qwen',
  cline: 'cline',
};

/**
 * One template per shipped row: the values a record made from it starts with.
 *
 * A template carries the row's spawn fields whole - the command, the arguments
 * that put it in ACP mode, the environment switches and the machine - so a
 * record made from it runs that row whether or not it also names it. The
 * install line and the page travel with them, because they describe the command
 * the record now carries.
 *
 * The row's key variables are fields set empty, so a person sees which ones
 * their vendor wants. An empty secret is dropped when the record is written,
 * and one filled in is kept in the vault rather than in the record. A sign-in
 * is named where the row has one, so a record whose key is filled in signs in
 * without the person naming the method as well.
 *
 * `base`, `command`, `args`, `cwd`, `machine` and `install` are host-only: a
 * person's or a team's record cannot set them, and a client creating one from a
 * template leaves them out.
 */
export const templates = (): AgentTemplate[] => Object.entries(presets).map(([id, row]) => {
  const known = knownAgents[id];
  const mark = MARKS[id];
  const env: Record<string, string> = { ...row.env };
  for (const variable of keyVariablesOf(id)) env[variable] ??= '';
  return {
    name: row.name,
    description: `${row.name} over the Agent Client Protocol.`,
    ...(mark === undefined ? {} : { icon: { src: `mark:${mark}` } }),
    config: {
      command: row.command,
      ...(row.args === undefined ? {} : { args: [...row.args] }),
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(row.authenticate === undefined ? {} : { authenticate: { methodId: row.authenticate.methodId } }),
      ...(row.honoursTrust === undefined ? {} : { honoursTrust: row.honoursTrust }),
      ...(row.machine === undefined ? {} : { machine: structuredClone(row.machine) }),
      ...(known?.install === undefined ? {} : { install: structuredClone(known.install) }),
      ...(known?.page === undefined ? {} : { page: known.page }),
    },
  };
});

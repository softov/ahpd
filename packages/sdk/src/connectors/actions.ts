/**
 * An adapter's actions, offered to a session as host tools.
 *
 * One tool for each `action` capability of each adapter that can run one, and
 * one tool for every connector of that adapter: the adapter is the kind, and a
 * connector of it is which account a call uses. So the model names an action
 * and, where it has more than one, a binding alias - never a connector's id,
 * which is the host's to resolve and the model's never to see.
 *
 * A tool is offered only to a session that binds a connector of its adapter,
 * and its shape is that session's: one binding means the session has already
 * said whose account this is, so the schema has no `connector` at all and the
 * host fills it in; two or more make it a required choice from the aliases.
 * Every call reads the bindings again, so a binding removed since the list was
 * built is refused rather than run.
 */

import { isRecordSlug } from '../resources/records.js';
import { isRecord, reason } from '../utils/values.js';
import { bindingTarget } from './bindings.js';
import type { ConnectorsChannel } from './channel.js';
import type { ToolDefinition, ToolResultContent } from '@microsoft/agent-host-protocol';
import type { ActionCall, Capability, ServedAdapter } from '../types/connectors.js';
import type { HostTool } from '../types/host.js';
import type { OnWire } from '../types/wire.js';
import type { Principal } from '../types/users.js';

/** The input schema a tool definition carries, as the protocol declares it. */
type InputSchema = NonNullable<ToolDefinition['inputSchema']>;

/** What a tool built here needs from the host that offers it. */
export interface ActionHost {
  /** The connectors one session may use, by alias, read live. */
  bindings(uri: string): Record<string, string>;
  /**
   * The principal of one session's owner, which its calls run as.
   *
   * `undefined` is a session nobody owns, or the host's own, which runs as the
   * daemon. `'nobody'` is a person this process has not seen sign in since it
   * started: their grants cannot be read, so the call is refused rather than
   * run unchecked.
   */
  principalOf(uri: string): Principal | 'nobody' | undefined;
  /**
   * Where one session's attachments are kept, or nothing where its store
   * keeps no files.
   *
   * The folder travels with each call, so an adapter's action reads a file
   * the session holds and writes a file the session keeps.
   */
  attachmentsDir(uri: string): string | undefined;
  /** Where a tool name two actions claim is reported. */
  onProblem(message: string): void;
}

/** Every character a tool name may not hold, written as `_` instead. */
const UNSAFE = /[^A-Za-z0-9_]/gu;

/**
 * The name an action's tool goes by: `<adapter>_<action>`.
 *
 * A tool name is a word the model spells back, and the protocol's names hold
 * letters, digits and underscores, so an adapter or an action whose own name
 * has anything else - `ap-resend`, `send email` - is written with `_` in its
 * place. Two actions that still meet on one name are the caller's to report.
 */
export const actionToolName = (adapter: string, action: string): string =>
  `${adapter}_${action}`.replace(UNSAFE, '_');

/** The aliases a session binds for one adapter, in the order they were declared. */
const aliasesFor = (bindings: Record<string, string> | undefined, adapter: string): string[] => {
  if (bindings === undefined) return [];
  return Object.entries(bindings)
    .filter(([alias, value]) => isRecordSlug(alias) && bindingTarget(value)?.adapter === adapter)
    .map(([alias]) => alias);
};

/** The connector one alias names, when it names one of this adapter. */
const targetFor = (bindings: Record<string, string> | undefined, alias: unknown, adapter: string): string | undefined => {
  if (typeof alias !== 'string' || bindings === undefined) return undefined;
  const target = bindingTarget(bindings[alias]);
  return target?.adapter === adapter ? target.id : undefined;
};

/**
 * The input schema one session sees.
 *
 * The capability's own `input`, and what this session says about `connector`:
 * none of it when one binding is all, an `enum` of the aliases and required
 * when there are more, and a plain string property on the unshaped form.
 */
const formOf = (capability: Capability, aliases: string[] | undefined): InputSchema => {
  const held = isRecord(capability.input) ? capability.input : {};
  const base = isRecord(held.properties) ? held.properties as Record<string, object> : {};
  const required = Array.isArray(held.required)
    ? held.required.filter((one): one is string => typeof one === 'string' && one !== 'connector')
    : [];
  if (aliases !== undefined && aliases.length < 2) {
    return { ...held, type: 'object', properties: { ...base }, required } as InputSchema;
  }
  return {
    ...held,
    type: 'object',
    properties: {
      ...base,
      connector: {
        type: 'string',
        ...(aliases === undefined ? {} : { enum: aliases }),
        description: 'The connector to run on, by the name this session gave it.',
      },
    },
    required: aliases === undefined ? required : [...required, 'connector'],
  } as InputSchema;
};

/** One tool, for one action of one adapter. */
const actionTool = (
  adapter: ServedAdapter,
  capability: Capability,
  name: string,
  run: ConnectorsChannel['run'],
  host: ActionHost,
): HostTool => {
  const action = capability.name;
  return {
    definition: {
      name,
      title: capability.title,
      description: capability.description,
      inputSchema: formOf(capability, undefined),
      annotations: { title: capability.title, readOnlyHint: false, openWorldHint: true },
    },
    /*
     * Offered to the sessions that bind at least one connector of this
     * adapter, and shaped by which and how many. Read at each list, so a
     * binding that arrived since the last one reaches it.
     */
    forSession: ({ bindings }) => {
      const aliases = aliasesFor(bindings, adapter.name);
      if (aliases.length === 0) return { offered: false };
      return { offered: true, definition: { inputSchema: formOf(capability, aliases) } };
    },
    run: async (input, at) => {
      // Read now, not when the list was built: a binding removed since is a
      // connector this call may not use, whatever the model was offered.
      const held = host.bindings(at.session);
      const aliases = aliasesFor(held, adapter.name);
      const asked = typeof input.connector === 'string' ? input.connector : undefined;
      if (asked === undefined && aliases.length !== 1) {
        throw new Error(aliases.length === 0
          ? `This session binds no ${adapter.name} connector, so ${name} cannot run.`
          : `${name} needs connector, one of ${aliases.join(', ')}.`);
      }
      // A schema with no `connector` is a session with one binding, and the
      // host is what fills it in.
      const alias = asked ?? aliases[0] as string;
      const id = targetFor(held, alias, adapter.name);
      if (id === undefined) {
        throw new Error(`${alias} is not a ${adapter.name} connector this session binds.`);
      }
      const { connector: _asked, ...rest } = input;
      const reader = host.principalOf(at.session);
      if (reader === 'nobody') {
        throw new Error(`${alias}: this session's owner has to sign in once before ${name} can run.`);
      }
      // The folder is read now, as the bindings are: it belongs to the session
      // this call came from, and a call names no folder of its own. A call
      // with nothing beside its input is handed no `call`.
      const files = host.attachmentsDir(at.session);
      const call: ActionCall = {
        ...(files === undefined ? {} : { files }),
        ...(at.setContent === undefined ? {} : { setContent: (content: OnWire<ToolResultContent>[]) => { at.setContent?.(content); } }),
      };
      try {
        const answer = await run(id, reader, action, rest, Object.keys(call).length === 0 ? undefined : call);
        return typeof answer === 'string' ? answer : JSON.stringify(answer) ?? 'Done.';
      }
      catch (error) {
        /*
         * The alias and the reason, and the reason in the model's own words:
         * a channel sentence that names the connector says the alias instead,
         * so the id is not something a model is ever handed.
         */
        throw new Error(`${alias}: ${reason(error).split(id).join(alias)}`);
      }
    },
  };
};

/**
 * One tool for each `action` capability of each adapter that can run one.
 *
 * Built once, when the host starts: the adapters are the fold's and do not
 * change while the daemon runs. An adapter with no `run` offers no tool, and
 * so does one whose `action` has no `input` the host can describe. The first
 * of two actions that meet on one name is the one offered, and the second is
 * said in the host's problem log rather than silently dropped.
 */
export const actionTools = (
  adapters: Record<string, ServedAdapter>,
  run: ConnectorsChannel['run'],
  host: ActionHost,
): HostTool[] => {
  const tools: HostTool[] = [];
  const named = new Set<string>();
  for (const adapter of Object.values(adapters).sort((one, two) => one.name.localeCompare(two.name))) {
    if (typeof adapter.run !== 'function') continue;
    for (const capability of adapter.capabilities) {
      if (capability.type !== 'action') continue;
      const name = actionToolName(adapter.name, capability.name);
      if (named.has(name)) {
        host.onProblem(`${adapter.name}'s ${capability.name} is offered as ${name}, and another action already is - the first is kept`);
        continue;
      }
      named.add(name);
      tools.push(actionTool(adapter, capability, name, run, host));
    }
  }
  return tools;
};

import { expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { acpAgent } from '../packages/agent-acp/src/index.js';

/*
 * The ACP backend's identity, without starting anything.
 *
 * `acpAgent` builds an `Agent` from an options object and spawns nothing, so
 * what this checks is the part a client reads before a session exists: the
 * provider it may name, the name it sees, the controls it may fill in, and the
 * values they start at.
 */

it('registers the acp provider and display name by default', () => {
  const agent = acpAgent({ command: 'node' });
  expect(agent.provider).toBe('acp');
  expect(agent.displayName).toBe('ACP');
  expect(agent.description).toBeUndefined();
});

it('carries an approvals control on the session, with the named model as the default', () => {
  const agent = acpAgent({ command: 'node', model: 'gpt-5' });
  const schema = agent.schema();
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  expect(Object.keys(properties)).toEqual(['permissionMode']);
  expect(properties.permissionMode).toMatchObject({ type: 'string', scope: 'session', sessionMutable: true });
  // The server's modes are unknown until a session asks it, so there is no
  // enum here; a session that has asked reports the learned one instead.
  expect(properties.permissionMode?.enum).toBeUndefined();
  /*
   * The model is not a control, because it belongs to the turn rather than to
   * the conversation - but the configured id is still the default a client is
   * offered, and sends back as the model the turn runs on.
   */
  expect(agent.defaults()).toEqual({ model: 'gpt-5' });
  // Nothing was named, so nothing is defaulted: a default invented for a model
  // nobody can reach is a session that fails at the first call.
  expect(acpAgent({ command: 'node' }).defaults()).toEqual({});
});

it('names two providers from two options objects', () => {
  const first = acpAgent({ command: 'copilot', args: ['--acp'], provider: 'copilot' });
  const second = acpAgent({ command: 'codex-acp', provider: 'codex-acp', displayName: 'Codex' });
  expect([first.provider, second.provider]).toEqual(['copilot', 'codex-acp']);
  expect(second.displayName).toBe('Codex');
  expect(first.description).toBeUndefined();
});

it('will not take two backends that call themselves the same thing', () => {
  expect(() => createHost({
    path: process.cwd(),
    agents: [acpAgent({ command: 'node' }), acpAgent({ command: 'node' })],
  })).toThrow(/acp/);
});

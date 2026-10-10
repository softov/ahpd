import { IS_CLIENT_DISPATCHABLE } from '@microsoft/agent-host-protocol';
import { expect, it } from 'vitest';
import { GATE } from '../src/host.js';
import { GROUPS, OPERATIONS, groupOf, holds } from '../src/users.js';
import { host, peer } from './users-gate-helpers.js';
import type { Grant } from '../src/types/users.js';

/** How many methods the host serves. A method added is a number raised here. */
const SERVED = 50;

it('classifies every handler the host serves', () => {
  /*
   * Read off the table the host actually builds, which is the only list there
   * is: it is assembled per connection out of the families under `host/` and
   * there is nothing on disk that says what it holds. A handler added and
   * classified nowhere is a method nobody decided about, and this fails on the
   * next run rather than serving it to anybody - which is the property
   * `needsWrite` did not have.
   *
   * The table was read out of the source before, by a pattern that needed a
   * `(params)` parameter, so `ping`, `shutdown`, `getManagedSettingsDiagnostics`
   * and `getNetworkDiagnosticsInfo` - a method that ignores its params is still
   * a method - were never seen at all.
   */
  const { methods: served } = host().accept(peer());
  expect(served.length).toBe(SERVED);

  const classified = new Set([...Object.keys(GATE.NEEDS), ...GATE.UNGATED]);
  expect(served.filter((one) => !classified.has(one))).toEqual([]);
  // And the check would notice one: a method in neither list is exactly what
  // the line above looks for.
  expect(['listSessions', 'a_handler_nobody_classified'].filter((one) => !classified.has(one)))
    .toEqual(['a_handler_nobody_classified']);
});

it('classifies every action a client is allowed to send', () => {
  /*
   * `IS_CLIENT_DISPATCHABLE` is the protocol's own exhaustive answer to "may a
   * client originate this?", so it is what the gate has to cover: an action a
   * client may send that nobody classified is a dispatch served with no
   * question asked of anybody.
   *
   * It is widened to a record here for the same reason `actions.ts` widens it:
   * `Object.entries` over a mapped type is fine, but the entries are read as
   * `[string, boolean]` by a test that has to name a made-up type.
   */
  const dispatchable = IS_CLIENT_DISPATCHABLE as Record<string, boolean>;
  const sendable = Object.entries(dispatchable).filter(([, may]) => may === true).map(([type]) => type);
  expect(sendable.length).toBe(47);
  expect(sendable.filter((one) => GATE.ACTION_NEEDS[one] === undefined)).toEqual([]);
  // And the check would notice one, which is the line above with a type that
  // is in the protocol's map and in nobody's table.
  expect(['chat/turnStarted', 'chat/turnMadeUp'].filter((one) => GATE.ACTION_NEEDS[one] === undefined))
    .toEqual(['chat/turnMadeUp']);
});

it('asks every method and action for an operation the table knows, or a group of one', () => {
  /*
   * A gate entry is either an operation its subject has or one of the two
   * groups that name halves of a subject - never a verb that is neither, and
   * never an operation a subject does not have, because a grant matching
   * nothing looks on every later read like a permission this host has.
   *
   * `file` is the one subject the request's own URI replaces, so a scheme the
   * table does not decide is answered with the same operation.
   */
  const named = [...Object.entries(GATE.NEEDS), ...Object.entries(GATE.ACTION_NEEDS)]
    .filter(([, grant]) => !['file:write', 'config:read', 'config:write', 'computer:write'].includes(grant));
  for (const [what, grant] of named) {
    const at = grant.indexOf(':');
    const subject = grant.slice(0, at);
    const operation = grant.slice(at + 1);
    expect(what.length, grant).toBeGreaterThan(0);
    expect(GROUPS, `${grant} for ${what} is a group, not an operation`).not.toContain(operation);
    if (subject === 'file' || !OPERATIONS[subject]) continue;
    expect(groupOf(subject, operation), `${grant} for ${what} is not an operation ${subject} has`)
      .toBeDefined();
  }
  // The four that are groups, said out loud: `invokeChangesetOperation` writes
  // a session's files and cannot be narrowed to one operation, a root setting
  // changes the host for everybody, `seesConfig` shows every key the daemon
  // holds, and a session that names a source is held to the whole write of a
  // computer.
  expect(GATE.NEEDS.invokeChangesetOperation).toBe('session:changes');
  expect(GATE.NEEDS['vscode/devContainers/connect']).toBe('container:connect');
});

it('answers every method and action for a role of whole groups as the verb it replaced', () => {
  /*
   * The matrix, over the three built-ins and the two roles `docs/USERS.md`
   * spells out. What it asserts is not a recorded table of booleans but the
   * property behind it: an operation is covered by exactly the role that held
   * the group it sits in, so nothing an existing role could do stops working
   * and nothing it could not do starts.
   *
   * Recomputing the old answer rather than writing it down is what keeps this
   * honest as the gate moves - a recorded table only says what it said.
   */
  const ROLES: Record<string, Grant[]> = {
    admin: ['*:*'],
    member: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'],
    guest: ['session:read', 'automation:read'],
    viewer: ['*:read'],
    editor: ['file:read', 'file:write', 'session:read', 'session:write'],
  };
  /** What the gate asked for under the verb, as a grant naming the whole group. */
  const under = (grant: Grant): Grant => {
    const at = grant.indexOf(':');
    const subject = grant.slice(0, at);
    const operation = grant.slice(at + 1);
    const group = (GROUPS as readonly string[]).includes(operation) ? operation : groupOf(subject, operation);
    return `${subject}:${group ?? 'read'}` as Grant;
  };
  for (const [role, granted] of Object.entries(ROLES)) {
    const held = new Set(granted);
    for (const [what, grant] of [...Object.entries(GATE.NEEDS), ...Object.entries(GATE.ACTION_NEEDS)]) {
      // A chat's groups are the session's, which is what they were before a
      // chat had a subject, so `under` is asked about the session.
      const group = under(grant);
      const before = group === 'chat:read' || group === 'chat:write'
        ? holds(held, group) || holds(held, `session:${group.slice('chat:'.length)}` as Grant)
        : holds(held, group);
      expect(holds(held, grant), `${role} and ${what}, which asks ${grant}`).toBe(before);
    }
  }
  // And the shape of it, so a role that changed would say so here and not only
  // in the table above: an admin reaches everything and a guest reaches the
  // two reads it is built to and nothing that writes.
  const need = (name: string): Grant => GATE.NEEDS[name] as Grant;
  const admin = new Set(ROLES.admin as string[]);
  expect(Object.values(GATE.NEEDS).every((one) => holds(admin, one))).toBe(true);
  expect(Object.values(GATE.ACTION_NEEDS).every((one) => holds(admin, one))).toBe(true);
  const guest = new Set(ROLES.guest as string[]);
  expect(holds(guest, need('listSessions'))).toBe(true);
  expect(holds(guest, need('createSession'))).toBe(false);
  expect(holds(guest, need('resourceWrite'))).toBe(false);
  expect(holds(guest, need('runAutomation'))).toBe(false);
  expect(holds(guest, GATE.ACTION_NEEDS['chat/turnStarted'] as Grant)).toBe(false);
  expect(holds(guest, need('listAutomationTriggerDefinitions'))).toBe(true);
});
import { expect, it } from 'vitest';
import { membership, namesOf, scopeFor } from '../src/scopes.js';
import type { Named } from '../src/types/users.js';
import type { Principal } from '../src/types/users.js';

/*
 * Which team and project a piece of work is for.
 *
 * A principal is built by hand rather than through a file, because what is
 * under test is the resolution and not the reading: the directory checks the
 * memberships it holds and says once what it dropped, which `users.test.ts`
 * covers.
 */

/** Somebody who holds what is written, out of what this install names. */
const person = (memberships: string[], primary?: string, projects: string[] = []): Principal => ({
  id: 'luiz',
  roles: [],
  can: () => true,
  memberships,
  ...(primary === undefined ? {} : { primary }),
  projects: projects.map((id): Named => ({ id })),
  teams: [{ id: 'backend' }, { id: 'frontend' }, { id: 'a' }],
});

/** The same, from a directory that did not say which projects there are. */
const unnamed = (principal: Principal): Principal => {
  const { projects: _projects, ...rest } = principal;
  return rest;
};

/** The same, from a file whose `teams` list is empty. */
const teamless = (principal: Principal): Principal => ({ ...principal, teams: [] });

/** The same, from a directory that does not say which teams there are. */
const unteamed = (principal: Principal): Principal => {
  const { teams: _teams, ...rest } = principal;
  return rest;
};

/** The plan's own example: a wildcard team, one project of another, and a primary. */
const luiz = person(['backend:*', 'frontend:controllr'], 'backend:ahpd', ['ahpd', 'cofold', 'controllr']);

it('resolves nothing named to the primary, and what the primary names to itself', () => {
  expect(scopeFor(luiz)?.scope).toEqual({ team: 'backend', project: 'ahpd' });
  expect(scopeFor(luiz, 'frontend:controllr')?.scope).toEqual({ team: 'frontend', project: 'controllr' });
});

it('refuses a project the person does not hold, and says what they may name', () => {
  const answer = scopeFor(luiz, 'frontend:other');
  expect(answer?.scope).toBeUndefined();
  // The wildcard is not a place either, so what is offered is the projects
  // behind it and the one project of the other team.
  expect(answer?.refusal).toBe('luiz may name backend:ahpd, backend:cofold, backend:controllr, frontend:controllr');
});

it('refuses a team the person belongs to by another membership', () => {
  expect(scopeFor(luiz, 'frontend')?.refusal).toBe('luiz may name backend:ahpd, backend:cofold, backend:controllr, frontend:controllr');
  // A project this install does not name is not one anybody works in, whatever
  // the wildcard covers.
  expect(scopeFor(luiz, 'backend:somewhere')?.refusal).toBe('luiz may name backend:ahpd, backend:cofold, backend:controllr, frontend:controllr');
});

it('resolves a bare team, which only a bare membership covers', () => {
  const alone = person(['backend'], undefined, ['ahpd']);
  expect(scopeFor(alone)?.scope).toEqual({ team: 'backend' });
  expect(scopeFor(alone, 'backend')?.scope).toEqual({ team: 'backend' });
  // `backend:*` is every project of the team and not team work, so naming
  // `backend` under it alone is refused: a project is needed.
  expect(scopeFor(person(['backend:*'], undefined, ['ahpd']), 'backend')?.refusal).toBeDefined();
  expect(scopeFor(person(['backend:*'], undefined, ['ahpd']), 'backend:ahpd')?.scope).toEqual({ team: 'backend', project: 'ahpd' });
  // And naming the wildcard itself is not naming a place.
  expect(scopeFor(luiz, 'backend:*')?.refusal).toBe('luiz may name backend:ahpd, backend:cofold, backend:controllr, frontend:controllr');
});

it('falls to the one concrete membership, and refuses when there are several', () => {
  const only = person(['frontend:controllr', 'backend:*'], undefined, ['ahpd']);
  expect(scopeFor(only)?.scope).toEqual({ team: 'frontend', project: 'controllr' });

  const several = person(['frontend:controllr', 'frontend:other', 'backend:*']);
  expect(scopeFor(several)?.scope).toBeUndefined();
  expect(scopeFor(several)?.refusal).toBe('luiz may name frontend:controllr, frontend:other');
});

it('answers nothing at all with nobody to ask', () => {
  // No users directory, or a root connection: neither has a principal, and so
  // neither has a scope and neither is refused.
  expect(scopeFor(undefined)).toBeUndefined();
  expect(scopeFor(undefined, 'backend:ahpd')).toBeUndefined();
});

it('says so for a person in no team', () => {
  const nobody = person([]);
  expect(scopeFor(nobody)?.refusal).toBe('luiz belongs to no team and project, so there is nothing to charge');
  expect(namesOf(nobody)).toEqual([]);
});

it('charges nothing at all while the file names no team', () => {
  // A host that has not been given the subject yet runs unscoped, exactly as a
  // host with no users directory does, rather than refusing work it cannot
  // charge to a team nobody has named.
  const nothing = teamless(luiz);
  expect(scopeFor(nothing)).toBeUndefined();
  expect(scopeFor(nothing, 'backend:ahpd')).toBeUndefined();
  // Somebody in no team at all is in the same case, and is not refused either:
  // there is nothing to refuse, because nothing is being charged.
  expect(scopeFor(teamless(person([])))).toBeUndefined();
});

it('asks for a scope as soon as the file names one team', () => {
  // One team is enough: a host that has the subject is a host that charges.
  const one = person([], undefined, ['ahpd']);
  expect(scopeFor({ ...one, teams: [{ id: 'backend' }] })?.refusal)
    .toBe('luiz belongs to no team and project, so there is nothing to charge');
  // A directory that does not say which teams there are charges nothing.
  expect(scopeFor(unteamed(one))).toBeUndefined();
  expect(scopeFor(unteamed(luiz), 'backend:ahpd')).toBeUndefined();
});

it('takes a directory that did not say which projects there are at its word', () => {
  // Absent is "assume yes", which is what a principal built by hand or an
  // embedder without a file answers. A refusal here would say the person may
  // name nothing while it is the directory that named nothing.
  const luiz = unnamed(person(['a:b']));
  expect(scopeFor(luiz)?.scope).toEqual({ team: 'a', project: 'b' });
  expect(scopeFor(luiz, 'a:b')?.scope).toEqual({ team: 'a', project: 'b' });
  expect(scopeFor(unnamed(person(['a:b'], 'a:b')))?.scope).toEqual({ team: 'a', project: 'b' });
  // The membership still has to be one they hold, whatever the directory said.
  expect(scopeFor(luiz, 'a:c')?.refusal).toBe('luiz may name a:b');
  // And a directory that says there is none is a different answer, not an
  // absent one: it has said the project is not one anybody works in.
  expect(scopeFor(person(['a:b'], undefined, []), 'a:b')?.refusal).toBe('luiz may name a:b');
  expect(scopeFor(person(['a:b'], undefined, ['b']), 'a:b')?.scope).toEqual({ team: 'a', project: 'b' });
});

it('names what may be named, without a repeat and in the order they wrote it', () => {
  expect(namesOf(luiz)).toEqual(["backend:ahpd", "backend:cofold", "backend:controllr", "frontend:controllr"]);
  expect(namesOf(person(['backend:ahpd', 'backend:ahpd'], undefined, ['ahpd']))).toEqual(['backend:ahpd']);
  // A wildcard over no known project offers nothing rather than the wildcard.
  expect(namesOf(person(['backend:*'], undefined, []))).toEqual([]);
});

it('parses the three forms, and nothing else', () => {
  expect(membership('backend')).toEqual({ written: 'backend', team: 'backend' });
  expect(membership('backend:*')).toEqual({ written: 'backend:*', team: 'backend', project: '*' });
  expect(membership('backend:ahpd')).toEqual({ written: 'backend:ahpd', team: 'backend', project: 'ahpd' });
  expect(membership('')).toBeUndefined();
  expect(membership(':ahpd')).toBeUndefined();
  expect(membership('backend:')).toBeUndefined();
});
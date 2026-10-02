/**
 * Which team and project a piece of work is charged to.
 *
 * A session, a proxy request and a turn all resolve to one, from what they
 * name or from the person's primary - decision
 * `a-request-naming-no-scope-uses-the-persons-primary`. Nothing here grants
 * anything: a membership says what work may be charged to, and a role says
 * what a person may do.
 */

import type { Principal } from './types/users.js';

/** One team, and the project its work is for when it names one. */
export interface Scope {
  /** The team the work is charged to. */
  readonly team: string;
  /** The project within it, which team work has none of. */
  readonly project?: string;
}

/** What `scopeFor` answers: a scope, or why there is none. */
export type ScopeAnswer =
  | { readonly scope: Scope; readonly refusal?: undefined }
  | { readonly refusal: string; readonly scope?: undefined };

/** One membership as the file wrote it, and what it says. */
export interface Membership {
  /** The entry itself, which is what a refusal quotes back. */
  readonly written: string;
  /** The team before the colon. */
  readonly team: string;
  /** The project after it: a name, or `*` for any of them, absent for team work. */
  readonly project?: string;
}

/**
 * A membership as it is written, or nothing when it is not one.
 *
 * `team`, `team:*` and `team:project` are the whole grammar, parsed here
 * rather than by each caller.
 */
export const membership = (written: string): Membership | undefined => {
  const at = written.indexOf(':');
  if (at === -1) return written === '' ? undefined : { written, team: written };
  const team = written.slice(0, at);
  const project = written.slice(at + 1);
  if (team === '' || project === '') return undefined;
  return { written, team, project };
};

/** Whether this membership says any project of its team rather than one of them. */
const anyProject = (one: Membership): boolean => one.project === '*';

/**
 * Whether one of a person's memberships covers a scope they wrote.
 *
 * `team:*` covers every project of its team and a bare `team` covers only a bare
 * `team`: team work is not one of its projects.
 */
export const covers = (memberships: readonly string[], wanted: string): boolean => {
  if (memberships.includes(wanted)) return true;
  const parsed = membership(wanted);
  return parsed !== undefined && parsed.project !== undefined && memberships.includes(`${parsed.team}:*`);
};

/** The memberships a person holds, parsed and without a repeat. */
const heldBy = (principal: Principal): Membership[] => {
  const seen = new Set<string>();
  const held: Membership[] = [];
  for (const written of principal.memberships ?? []) {
    const one = membership(written);
    if (one === undefined || seen.has(one.written)) continue;
    seen.add(one.written);
    held.push(one);
  }
  return held;
};

/** What one membership charges to, which is what it says it covers. */
const scopeOf = (one: Membership): Scope => (one.project === undefined ? { team: one.team } : { team: one.team, project: one.project });

/**
 * The membership a named scope is had under.
 *
 * `team:*` is every project of that team and a bare `team` is team work and
 * nothing else, which is why naming `backend` under `backend:*` alone is
 * refused: there is no project to charge it to. A `*` named as a project is
 * not a place, so it is never what a name resolves to.
 */
const covering = (held: readonly Membership[], team: string, project?: string): Membership | undefined =>
  held.find((one) => one.team === team && (
    project === undefined ? one.project === undefined : one.project === project || one.project === '*'));

/**
 * Every scope this person may name, in the order they wrote their memberships.
 *
 * A `team:*` becomes one entry per project this install knows, because a
 * membership is not itself a place to work in.
 */
export const namesOf = (principal: Principal): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  const offer = (written: string): void => {
    if (seen.has(written)) return;
    seen.add(written);
    names.push(written);
  };
  for (const one of heldBy(principal)) {
    if (anyProject(one)) for (const project of principal.projects ?? []) offer(`${one.team}:${project.id}`);
    else offer(one.written);
  }
  return names;
};

/**
 * The usage pools one person may see without `usage:read` - decision
 * `usage-is-read-through-a-usage-scheme`.
 *
 * Their own `user:` pool, and one pool per name `namesOf` gives: a bare team
 * becomes `team:<name>` and a `team:project` becomes `project:<team>:<project>`.
 * That is the spelling `meter.ts` charges a record under, so a pool a record was
 * charged to is a pool this lists - and a pool this lists that nothing has been
 * charged to yet is still a pool they may read.
 */
export const poolsFor = (principal: Principal): string[] => [
  `user:${principal.id}`,
  ...namesOf(principal).map((name) => {
    const one = membership(name);
    return one?.project === undefined ? `team:${name}` : `project:${name}`;
  }),
];

/** What they may name, said as a refusal. */
const refused = (principal: Principal): string => {
  const names = namesOf(principal);
  return names.length === 0
    ? `${principal.id} belongs to no team and project, so there is nothing to charge`
    : `${principal.id} may name ${names.join(', ')}`;
};

/**
 * What a piece of work is for, or why nothing could be said.
 *
 * `named` is what the work said, `team` or `team:project`. Without it the
 * person's primary is used, and with no primary their one concrete membership
 * - the case a harness pointed at this host with nothing but a key and a base
 * URL is in.
 *
 * Nothing at all when there is nobody to resolve one for: a host with no users
 * directory has no principal to ask, a root connection is the host itself
 * rather than a person whose work it is, and a file that names no team at all
 * is a host that has not been given the subject yet rather than a person
 * whose work nothing can be charged to.
 */
export function scopeFor(principal: Principal | undefined, named?: string): ScopeAnswer | undefined {
  if (principal === undefined) return undefined;
  if (principal.teams === undefined || principal.teams.length === 0) return undefined;
  const wanted = named === undefined || named === '' ? undefined : membership(named);
  if (wanted === undefined) {
    const primary = principal.primary;
    // The primary is one of their memberships, checked when the file was read,
    // so this is the same answer naming it would have given.
    if (primary !== undefined) return scopeFor(principal, primary);
    const concrete = heldBy(principal).filter((one) => !anyProject(one));
    const [only] = concrete;
    return concrete.length === 1 && only !== undefined ? { scope: scopeOf(only) } : { refusal: refused(principal) };
  }
  if (wanted.project === '*') return { refusal: refused(principal) };
  // A project this install does not name is not one anybody works in, whatever
  // the membership covers. A principal that did not say is a directory that
  // does not know, which is not the same as one that says there is none.
  if (wanted.project !== undefined && principal.projects !== undefined
    && !principal.projects.some((one) => one.id === wanted.project)) {
    return { refusal: refused(principal) };
  }
  const found = covering(heldBy(principal), wanted.team, wanted.project);
  return found === undefined ? { refusal: refused(principal) } : { scope: scopeOf(wanted) };
}
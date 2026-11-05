import type { Session } from '../../src/types/session.js';

/**
 * The session a backend answered at once.
 *
 * `Agent.create` answers a promise only for a step to make before the session
 * can be answered for, a fork's copy or a truncation's cut; a case that asks
 * for neither of an agent it holds by the general type reads the session it
 * was answered, and a promise there is the case's own mistake.
 */
export const startedNow = (made: Session | Promise<Session>): Session => {
  if (made instanceof Promise) throw new Error('the backend answered a promise where a session was asked for at once');
  return made;
};

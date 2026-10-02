/**
 * `ahpd team` and `ahpd project`: the names a membership is written out of.
 *
 * A team and a project are an id and what a client shows for it, and nothing
 * else: a project is not a directory, so `project add` creates no folder and
 * `project rm` removes none. Both live in the users file beside the roles,
 * because that is the file a membership beside them is checked against.
 *
 * The two verbs are declared once and told which they are, the way `user`
 * declares one and is given a file: six commands that share a surface, so a
 * flag is accepted wherever on the line it is typed. Served over HTTP, the file
 * is the daemon's own and the request cannot name another.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import type { Named, Users } from '@ahpd/sdk';
import { conflict, servedTeamFields, stop, teamFields } from './options.js';
import { idOf, people } from './user.js';
import type { ServedFacts } from './served.js';

/** One line per entry, the id and the title when it has one. */
const line = (one: Named): string => (one.title === undefined ? one.id : `${one.id}  ${one.title}`);

/**
 * The refusal a directory makes, said as the verb's own.
 *
 * A membership naming a team or a project the file does not hold is refused
 * here rather than accepted and dropped on the next read, which is the way a
 * typo used to be silently nobody's.
 */
const said = (error: unknown): never => {
  stop(error instanceof Error ? error.message : String(error));
};

export const declareTeams = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  /** The fields the surface accepts: served, the daemon's own file is absent. */
  const fields = served === undefined ? teamFields : servedTeamFields;

  /** The six verbs, one per direction a name may go. */
  const declare = (what: 'team' | 'project'): Command[] => {
    const named = (directory: Users): Promise<Named[]> => (what === 'team' ? directory.teams() : directory.projects());
    const list = registry.action({
      id: `${what}.list`,
      summary: `What this install names as a ${what}`,
      surfaces: { cli: { pattern: [what, 'list'] }, http: { method: 'GET', path: `/${what}/list` } },
      input: fields,
      // Reading the names is not managing people, so it is the read half.
      scopes: ['users:read'],
      run: async (context) => {
        const { path, directory } = people(context, served);
        const rows = await named(directory);
        return output(rows, rows.length === 0 ? `no ${what}s in ${path}\n` : `${rows.map(line).join('\n')}\n`);
      },
    });

    const add = registry.action({
      id: `${what}.add`,
      summary: `Name a ${what}`,
      description: 'Naming one that is already there sets its title and moves nothing.',
      surfaces: { cli: { pattern: [what, 'add', ':id'] }, http: { method: 'POST', path: `/${what}/add/{id}` } },
      input: { ...fields, id: { type: 'string', description: `The id a membership is written with.` } },
      scopes: ['users:write'],
      run: async (context) => {
        const { directory } = people(context, served);
        const id = idOf(context, `${what} add`);
        const title = context.optional<string>('title');
        const rows = await named(directory);
        const had = rows.some((one) => one.id === id);
        await (what === 'team' ? directory.addTeam(id, title) : directory.addProject(id, title)).catch(said);
        const kept = (await named(directory)).find((one) => one.id === id);
        return output(kept ?? { id }, had
          ? `${what} ${id} is already named${title === undefined ? '' : `, now ${title}`}.\n`
          : `Named ${what} ${id}${title === undefined ? '' : ` (${title})`}.\n`);
      },
    });

    const rm = registry.action({
      id: `${what}.rm`,
      summary: `Take a ${what} out of the file`,
      description: 'Refused while a membership still names it, saying who holds it.',
      surfaces: { cli: { pattern: [what, 'rm', ':id'] }, http: { method: 'POST', path: `/${what}/rm/{id}` } },
      input: { ...fields, id: { type: 'string', description: 'The id to take out.' } },
      scopes: ['users:write'],
      run: async (context) => {
        const { directory } = people(context, served);
        const id = idOf(context, `${what} rm`);
        const gone = await (what === 'team' ? directory.removeTeam(id) : directory.removeProject(id)).catch(said);
        if (!gone) conflict(`No ${what} called ${id}.`);
        return output({ id }, `Removed ${what} ${id}.\n`);
      },
    });

    return [list, add, rm];
  };

  return [...declare('team'), ...declare('project')];
};

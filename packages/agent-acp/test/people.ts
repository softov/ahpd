import { ROOT } from '../../sdk/src/host.js';
import type { createHost } from '../../sdk/src/host.js';
import type { Users } from '../../sdk/src/types/users.js';

/*
 * The people a host knows, for the cases whose sessions must have an owner.
 *
 * A backend is told which folders are trusted only by a connection that owns
 * the session, and a connection owns nothing on a host with no people
 * directory - decision `a-folder-is-untrusted-until-a-client-says-otherwise`.
 * So a harness whose window pushes `workspaceTrust` and whose session must
 * actually be trusted has to give the host somebody to be.
 *
 * This is that somebody: anybody whose token is not empty, and who may do
 * everything, so what a case sets up is never what the gate refuses.
 */

/** The resource id the directory answers for, which a client signs in against. */
export const RESOURCE = 'ahpd://users';

export const anyone = (): Users => ({
  resource: { resource: RESOURCE, resource_name: 'ahpd users', authorization_servers: [RESOURCE], required: false },
  verify: async (token) => (token === '' ? undefined : { id: token, roles: ['anyone'], can: () => true }),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'anyone',
});

/** Sign one client in as somebody, which is what gives its sessions an owner. */
export const signIn = async (
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  token = 'anyone',
): Promise<void> => {
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RESOURCE, token } });
};

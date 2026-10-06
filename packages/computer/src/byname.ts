/**
 * Variables handed to `docker run` and `docker exec` by name.
 *
 * `-e NAME` with no value is Docker reading `NAME` from its own environment, so
 * the flag on the command line carries the name and the value travels in the
 * environment the `docker` program is spawned with. A process list on this host
 * shows the argv of every process to every user, and an environment only to
 * the process's own user and root, so a value given this way is not in `ps`.
 *
 * Every value goes this way, not only the ones that look secret: a host cannot
 * tell a key from a setting by its name.
 */

/**
 * The names the `docker` program itself reads from its environment, beside
 * every name starting `DOCKER_OWN_PREFIX`, which stay `-e NAME=VALUE`.
 *
 * Put in docker's own environment, one of these would change how docker runs -
 * which program a wrapper finds, where its configuration is, which daemon or
 * context it talks to - rather than only what the machine is given.
 */
export const DOCKER_OWN: readonly string[] = ['PATH', 'HOME'];

/** Every name starting with this is docker's own: `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG` and the rest. */
export const DOCKER_OWN_PREFIX = 'DOCKER_';

/**
 * Whether `docker` reads a name itself, and so whether it stays in argv.
 *
 * The one place the choice is made, so it can grow or change here alone.
 */
export const dockerOwn = (name: string): boolean => DOCKER_OWN.includes(name) || name.startsWith(DOCKER_OWN_PREFIX);

/**
 * A set of variables as `-e` flags and the environment the `docker` process
 * is spawned with.
 *
 * A name `dockerOwn` answers for is written `-e NAME=VALUE` and kept out of
 * the returned environment; every other is `-e NAME` with its value in `env`.
 * The flags keep the order the variables were given in.
 */
export const byName = (given: Record<string, string>): { flags: string[]; env: Record<string, string> } => {
  const flags: string[] = [];
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(given)) {
    if (dockerOwn(name)) {
      flags.push('-e', `${name}=${value}`);
      continue;
    }
    flags.push('-e', name);
    env[name] = value;
  }
  return { flags, env };
};

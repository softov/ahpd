/**
 * The ahpd a box runs a session's host with, installed in the folder of the
 * user it is reached as, as VS Code installs its CLI on a host it reaches over
 * SSH: a box no download is made for refused in VS Code's words before
 * anything is installed, the install pinned to this host's build at a path
 * keyed by that build, reused when it is there, downloaded by the box when it
 * is not, checked with `--version`, the five most recently used kept, and on a
 * failed download the newest other install of this host's run in its place.
 * Every folder the box answers is checked to be one of this host's installs
 * before it is run, as VS Code checks a fallback CLI's path.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts#L935-L938
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts#L41-L175
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L149-L283
 *
 * What is installed is what a machine's `/opt/ahpd` holds of the `node` and
 * `ahpd` parts, at the versions `versions.json` names: Node from its download,
 * checked by its sha256, `@ahpd/server` by npm with the part's plugins in a
 * plugin root of the install's own, and a launcher that runs it on that Node.
 * The folder is under `$XDG_DATA_HOME/ahpd/server`, where ahpd keeps its data,
 * so the install needs no `sudo` and leaves any other ahpd on the box as it is.
 * The plugin root is given to the host a session starts, and the launcher
 * leaves it unset, so `ahpd plugin install` run there puts a plugin in the
 * box's configuration folder, where it outlives the install, as VS Code starts
 * its CLI with a data folder beside its versioned installs.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L84-L99
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts#L943
 */

import { createHash } from 'node:crypto';
import { AHPD_NPM_FLAGS, platformOf, readParts, versionsPath } from './parts.js';
import type { Part } from './parts.js';

/** The folder the installs are in, as the box's own `sh` expands it. */
export const HOST_ROOT = '"${XDG_DATA_HOME:-$HOME/.local/share}/ahpd/server"';

/** An install's folder under the root, `<version>-<hash>`, and nothing else there. */
export const INSTALL_GLOB = `*-${'[0-9a-f]'.repeat(12)}`;

/**
 * The `uname -m` answers of a Linux box each Node download in `versions.json`
 * is for, as VS Code's installer reads a box's platform.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L149-L179
 */
export const HOST_MACHINES = { 'linux-x64': ['x86_64', 'amd64'], 'linux-arm64': ['aarch64', 'arm64'] } as const;

/*
 * The script, sent to the box's `sh` on stdin with the install's folder, the
 * version, the two Node downloads with their sums and the plugins as its
 * arguments. It prints `root=<the root>` and `install=<the folder that runs>`,
 * with `installed=yes` after an install and `fallback=yes` when the folder is
 * another install than the one asked for.
 *
 * `uname` answers the platform VS Code's installer reads, and a box that is not
 * Linux on x86_64 or aarch64 has no Node download in `versions.json`. The
 * download is unpacked in a folder of its own under the root and renamed into
 * place once `--version` answers, so a folder at the install's path is always
 * a whole install; a second install that finished first is kept, and the
 * later one removed. The launcher finds its folder from its own path, so an
 * install holds no path of the folder it was made in.
 */
const SCRIPT = `
key=$1 version=$2 x64=$3 x64sum=$4 arm64=$5 arm64sum=$6
shift 6
case "$(uname -s) $(uname -m)" in
  ${HOST_MACHINES['linux-x64'].map((one) => `'Linux ${one}'`).join('|')}) url=$x64 sum=$x64sum ;;
  ${HOST_MACHINES['linux-arm64'].map((one) => `'Linux ${one}'`).join('|')}) url=$arm64 sum=$arm64sum ;;
  *) echo "Unsupported remote platform: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
case "$url" in
  *.tar.xz) how=-xJf ;;
  *.tar.gz) how=-xzf ;;
  *) how=-xjf ;;
esac
root=${HOST_ROOT}
dir="$root/$key"
echo "root=$root"
installs() { ls -1td -- "$root"/${INSTALL_GLOB} 2>/dev/null; }
prune() { installs | awk 'NR>5' | xargs -I{} rm -rf -- {} 2>/dev/null; true; }
if [ -x "$dir/bin/ahpd" ]; then
  touch -- "$dir"
  prune
  echo "install=$dir"
  exit 0
fi
install() {
  mkdir -p "$root" && tmp=$(mktemp -d "$root/.install-XXXXXX") || return 1
  (
    cd "$tmp" &&
    curl --fail --silent --show-error --location --output node.tar "$url" &&
    printf '%s  node.tar\\n' "$sum" | sha256sum --check --strict - &&
    mkdir node && tar "$how" node.tar -C node --strip-components=1 && rm node.tar &&
    PATH="$tmp/node/bin:$PATH" && export PATH &&
    npm install --prefix "$tmp/ahpd" ${AHPD_NPM_FLAGS} "@ahpd/sdk@$version" "@ahpd/server@$version" &&
    { [ "$#" -eq 0 ] || AHPD_PLUGIN_ROOT="$tmp/ahpd/plugins" "$tmp/ahpd/node_modules/.bin/ahpd" plugin install --no-enable "$@"; } &&
    mkdir bin &&
    printf '%s\\n' '#!/bin/sh' 'here=$(cd -- "$(dirname -- "$0")/.." && pwd)' 'exec "$here/node/bin/node" "$here/ahpd/node_modules/.bin/ahpd" "$@"' > bin/ahpd &&
    chmod +x bin/ahpd &&
    bin/ahpd --version
  ) && { [ -e "$dir" ] || mv -- "$tmp" "$dir"; }
  held=$?
  rm -rf -- "$tmp"
  return $held
}
if install "$@" >&2; then
  echo "install=$dir"
  echo installed=yes
  prune
  exit 0
fi
found=$(installs | while IFS= read -r one; do
  if "$one/bin/ahpd" --version >/dev/null 2>&1; then echo "$one"; break; fi
done)
[ -n "$found" ] || exit 1
echo "install=$found"
echo fallback=yes
`;

/**
 * Whether a folder the box answered is one of this host's installs: directly
 * under the root it answered and named `<version>-<12 hex digits>`, as VS Code
 * holds a fallback CLI's path to the shape of its own installs before running
 * it, since the folder is what the command that starts the host is made from.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L255-L283
 */
export const isHostInstall = (dir: string, root: string): boolean => {
  if (root === '' || !dir.startsWith(`${root}/`)) return false;
  const name = dir.slice(root.length + 1);
  const at = name.lastIndexOf('-');
  return at > 0 && !name.includes('/') && /^[0-9a-f]{12}$/.test(name.slice(at + 1));
};

/** The command the box runs, before the install's arguments, and the script it reads on stdin. */
export const HOST_INSTALL = { command: ['sh', '-s', '--'], script: SCRIPT } as const;

/** One install of ahpd on a box. */
export interface HostInstall {
  /** The version of ahpd it is. */
  version: string;
  /**
   * Its folder under the root: the version, then a hash of the script and
   * every pinned value it is given, so a moved version, download or plugin is
   * a new folder.
   */
  key: string;
  /** What `HOST_INSTALL.command` is given after it. */
  args: string[];
}

/** The install the parts file pins, read from `versions.json` when no parts are given. */
export const hostInstallOf = (parts: readonly Part[] = readParts()): HostInstall => {
  const node = parts.find((one) => one.kind === 'node');
  const ahpd = parts.find((one) => one.kind === 'ahpd');
  if (node === undefined || ahpd === undefined) {
    throw new Error(`${versionsPath()} names no ${node === undefined ? 'node' : 'ahpd'} part, so there is no ahpd to install on a box`);
  }
  const x64 = platformOf(node, 'linux-x64');
  const arm64 = platformOf(node, 'linux-arm64');
  const pinned = [
    ahpd.version, x64.url, x64.sha256, arm64.url, arm64.sha256,
    ...(ahpd.plugins ?? []).map((one) => `${one}@${ahpd.version}`),
  ];
  const key = `${ahpd.version}-${createHash('sha256').update([SCRIPT, ...pinned].join('\0')).digest('hex').slice(0, 12)}`;
  return { version: ahpd.version, key, args: [key, ...pinned] };
};

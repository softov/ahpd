/**
 * The convention a Dev Tunnel has to follow to be one VS Code will connect to.
 *
 * None of this is in the protocol. It is how VS Code's own tunnel client finds
 * a host and what it presents when it gets there, read off
 * `src/vs/platform/agentHost/common/tunnelAgentHost.ts` and
 * `tunnelAgentHostConnector.ts` in the VS Code repository. A tunnel that does
 * not carry these labels is one the window lists and cannot open, and a host
 * that does not expect the token below is one it reaches and is refused by.
 *
 * Kept as its own file, with no `devtunnel` in it, because this is the part
 * that has to be right: the CLI beside it is a process to spawn.
 */

/**
 * The forwarded port a client looks for.
 *
 * Well known and fixed: the client does not discover which port a tunnel
 * forwarded, it opens this one. So the tunnel forwards this number whatever
 * the daemon bound locally, and the two are not the same number.
 *
 * VS Code's `TUNNEL_AGENT_HOST_PORT`.
 */
export const TUNNEL_PORT = 31546;

/**
 * The label that makes a tunnel one worth looking at.
 *
 * VS Code's `TUNNEL_LAUNCHER_LABEL`. It is how its tunnel list is filtered
 * down from every tunnel the account has, so a tunnel without it is invisible
 * rather than broken.
 */
export const LAUNCHER_LABEL = 'vscode-server-launcher';

/** The prefix of the label carrying the arrangement's version. VS Code's `PROTOCOL_VERSION_TAG_PREFIX`. */
export const PROTOCOL_LABEL_PREFIX = 'protocolv';

/**
 * The version this plugin claims, and why it is not a higher one.
 *
 * VS Code refuses anything below 5 (`TUNNEL_MIN_PROTOCOL_VERSION`) and, from
 * 6 (`TUNNEL_GATEWAY_MIN_PROTOCOL_VERSION`), expects the forwarded port to
 * also serve a selection gateway at `/agent-host/select` - a registry that
 * picks between several agent hosts behind one tunnel, which the tunnel CLI's
 * own launcher provides and a plain port forward does not.
 *
 * So 5 is not a version left behind: it is the one that says "this port is one
 * host, connect to it directly". Claiming 6 would advertise a route that is not
 * there.
 *
 * This versions the tunnel arrangement and has nothing to do with the AHP
 * version the host speaks.
 */
export const PROTOCOL_VERSION = 5;

/** The protocol label as it is written on a tunnel. */
export const PROTOCOL_LABEL = `${PROTOCOL_LABEL_PREFIX}${PROTOCOL_VERSION}`;

/** Every label a tunnel of this plugin's carries beside its name. */
export const LABELS = [PROTOCOL_LABEL, LAUNCHER_LABEL] as const;

/**
 * What VS Code will call this tunnel.
 *
 * `TunnelTags`: the first label that is not the launcher label, does not begin
 * with an underscore and is not a `protocolvN` tag. Read back rather than
 * assumed, so what this plugin prints is what the window will show.
 */
export function displayLabel(labels: readonly string[]): string | undefined {
  return labels.find((label) => (
    label !== LAUNCHER_LABEL
    && !label.startsWith('_')
    && !label.startsWith(PROTOCOL_LABEL_PREFIX)
  ));
}

/** The longest a tunnel's name is, as VS Code and its CLI hold it. */
export const MAX_TUNNEL_NAME_LENGTH = 20;

/** What a machine's name that cleans down to almost nothing becomes, as the CLI writes it. */
const TUNNEL_NAME_PLACEHOLDER = 'remote-machine';

/**
 * A tunnel's name from the machine's host name, as VS Code derives it.
 *
 * VS Code's `tunnelNameFromHostname`, which mirrors the CLI's
 * `clean_hostname_for_tunnel`: `-`, `_` and spaces become `-`, anything else
 * that is not a letter or a digit goes, dashes are trimmed from both ends, a
 * result shorter than two is the placeholder, and the name is lowercased and
 * cut to twenty. `code tunnel`, VS Code's own hosting and this plugin then name
 * one machine the same, which is how each finds the tunnel it hosts.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/remoteTunnel/common/remoteTunnel.ts#L95-L117
 */
export function tunnelNameFromHostname(hostname: string): string {
  let cleaned = '';
  for (const char of Array.from(hostname).slice(0, 60)) {
    if (char === '-' || char === '_' || char === ' ') {
      cleaned += '-';
    } else if (/[0-9a-zA-Z]/.test(char)) {
      cleaned += char;
    }
  }
  const trimmed = cleaned.replace(/^-+|-+$/g, '');
  const name = trimmed.length < 2 ? TUNNEL_NAME_PLACEHOLDER : trimmed;
  return name.toLowerCase().substring(0, MAX_TUNNEL_NAME_LENGTH);
}

/**
 * A name a person configured, as VS Code normalizes it: leading dashes and
 * anything that is not a word character or a dash go, the rest is cut to
 * twenty and lowercased.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/remoteTunnel/common/remoteTunnel.ts#L119-L127
 */
export function normalizeTunnelName(name: string): string {
  return name.replace(/^-+/g, '').replace(/[^\w-]/g, '').substring(0, MAX_TUNNEL_NAME_LENGTH).toLowerCase();
}

/** The alphabet `deriveConnectionToken` spells its answer in. */
const BASE64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * The connection token VS Code will present, worked out from the tunnel's id.
 *
 * This is the part that decides whether a connection over the tunnel is
 * admitted at all. VS Code does not ask a person for a token when it connects
 * through a tunnel and it does not read one off the tunnel: it derives one,
 * `deriveConnectionToken` in `tunnelAgentHostConnector.ts`, and opens
 * `/?tkn=<it>`. The reasoning is that reaching the tunnel already required the
 * Dev Tunnels access boundary, so the token is a value both ends can compute
 * rather than a secret either has to carry.
 *
 * Base64url over the SHA-256 of the id, unpadded, and a leading `-` is
 * prefixed with `a` - a token is a query parameter and one that begins with a
 * dash reads as a flag to something downstream.
 *
 * A daemon that requires a connection token of its own will refuse this one,
 * which is why the plugin reports what it computed rather than keeping it.
 */
export async function deriveConnectionToken(tunnelId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tunnelId)));
  let out = '';
  for (let at = 0; at < digest.length; at += 3) {
    const first = digest[at] as number;
    const second = digest[at + 1];
    const third = digest[at + 2];
    out += BASE64_URL[first >> 2];
    out += BASE64_URL[(first & 0b00000011) << 4 | (second ?? 0) >> 4];
    if (second !== undefined) out += BASE64_URL[(second & 0b00001111) << 2 | (third ?? 0) >> 6];
    if (third !== undefined) out += BASE64_URL[third & 0b00111111];
  }
  return out.startsWith('-') ? `a${out}` : out;
}

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

/**
 * How this plugin finds the tunnel it made last time.
 *
 * Underscore-prefixed on purpose: VS Code's `TunnelTags` skips those when it
 * works out what to call a tunnel, so this one identifies without becoming the
 * name a person reads in the list.
 */
export const IDENTITY_LABEL = '_ahpd';

/** Every label a tunnel of this plugin's carries, before the display name. */
export const LABELS = [LAUNCHER_LABEL, PROTOCOL_LABEL, IDENTITY_LABEL] as const;

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

/**
 * A name turned into something that can be a label.
 *
 * A label is a restricted string and a person's name for their machine is not:
 * leading dashes go, anything that is not a word character or a dash goes, and
 * what is left is cut to twenty. Nothing left is no label rather than an empty
 * one, because an empty label would be the display name and the display name
 * would be nothing.
 */
export function nameLabel(name: string): string | undefined {
  const slug = name.replace(/^-+/, '').replace(/[^\w-]/g, '').slice(0, 20);
  return slug === '' ? undefined : slug;
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

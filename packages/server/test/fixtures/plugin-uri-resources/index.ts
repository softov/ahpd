import { RpcError } from '@ahpd/sdk';
import type { Plugin, ResourceProvider } from '@ahpd/sdk';

/**
 * One host-owned scheme, arriving as a plugin.
 *
 * A read-only `computer:` that answers what the machine is and what it can be
 * asked to do. The runtime a real provider would talk to is Docker, or a
 * hypervisor handed the KVM device; this fixture answers for it rather than
 * starting anything, so the test is about the routing and not about a daemon
 * that may or may not be running on the machine.
 *
 * Two URIs are served and nothing else: no `list`, no `watch` and no writes. A
 * client that asks for one of those hears `-32601`, which is the honest answer
 * from a provider that has no directories and cannot be written to, and is the
 * same answer a read-only store's missing write half gets.
 *
 * The import names the package by its published entry, as a plugin outside
 * this repository would: `ahpd.entry` is what resolves it, and `pnpm test`
 * does not build, so the manifest points at this source file.
 */

export const name = 'uri-resources-plugin';

const STATUS = 'computer://local/status';
const CAPABILITIES = 'computer://local/capabilities';

const bodies: Record<string, string> = {
  [STATUS]: JSON.stringify({ runtime: 'docker', kvm: 'device', state: 'idle' }, null, 2),
  [CAPABILITIES]: JSON.stringify({ runtimes: ['docker', 'kvm'], actions: ['start', 'stop', 'exec'] }, null, 2),
};

export const apply: Plugin['apply'] = (host) => {
  const provider: ResourceProvider = {
    read: async (uri) => {
      const body = bodies[uri];
      if (body === undefined) throw new RpcError(-32008, `No such computer resource: ${uri}`);
      return { data: body, encoding: 'utf-8', contentType: 'application/json' };
    },
    resolve: async (uri) => {
      const body = bodies[uri];
      if (body === undefined) throw new RpcError(-32008, `No such computer resource: ${uri}`);
      const at = new Date(0).toISOString();
      return { uri, type: 'file', size: Buffer.byteLength(body, 'utf8'), mtime: at, ctime: at };
    },
  };
  host.registerResourceProvider('computer', provider);
};

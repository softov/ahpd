import type { PluginHost } from '@ahpd/sdk';

/*
 * A plugin whose options carry the two keywords the protocol's schema has room
 * for on an array and on nothing else.
 *
 * `paths` is an array with both item bounds, which a client is shown; `label`
 * carries the same two keywords under a `string`, which it is not.
 */

export const name = 'bounded';

export const optionsSchema = {
  type: 'object',
  properties: {
    paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    label: { type: 'string', minItems: 1, maxItems: 4 },
  },
};

export function apply(_host: PluginHost): void {}

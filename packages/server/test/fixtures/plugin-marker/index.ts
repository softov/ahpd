import { writeFileSync } from 'node:fs';
import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin that leaves a file behind the moment it is imported.
 *
 * The file is the one `AHPD_MARKER` names, written by the module's top level,
 * so a test can tell whether anything imported it at all.
 */

const marker = process.env['AHPD_MARKER'];
if (marker !== undefined) writeFileSync(marker, 'imported\n');

export const name = 'marker';

export const optionsSchema = { type: 'object', properties: { level: { type: 'integer' } } };

export const apply: Plugin['apply'] = () => {};

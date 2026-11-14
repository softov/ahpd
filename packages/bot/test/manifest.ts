import { readFileSync } from 'node:fs';

/**
 * The bot plugin's contracts, as its manifest declares them.
 *
 * Handed to a plugin host built by hand, as the daemon hands the manifest's, so
 * a registration that needs the manifest to announce it is made as it is made
 * in the daemon.
 */
export const CONTRACTS = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { ahpd: { contracts: Record<string, string[]> } }).ahpd.contracts;

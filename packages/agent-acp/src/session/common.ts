import type { Bag } from '@ahpd/sdk';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** The title a session carries until somebody says something. */
const UNTITLED = 'ACP session';

const messageOf = (why: unknown): string => (why instanceof Error ? why.message : String(why));

export { bag, UNTITLED, messageOf };
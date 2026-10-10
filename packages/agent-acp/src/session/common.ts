import { bag, reason } from '@ahpd/sdk';

/** The title a session carries until somebody says something. */
const UNTITLED = 'ACP session';

/** One error, read by the sdk's reader and named as this package names it. */
const messageOf = reason;

export { bag, UNTITLED, messageOf };

/** Reading a session's history off disk, a page at a time. */

import type { Bag } from './common.js';

/** One page of turns, newest page first, walking backwards. */
export interface Page {
  /** The turns in this page, oldest first. */
  turns: Bag[];
  /** Cursor for the next older page. Absent when the page reaches the start. */
  turnsNextCursor?: string;
}

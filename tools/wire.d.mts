/** Types for `wire.mjs`, which is plain JavaScript so the command can run unbuilt. */

/** One thing a frame said that the protocol does not declare, or did not say at all. */
export interface Defect {
  /** The declaration it was checked against. */
  def: string;
  /** Where in the payload, with array indices folded to `N`. */
  at: string;
  /** What was wrong: an undeclared key, a missing required one, or a type. */
  what: string;
  /** Something identifying the frame it came from - a channel, an action type. */
  sample: string;
}

export declare const SCHEMA: URL;
export declare function stateFor(resource: unknown): string | undefined;
export declare function checker(schema?: unknown): {
  declarations: number;
  checked(): number;
  skipped(): Map<string, number>;
  frame(value: unknown): Defect[];
};
export declare function collapse(defects: Defect[]): [string, { count: number; sample: string }][];
export declare function framesIn(text: string): Generator<Record<string, unknown>>;

/** Shapes shared by more than one channel. */

/**
 * An object with no declared shape.
 *
 * Used for JSON arriving off the wire and for the agent SDK's frames, both of
 * which are read field by field rather than trusted as a type.
 */
export type Bag = Record<string, unknown>;

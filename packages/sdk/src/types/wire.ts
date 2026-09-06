/** The protocol's own shapes, as they actually go down the socket. */

import type { Bag } from './common.js';

/**
 * Why this exists at all.
 *
 * Every payload this host builds used to be a `Bag`, and that is how 0.9.0
 * moved a terminal's exit code inside `lifecycle`, removed `Turn.error` and
 * required an `ErrorInfo` on a failed MCP server without a single compile
 * error here. Three shape defects in one afternoon's audit, each one a client
 * behaving correctly and getting it wrong. Typing the construction sites
 * against the package turns the next one into a build failure.
 *
 * The conversion is needed because the protocol types its discriminants as
 * `const enum`, and this project compiles with `verbatimModuleSyntax`, which
 * refuses to import an ambient const enum as a value. That is not a problem
 * worth casting past: what travels on the wire *is* the string, and
 * `` `${SomeEnum}` `` is the set of strings that enum can be - checked, so a
 * value renamed upstream stops matching here exactly as a field would.
 */

/** One value, with string enums widened to the strings they are. */
type WireValue<V> =
  // A function is not a payload. Left alone so a shape carrying one - which
  // none of these do - does not silently become something else.
  V extends (...args: never[]) => unknown ? V
    : V extends string ? `${V}`
      : V extends readonly (infer E)[] ? WireValue<E>[]
        : V extends object ? OnWire<V>
          : V;

/**
 * A protocol shape as this host builds it.
 *
 * Optional keys stay optional, which matters under `exactOptionalPropertyTypes`:
 * a field the protocol allows to be absent must not become one that has to be
 * present and `undefined`.
 */
export type OnWire<T> = { [K in keyof T]: WireValue<T[K]> };

/**
 * A turn, whose parts are checked where they are built rather than here.
 *
 * `responseParts` is seven kinds and an eight-state tool call, assembled piece
 * by piece as an agent talks - so the array cannot carry a union the way a
 * finished value can: a call is `running` when it is pushed and `completed`
 * three frames later, and a variable declared as either fights the other.
 *
 * The gap this used to leave is where the worst of it hid. A rebuilt
 * transcript wrote a tool-call `status` that is not one of the seven, left off
 * three fields the completed state requires, and gave its content blocks no
 * `type` - four defects in one object, none of them a compile error, and every
 * one of them a conversation that would not draw. So each part is now checked
 * against the state it claims, at the moment it is built, with `satisfies` on
 * the literal; what stays loose here is only the mutation that follows.
 */
export type WireTurn<T> = Omit<OnWire<T>, 'responseParts'> & { responseParts: Bag[] };

/**
 * On `satisfies` rather than annotation, where you see it.
 *
 * A turn is built as an `ActiveTurn` and then *mutated* into a `Turn` - a
 * state and a duration are set on the same object when it ends. Declaring the
 * variable as either one fights the other, so the literal is checked with
 * `satisfies` at the moment it is built and the variable stays a `Bag` for the
 * mutation that follows. The construction is what the protocol changes under,
 * and the construction is what is checked.
 */

/**
 * Who a person is, and what they may do.
 *
 * A `Principal` is not a client. A client is whoever opened a socket, and the
 * connection token in `listen.ts` is the whole of what that proves. A person
 * pushed a credential of their own through `authenticate` and the host checked
 * it against a directory it owns.
 *
 * Nothing here imports a runtime value: the directory the host reads is a port,
 * and `fileUsers()` is one implementation of it.
 */

/**
 * One thing a role may be given.
 *
 * Six, and they are the host's whole surface: a file, a session, a shell, the
 * automation clock and the diagnostics the window asks for. A capability is
 * deliberately not a method name, so a handler renamed does not silently move
 * who may call it.
 */
export type Capability = 'read' | 'write' | 'session' | 'terminal' | 'automation' | 'diagnostics';

/**
 * A capability, or one scoped to a URI scheme.
 *
 * `write` is a file write: it is what a role must have for a client to save the
 * file it has open, which is the behaviour `host/04` restored and this must not
 * take away. `write:computer` is a write to the `computer:` scheme, and holding
 * the plain one does not confer it. A plugin invents a scheme, so a role names
 * it explicitly; there is no list of them to enumerate and no wildcard.
 */
export type Grant = Capability | `${'read' | 'write'}:${string}`;

/** Somebody the host has checked, for as long as their connection lasts. */
export interface Principal {
  /** The id on their record. */
  readonly id: string;
  /** The roles the record gave them, as written. */
  readonly roles: readonly string[];
  /**
   * Whether they may do that.
   *
   * A question rather than the set it is answered from: the gate asks what it
   * needs and never reads a role list to decide for itself, so a change to how
   * roles resolve is a change here and not in the gate.
   */
  can(grant: Grant): boolean;
}

/**
 * One person, as the directory holds them.
 *
 * `token` is the hash and never the secret. A record may exist with no token at
 * all - `add` makes one and `mint` is what gives it a credential - and such a
 * record can never verify anything.
 */
export interface UserRecord {
  id: string;
  roles: string[];
  /** `sha256:<hex>`, so the algorithm is on the record and a second can be added. */
  token: string;
}

/** What the file holds: the roles this install defines, and the people. */
export interface UserFile {
  /** A role's grants, overriding a built-in of the same name. */
  roles?: Record<string, Grant[]>;
  users?: UserRecord[];
}

/**
 * The directory, as the host reaches it.
 *
 * A port so the enforcement layer never learns where a principal came from:
 * `fileUsers()` is the one that ships, and the identity provider an `ahp-server`
 * master wants is another implementation of the same four calls.
 */
export interface Users {
  /**
   * The RFC 9728 record this directory is reached through.
   *
   * The host advertises it on every agent and a client signs in against it. It
   * belongs to the port rather than to the host because `ahp-server` will front
   * many hosts and two of them must not share one id.
   */
  readonly resource: Record<string, unknown>;
  /** The person that token belongs to, or nothing when it belongs to nobody. */
  verify(token: string): Promise<Principal | undefined>;
  /** Everybody, without their credentials. */
  list(): Promise<Omit<UserRecord, 'token'>[]>;
  /** Add a person, or set the roles of one who is already there. */
  add(id: string, roles: string[]): Promise<void>;
  /** Remove a person. `true` when one was there. */
  remove(id: string): Promise<boolean>;
  /** A fresh secret for one person, answered once and stored only as its hash. */
  mint(id: string): Promise<string>;
}

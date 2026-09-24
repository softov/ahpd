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
 * What a grant does to its subject.
 *
 * Two, and they are the convention every scope list uses: `contents:read` in
 * GitHub's app permissions, `channels:read` in Slack's, `s3:GetObject` in IAM.
 * A verb-first spelling exists in GitHub's legacy OAuth scopes and beside
 * subject-first entries in the same list, so it is not a convention.
 */
export type Verb = 'read' | 'write';

/**
 * One thing a role may do, as `<subject>:<verb>`.
 *
 * The subject is one of the host's own five - `file`, `session`, `automation`,
 * `terminal`, `diagnostics` - or a plugin's URI scheme, which is what a
 * scheme-scoped grant was always for. `*` stands in either position: `*:read`
 * is every subject's read, `session:*` is every verb on sessions, and `*:*` is
 * everything.
 *
 * There is no bare token. `file:read` is what `read` used to be, and holding
 * `file:write` confers nothing on a plugin's scheme - a role reaches a scheme
 * by naming it or by naming a wildcard that names it - decision
 * `a-grant-is-a-subject-and-a-verb`.
 */
export type Grant = `${string}:${Verb | '*'}`;

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
  /**
   * Whether they are still somebody this host knows.
   *
   * The directory re-reads its file on every question, and this is the promise
   * kept past the moment of sign-in: a person who has been removed answers
   * false here and the next command is refused `-32007` rather than `-32009`,
   * because the honest answer is "sign in again" and not "your role does not
   * cover that". Absent means "assume yes", which is what a principal built by
   * hand in a test or by an embedder without a file answers.
   */
  standing?(): boolean;
  /**
   * Whether this person's connection token is their authorization as well.
   *
   * The door admits and says nobody; `authenticate` is what authorizes a
   * person - decision `the-door-is-a-door`. A record that sets `trustToken`,
   * or a host whose default is that, makes the token enough on its own, which
   * is what a client that cannot complete a sign-in needs. Absent is the
   * default and means no.
   */
  trusted?: boolean;
}

/**
 * One person, as the directory holds them.
 *
 * `token` is the hash and never the secret. A record may exist with no token at
 * all - `add` makes one and `mint` is what gives it a credential - and such a
 * record can never verify anything. With an issuer configured it is also the
 * record an issuer's subject is matched against, by `id`.
 */
export interface UserRecord {
  id: string;
  roles: string[];
  /** `sha256:<hex>`, so the algorithm is on the record and a second can be added. */
  token: string;
  /**
   * The authorization server this person signs in through, when it is not the
   * host's own.
   *
   * The same names the configuration takes: `github`, or an OpenID Connect
   * issuer URL. Absent, the host's default is used; a host with no default and
   * a record with no issuer is reached by a minted secret alone. The record's
   * own is what lets two people on one host sign in through two providers.
   */
  issuer?: string;
  /**
   * The claim the issuer's answer carries the person's roles in.
   *
   * A field of the answer, such as `groups` or `roles`, whose values are role
   * names this file defines or built-ins. The values are added to the record's
   * own `roles`, and a value that names nothing is reported and dropped. The
   * claim is read once, at sign-in, because the token that would ask again is
   * not kept - so a change at the issuer lands on the next sign-in and a change
   * in this file lands on the next command.
   *
   * A record reached by a minted secret has no issuer answer to read, so this
   * does nothing for one.
   */
  rolesFrom?: string;
  /** Whether a connection token of theirs authorizes them, over the host's default. */
  trustToken?: boolean;
}

/**
 * What an issuer answered for a token.
 *
 * `subject` is the one field the host matches against a record's `id` - a
 * GitHub login, an OpenID Connect `sub`. `claims` is the whole answer, because
 * a record that reads its roles out of a claim needs more than the subject and
 * asking twice would be a second request for one sign-in.
 */
export interface IssuerAnswer {
  /** Who the token belongs to, as the record's `id` spells them. */
  readonly subject: string;
  /** Everything the endpoint said, field by field, unread unless a record names one. */
  readonly claims: Record<string, unknown>;
}

/**
 * An authorization server this host accepts a credential from.
 *
 * Normally the host is its own issuer and compares a hash, which a client that
 * only acquires tokens through an OAuth provider cannot use: there is no
 * provider to resolve for a secret this host minted. This is that other
 * authorization server, as the host reaches it - an identifier a client
 * matches a provider through, the scopes to ask for, and one question.
 */
export interface Issuer {
  /** The RFC 8414 issuer identifier, which is what `authorization_servers` holds. */
  readonly id: string;
  /** The scopes a client should ask it for. */
  readonly scopes: readonly string[];
  /**
   * Who a token belongs to, and what else the issuer said about them, or
   * nothing when the token belongs to nobody.
   *
   * Nothing is the answer for a token the issuer refuses, and for one this
   * host could not ask about at all, which is the fail-closed reading of a
   * network it cannot reach.
   */
  who(token: string): Promise<IssuerAnswer | undefined>;
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
  /**
   * Everybody, without their credentials, and what their roles resolve to.
   *
   * The resolved grants are here because only the directory knows both halves -
   * the file's own roles and the built-ins - so a caller that wants to say what
   * a person may do would otherwise have to repeat the resolution.
   */
  list(): Promise<(Omit<UserRecord, 'token'> & { grants: Grant[]; trusted: boolean })[]>;
  /** Add a person, or set the roles of one who is already there. */
  add(id: string, roles: string[], options?: { issuer?: string }): Promise<void>;
  /** Remove a person. `true` when one was there. */
  remove(id: string): Promise<boolean>;
  /** A fresh secret for one person, answered once and stored only as its hash. */
  mint(id: string): Promise<string>;
}

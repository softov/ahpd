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

import type { PolicyLimit } from './policies.js';

/**
 * The two names that group a subject's operations rather than being one.
 *
 * `read` and `write` are never an operation on any subject: they name the
 * halves of one, so `user:read` is every read a role may do of people and
 * `user:get` is one record. A grant
 * names one of these, a group of them, or an operation of its own.
 */
export type Verb = 'read' | 'write';

/**
 * One thing a role may do, as `<subject>:<operation>`.
 *
 * The subject is one of the host's own - `session`, `chat`, `file`,
 * `automation`, `terminal`, `diagnostics`, `container`, `config` - a people
 * scheme, or a plugin's URI scheme, which is what a scheme-scoped grant was
 * always for. The operation is one the subject has (`session:dispose`), one of
 * the two groups (`file:write`), or `*`.
 *
 * `*` stands in either position: `*:read` is every subject's read, `session:*`
 * is every operation on sessions, and `*:*` is everything. Holding `file:write`
 * confers nothing on a plugin's scheme - a role reaches a scheme by naming it
 * or by naming a wildcard that names it.
 */
export type Grant = `${string}:${string}`;

/** Somebody the host has checked, for as long as their connection lasts. */
export interface Principal {
  /** The id on their record. */
  readonly id: string;
  /** The roles the record gave them, as written, and the roles their sign-in added. */
  readonly roles: readonly string[];
  /**
   * The team this principal is, when it is a team key's.
   *
   * A team key's principal stands for the team and for no person: its id is
   * `team:<team>`, and it holds only `proxy:call` and `proxy:models`. `can`
   * answers for the team, so a role the team was never given confers nothing.
   * Absent for a person, a plugin and the root connection.
   */
  readonly team?: string;
  /**
   * The roles their sign-in added, which `roles` holds too.
   *
   * Read from the claim the record's `rolesFrom` names, once, at sign-in.
   * Absent when the sign-in added none, which is every minted secret.
   */
  readonly rolesFromSignIn?: readonly string[];
  /**
   * The id of the minted token they signed in with, when it was one.
   *
   * Absent for the person's full secret, a token an issuer answered for, and
   * a principal built by hand. A principal carrying it is a token, not the
   * person, so it cannot mint, list or revoke tokens of its own.
   */
  readonly token?: string;
  /**
   * The scope of the key they signed in with, when the key carries one.
   *
   * Read from the token record at each question, as `can` reads its grants, so
   * a scope written on the record is in force without a new connection. Absent
   * for the person's full secret, an issuer's token and a principal built by
   * hand, and for a key minted without one.
   */
  readonly keyScope?: string | undefined;
  /**
   * What the key they signed in with says about itself, when it says anything.
   *
   * Read from the token record at each call, as `keyScope` is: a record that
   * was revoked, or that names no `meta`, answers nothing here. A call made
   * with the key writes these on its record and adds the entries of its own
   * `X-AHP-Meta` header to them.
   */
  readonly keyMeta?: Record<string, string> | undefined;
  /**
   * The limits of the key they signed in with, when it has any.
   *
   * Read from the token record on every question, as `can` reads the key's
   * grants: a revoked or expired key answers none. Absent for the person's full
   * secret, a token an issuer answered for, and a principal built by hand.
   */
  readonly keyLimits?: readonly PolicyLimit[] | undefined;
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
   * The plugin this principal is, when it is one.
   *
   * Set only on the principal a plugin's own connection is served as, and
   * never by sign-in, so it and not the id makes the work `plugin:<name>`: a
   * user id may be any string, `plugin:bot` among them.
   */
  readonly plugin?: string;
  /**
   * What a plugin's configuration entry grants it, as `can` holds it to.
   *
   * Set only beside `plugin`, so `x-ahpd/me` can list them. A person's grants
   * come from their roles instead.
   */
  readonly grants?: readonly Grant[];
  /**
   * Whether a local token of theirs signs them in at the door.
   *
   * A record's own token or one they minted names the person on the connection
   * unless the record, or the host, requires the issuer - decision
   * `a-persons-token-names-them-unless-the-issuer-is-required`. A token from
   * their issuer always does. False is what such a local token answers: the
   * socket opens and names nobody, and `authenticate` refuses the token.
   */
  trusted?: boolean;
  /**
   * When what they signed in with stops being good, in epoch milliseconds,
   * when anything said.
   *
   * The token's own `exp`, and only for a token this host checked itself: an
   * issuer asked over `userinfo` answers who somebody is and not until when, so
   * a sign-in through one ends with the connection and nothing else. Absent is
   * the whole of what a principal built by hand in a test carries.
   */
  readonly expiresAt?: number;
  /**
   * The teams and projects their work may be charged to, as written.
   *
   * A question about what they may do is `can`; this is about who pays, and it
   * grants nothing.
   */
  readonly memberships?: readonly string[];
  /**
   * The membership work that names no scope of its own is charged to.
   */
  readonly primary?: string | undefined;
  /**
   * The projects this install names, as the file holds them.
   *
   * What a `team:*` membership is a choice among: the membership says any
   * project of that team is theirs, and this is which projects there are. A
   * refusal says what may be named and a picker says what may be picked, and
   * neither can say it from the memberships alone.
   */
  readonly projects?: readonly Named[];
  /**
   * The teams this install names. Empty or absent, work is charged to nothing,
   * as on a host with no directory.
   */
  readonly teams?: readonly Named[];
}

/**
 * Who a connection is, as `x-ahpd/me` answers it.
 *
 * A person, a plugin's own connection, or the root connection. Root holds every
 * grant, which is `*:*` here and not the list of every grant.
 */
export interface Me {
  /** Whose work this connection's work is: `user:<id>`, `plugin:<name>` or `root:<host>`. */
  principal: string;
  /** Which of the three the connection is. */
  kind: 'user' | 'plugin' | 'root';
  /** The id on their record. Absent for root, which has none. */
  id?: string;
  /** The record's roles and the roles their sign-in added. Empty for root and a plugin. */
  roles: string[];
  /** The roles their sign-in added alone, which `roles` holds too. */
  rolesFromSignIn: string[];
  /** What the connection may do now, narrowed to a minted token's own grants. */
  grants: Grant[];
  /** The id of the minted token the connection signed in with, when it was one. */
  token?: string;
  /** The usage pools their work is charged to. */
  pools: string[];
  /** The teams and projects their work may be charged to, as written. Absent for root and a plugin. */
  memberships?: string[];
  /** The membership work that names no scope of its own is charged to. */
  primary?: string;
  /** The issuer the record names, as written, when it names one. */
  issuer?: string;
  /** The claim the record reads roles from, as written, when it names one. */
  rolesFrom?: string;
}

/**
 * A team or a project the file names.
 *
 * An id and, optionally, what a client shows for it. A project is a name and
 * not a folder: it may span several repositories or none, which is why this is
 * an entry in the users file rather than a path anywhere.
 */
export interface Named {
  id: string;
  title?: string;
}

/**
 * How a token from one issuer is checked.
 *
 * `userinfo` is what this host has always done: the token is carried to the
 * issuer's endpoint and the endpoint says who it belongs to, which is the only
 * way GitHub's opaque tokens can be read at all. `jwt` checks the token here,
 * against the key set the issuer publishes, so a sign-in makes no request of
 * its own once that set has been read and the token's own `exp` is what ends
 * it. `auto` checks here first and falls back to the endpoint, for an issuer
 * whose tokens are of both kinds.
 */
export type IssuerVerify = 'userinfo' | 'jwt' | 'auto';

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
  /**
   * How this record's own issuer is checked, when it is not the host's way.
   *
   * Read only when the record names an `issuer` of its own: a record that signs
   * in through the host's default is checked the way the host says. Absent, the
   * host's setting applies here too.
   */
  issuerVerify?: IssuerVerify;
  /**
   * Whether only a token from their issuer signs them in, over the host's
   * default.
   *
   * True, their own token and the ones they minted only open the socket, and
   * `authenticate` accepts the issuer's alone. Absent, the host's answer
   * applies.
   */
  requireIssuer?: boolean;
  /**
   * The teams and projects their work may be charged to.
   *
   * Each is written `team`, `team:*` or `team:project`. A membership grants
   * nothing and says no permission: it says what a piece of work may be
   * charged to, which is a question roles are never asked.
   */
  memberships?: string[];
  /**
   * The membership work that names no team and project of its own is charged
   * to, and one a person sets for themselves.
   *
   * `team` or `team:project`, never `*`, and one of their memberships.
   */
  primary?: string;
}

/**
 * A token a person minted for themselves, as the directory keeps it.
 *
 * The record holds the hash and never the secret: the secret is answered once,
 * by the mint that made it, and there is nothing here to read it back from. A
 * token's grant is never more than its person's: `can` asks the person's roles
 * again at every check, so a role taken away takes the token's reach with it.
 */
export interface TokenRecord {
  /** The id `revokeToken` takes, and what a principal signed in this way carries. */
  id: string;
  /**
   * The id of the person the token was minted for, when it was minted for one.
   *
   * A record holds exactly one of `user` and `team`: a person's key names the
   * person, and a team's key names the team.
   */
  user?: string;
  /**
   * The id of the team the token was minted for, when it was minted for one.
   *
   * A team key is for the proxy and opens no other door: `verify` answers
   * nothing for it, and `verifyTeamKey` answers the team.
   */
  team?: string;
  /** What the person called it, when they said. */
  label?: string;
  /**
   * The grants this token is limited to, each one its person held at the mint.
   *
   * Absent means every grant of its person, read at each check rather than
   * copied at the mint: a token minted for everything is one a role change
   * reaches, and one minted for a list never grows past that list.
   */
  grants?: Grant[];
  /**
   * The team and project a call made with this token is charged to, written
   * `team` or `team:project`.
   *
   * Absent, the scope is whichever the person's own memberships resolve to at
   * the call, as it was before a key could carry one. With it, the token is a
   * lock: a call may name that scope and no other, and one that names none is
   * charged to it rather than to the person's primary.
   */
  scope?: string;
  /**
   * The spend and call limits of this token, when it has any.
   *
   * A proxy call made with the token is refused when one of them has no room,
   * and only narrows: a key that carries limits never allows a model no policy
   * allows and never stops the charge to a team. The measures are a `model`
   * row's - `usd`, `tokens` and `calls` - and the pool is always `shared`,
   * because one key has one total. Absent means no limit of its own.
   */
  limits?: PolicyLimit[];
  /**
   * What the key says about itself, such as `env=prod` or `client=pi`.
   *
   * A call made with the key writes these on its record, and adds the entries
   * of its own `X-AHP-Meta` header to them: a name the key holds is not changed
   * by the call. Every name is 1 to 64 characters of `[A-Za-z0-9_.-]`, every
   * value is at most 256 characters with no comma and no line break, and one
   * key names at most 32 entries.
   */
  meta?: Record<string, string>;
  /** When it was minted, in epoch milliseconds. */
  created: number;
  /** When it stops working, in epoch milliseconds, when it does. */
  expires?: number;
  /** `sha256:<hex>`, so the stored form says which hash it is. */
  token: string;
}

/** A token as the mint answers it: the record without its hash, and the secret. */
export interface MintedToken extends Omit<TokenRecord, 'token'> {
  /** The secret, answered once. The directory keeps only its hash. */
  secret: string;
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
  /**
   * When the token stops being good, in epoch milliseconds, when it says.
   *
   * The token's own `exp`, which an issuer that checks a token here is the only
   * one that can answer: an endpoint asked about a token knows nothing beyond
   * the answer it gives, and says nothing here.
   */
  readonly expiresAt?: number;
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
  /**
   * Who a token belongs to, checked here against this issuer's own keys.
   *
   * Absent for an issuer whose tokens cannot be checked here at all, which is
   * one with no key set to check them against: GitHub's are opaque, and there
   * is nothing to fetch. An issuer that has one is checked with the token
   * itself and no request, so a sign-in still works while the issuer is down.
   *
   * `audience` is the identifier the token has to have been issued for, which
   * is the resource the person is signing in against: the one claim that keeps
   * a token minted for another audience from being a credential here.
   */
  verify?(token: string, audience: string): Promise<IssuerAnswer | undefined>;
}

/** What the file holds: the roles this install defines, and the people. */
export interface UserFile {
  /** A role's grants, overriding a built-in of the same name. */
  roles?: Record<string, Grant[]>;
  /** The teams this install names, which a membership spells before its colon. */
  teams?: Named[];
  /** The projects this install names, which a membership spells after its colon. */
  projects?: Named[];
  users?: UserRecord[];
}

/**
 * A role this install defines, and the whole of what it confers.
 *
 * A name and the grants, with no title: nothing anywhere shows one, and a
 * record's `roles` holds names, so a role is only ever what its grants are.
 */
export interface Role {
  id: string;
  grants: Grant[];
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
   * The host names it in the `-32007` refusing a command before somebody signs
   * in, and a client signs in against it. It belongs to the port rather than to
   * the host because `ahp-server` will front many hosts and two of them must
   * not share one id.
   */
  readonly resource: Record<string, unknown>;
  /**
   * The person that token belongs to, or nothing when it belongs to nobody.
   *
   * A team key answers nothing here, because it belongs to no person. Only the
   * proxy asks `verifyTeamKey` for one, so every other door refuses it.
   */
  verify(token: string): Promise<Principal | undefined>;
  /**
   * The team a team key belongs to, or nothing when the token is no team key.
   *
   * The proxy's own check, asked only after `verify` answers nothing. Optional
   * because a directory that is not a file may keep no team keys.
   */
  verifyTeamKey?(token: string): Promise<Principal | undefined>;
  /**
   * Everybody, without their credentials, and what their roles resolve to.
   *
   * The resolved grants are here because only the directory knows both halves -
   * the file's own roles and the built-ins - so a caller that wants to say what
   * a person may do would otherwise have to repeat the resolution. `trusted` is
   * whether a local token signs the person in, which is false where the issuer
   * is required.
   */
  list(): Promise<(Omit<UserRecord, 'token'> & { grants: Grant[]; trusted: boolean })[]>;
  /**
   * What a set of role names resolves to, from the file's roles and the built-ins.
   *
   * A caller that gives a role or writes for a person has to know what the
   * target holds before it writes, and only the directory knows both halves of
   * that resolution.
   */
  grantsOfRoles(roles: readonly string[]): Promise<Grant[]>;
  /** What a person's roles resolve to, or nothing when nobody has that id. */
  grantsOfPerson(id: string): Promise<Grant[] | undefined>;
  /**
   * Add a person, or set the roles of one who is already there.
   *
   * `memberships` replaces what they hold and `primary` sets where their work is
   * charged to, `null` taking the primary away. `null` takes an `issuer` and a
   * `rolesFrom` away the same way. Each is left alone when the options name none,
   * so setting a role does not quietly move somebody off their team. Only what
   * the options name is checked.
   */
  add(
    id: string,
    roles: string[],
    options?: {
      issuer?: string | null;
      rolesFrom?: string | null;
      memberships?: string[];
      primary?: string | null;
    },
  ): Promise<void>;
  /**
   * The roles this file defines, and the grants each holds.
   *
   * The file's own and not the built-ins beside them: what is editable is what
   * is written down, and a role the file overrides is answered with the grants
   * that override says.
   */
  roles(): Promise<Role[]>;
  /**
   * Name a role, or set the grants of one already named.
   *
   * A role in the file overrides a built-in of the same name, which is the
   * whole of what naming one that is already there does.
   */
  addRole(id: string, grants: readonly Grant[]): Promise<void>;
  /**
   * Take a role out. `true` when one was there.
   *
   * Throws while a record still names it, saying who: a record naming a role
   * nothing defines holds nothing and looks like a permission on the read.
   */
  removeRole(id: string): Promise<boolean>;
  /** The teams this directory names, in the order the file lists them. */
  teams(): Promise<Named[]>;
  /** The projects this directory names, in the order the file lists them. */
  projects(): Promise<Named[]>;
  /** Name a team, or set the title of one that is already named. */
  addTeam(id: string, title?: string): Promise<void>;
  /** Name a project, or set the title of one that is already named. */
  addProject(id: string, title?: string): Promise<void>;
  /**
   * Take a team out. `true` when one was there.
   *
   * Throws while a membership still names it, saying who does: an entry the
   * memberships beside it no longer match is one everybody holding it is
   * silently dropped from on every read.
   */
  removeTeam(id: string): Promise<boolean>;
  /** Take a project out, refused the same way while a membership names it. */
  removeProject(id: string): Promise<boolean>;
  /** Remove a person. `true` when one was there. */
  remove(id: string): Promise<boolean>;
  /** A fresh secret for one person, answered once and stored only as its hash. */
  mint(id: string): Promise<string>;
  /**
   * A token of their own, limited to what they hold.
   *
   * The secret is answered once and only its hash is stored. Every grant named
   * is checked against the person's grants now, so a token can never be minted
   * holding more than its person does; `expires` is epoch milliseconds and has
   * to be in the future. `scope` is a team or a team and project the person is
   * in now, and the token's calls are charged to it rather than to their
   * primary. `meta` is what the key says about itself, and each call made with
   * it adds its own entries to those. Optional, like `watch`, because a
   * directory that is not a file may keep no tokens.
   *
   * A team key names `team` and no `user`. It holds only `proxy:call` and
   * `proxy:models`, its scope is its team or a project of it, and its calls are
   * charged to its team. A team may hold as many keys as a person may.
   */
  mintToken?(
    user: string | undefined,
    options?: {
      team?: string;
      label?: string;
      grants?: readonly Grant[];
      expires?: number;
      scope?: string;
      limits?: readonly PolicyLimit[];
      meta?: Record<string, string>;
    },
  ): Promise<MintedToken>;
  /**
   * The tokens of one person, or of everybody, without their hashes.
   *
   * Ordered by `created`, so a listing reads the way the tokens were made.
   */
  tokens?(user?: string): Promise<Omit<TokenRecord, 'token'>[]>;
  /** Take a token out. `true` when one was there. */
  revokeToken?(id: string): Promise<boolean>;
  /**
   * Call `onChange` each time the directory changes: a person edits the file,
   * or this directory writes it.
   *
   * Optional, because a directory that is not a file may have no way to know.
   * Several changes close together are one call. `close` stops the calls.
   */
  watch?(onChange: () => void): { close(): void };
}

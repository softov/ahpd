#!/usr/bin/env node
/**
 * A throwaway OpenID Connect issuer, for trying the `issuer` option.
 *
 * It answers the two things this host asks for - a discovery document naming a
 * userinfo endpoint, and that endpoint - and nothing else. The bearer token is
 * the subject, so `Bearer ana` answers `sub: ana`, which is what makes it
 * useful with no identity provider behind it.
 *
 * Nothing is verified: any token is somebody. That is the point of a test
 * double and the reason it is not a package. Run it on loopback and name it:
 *
 *   node scripts/dev-issuer.mjs 9310
 *   ahpd --issuer http://127.0.0.1:9310 --users ~/.config/ahpd/users.json
 *
 * Then a record whose id is `ana` signs in with the token `ana`:
 *
 *   ws://127.0.0.1:9187  ->  authenticate({ resource, token: 'ana' })
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 9310);
const issuer = `http://127.0.0.1:${port}`;

const answer = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(`${JSON.stringify(body)}\n`);
};

const server = createServer((request, response) => {
  const path = (request.url ?? '').split('?')[0];
  if (path === '/.well-known/openid-configuration') {
    answer(response, 200, {
      issuer,
      userinfo_endpoint: `${issuer}/userinfo`,
      scopes_supported: ['openid'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['none'],
    });
    return;
  }
  if (path === '/userinfo') {
    const held = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1]?.trim();
    if (held === undefined || held === '') {
      answer(response, 401, { error: 'invalid_token' });
      return;
    }
    answer(response, 200, { sub: held });
    return;
  }
  answer(response, 404, { error: 'not_found' });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `dev issuer on ${issuer}\n`
    + `  discovery ${issuer}/.well-known/openid-configuration\n`
    + `  userinfo  ${issuer}/userinfo   (Authorization: Bearer <subject> answers sub: <subject>)\n`
    + `  ahpd --issuer ${issuer} --users <file>\n`,
  );
});

// Authentication: resolves the signed-in user for every request.
//
//   alb     — sign-in goes through the ALB's authenticate-cognito action. The
//             ALB forwards the user's Cognito access token
//             (`x-amzn-oidc-accesstoken`), which we verify: signature against
//             the bundled pool keys (auth/jwks.ts — the instances have no
//             internet), issuer, client id, token use and expiry. The ALB's
//             own claims JWT (`x-amzn-oidc-data`) cannot be signature-checked
//             offline, so it is used only for email and name, and only when its
//             `sub` equals the verified token's `sub`.
//   cognito — API clients send `Authorization: Bearer <Cognito token>`,
//             verified the same way.
//   dev     — `x-dev-user: <email>` for local development (users table only).
// Fails closed: no token, an invalid token or an unknown signing key is a 401.
//
// Users are matched by Cognito `sub`. A first sign-in creates (or claims, by
// email) the user row; a row already bound to a different `sub` is refused.
// The users table is authoritative for the role: Cognito groups set it only
// when the user is created.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { decodeJwt } from 'jose';
import type { Config } from '../config.js';
import { unauthorized } from '../lib/errors.js';
import { BundledJwksCache, loadBundledJwks } from './jwks.js';
import { GROUP_ROLE, ROLE_LABEL, type AuthUser, type Role } from './rbac.js';

interface Claims { sub?: string; email?: string; name?: string; 'cognito:groups'?: string[] }

const USER_COLS = 'id, email, name, role, role_label, active';

export function buildAuth(cfg: Config, pool: pg.Pool, log: { warn: (obj: object, msg: string) => void }) {
  const verifiers = cfg.AUTH_MODE === 'dev' ? null : createVerifiers(cfg, log);

  async function claimsFromAlb(req: FastifyRequest): Promise<Claims> {
    const access = req.headers['x-amzn-oidc-accesstoken'];
    if (typeof access !== 'string') throw unauthorized();
    let verified: Claims;
    try {
      verified = (await verifiers!.access.verify(access)) as unknown as Claims;
    } catch {
      throw unauthorized('Invalid or expired session');
    }
    let profile: Claims = {};
    const data = req.headers['x-amzn-oidc-data'];
    if (typeof data === 'string') {
      try {
        const p = decodeJwt(data) as Claims;
        if (p.sub && p.sub === verified.sub) profile = p;
      } catch { /* no profile claims */ }
    }
    return { sub: verified.sub, email: profile.email, name: profile.name, 'cognito:groups': verified['cognito:groups'] };
  }

  async function claimsFromBearer(req: FastifyRequest): Promise<Claims> {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw unauthorized();
    try {
      return (await verifiers!.any.verify(h.slice(7))) as unknown as Claims;
    } catch {
      throw unauthorized('Invalid or expired token');
    }
  }

  async function resolve(req: FastifyRequest): Promise<AuthUser> {
    if (cfg.AUTH_MODE === 'dev') {
      const email = req.headers['x-dev-user'];
      if (typeof email !== 'string') throw unauthorized('Set the x-dev-user header (AUTH_MODE=dev)');
      const r = await pool.query('SELECT id, email, name, role, role_label FROM users WHERE email = $1 AND active', [email]);
      if (!r.rows[0]) throw unauthorized(`No user ${email}`);
      return toUser(r.rows[0]);
    }
    const claims = cfg.AUTH_MODE === 'alb' ? await claimsFromAlb(req) : await claimsFromBearer(req);
    const sub = claims.sub;
    if (!sub) throw unauthorized('Token has no subject');

    // returning user: matched by the verified Cognito subject
    const known = await pool.query(`UPDATE users SET last_login_at = now() WHERE cognito_sub = $1 RETURNING ${USER_COLS}`, [sub]);
    if (known.rows[0]) return activeUser(known.rows[0]);

    // first sign-in: create the row, or claim a pre-created row with this email
    // that is not yet bound to any Cognito user
    const email = claims.email;
    if (!email) throw unauthorized('First sign-in needs the email from the sign-in page');
    const groupRole = (claims['cognito:groups'] ?? []).map((g) => GROUP_ROLE[g]).find(Boolean) as Role | undefined;
    const role: Role = groupRole ?? 'presales';
    const r = await pool.query(
      `INSERT INTO users (cognito_sub, email, name, role, role_label, last_login_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (email) DO UPDATE
         SET cognito_sub = EXCLUDED.cognito_sub,
             name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
             last_login_at = now()
         WHERE users.cognito_sub IS NULL
       RETURNING ${USER_COLS}`,
      [sub, email, claims.name ?? email.split('@')[0], role, ROLE_LABEL[role]],
    );
    // no row back: the email is already bound to a different Cognito user
    if (!r.rows[0]) throw unauthorized('This account is linked to a different sign-in');
    return activeUser(r.rows[0]);
  }

  return { resolve };
}

function createVerifiers(cfg: Config, log: { warn: (obj: object, msg: string) => void }) {
  if (!cfg.COGNITO_USER_POOL_ID || !cfg.COGNITO_CLIENT_ID || !cfg.COGNITO_JWKS_PATH) {
    throw new Error(`AUTH_MODE=${cfg.AUTH_MODE} requires COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID and COGNITO_JWKS_PATH`);
  }
  const jwks = loadBundledJwks(cfg.COGNITO_JWKS_PATH);
  const cache = new BundledJwksCache((kid) => log.warn({ event: 'cognito_unknown_signing_key', kid }, 'cognito_unknown_signing_key: token signed with a key not in the bundled JWKS - redeploy to refresh certs/cognito-jwks.json'));
  const base = { userPoolId: cfg.COGNITO_USER_POOL_ID, clientId: cfg.COGNITO_CLIENT_ID };
  const access = CognitoJwtVerifier.create({ ...base, tokenUse: 'access' }, { jwksCache: cache });
  const any = CognitoJwtVerifier.create({ ...base, tokenUse: null }, { jwksCache: cache });
  access.cacheJwks(jwks);
  any.cacheJwks(jwks);
  return { access, any };
}

function activeUser(row: { id: string; email: string; name: string; role: Role; role_label: string; active: boolean }): AuthUser {
  if (!row.active) throw unauthorized('Account disabled');
  return toUser(row);
}

function toUser(row: { id: string; email: string; name: string; role: Role; role_label: string }): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, roleLabel: row.role_label };
}

/** Registers the auth hook on every route under /api (health and docs stay open). */
export function registerAuth(app: FastifyInstance, auth: ReturnType<typeof buildAuth>) {
  app.decorateRequest('user', null as unknown as AuthUser);
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = await auth.resolve(req);
  });
}

// CI build step: download the Cognito user pool's public signing keys into the
// release, because the app instances have no internet access (auth/jwks.ts).
//
//   COGNITO_USER_POOL_ID=ap-southeast-1_xxx npm --prefix api run fetch:jwks
//
// Writes certs/cognito-jwks.json (relative to api/, or JWKS_OUT). These are
// public keys, not secrets. Fails the build if the download or the content is
// wrong, so a release never ships without keys.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertIsJwks } from 'aws-jwt-verify/jwk';

async function main() {
  const poolId = process.env.COGNITO_USER_POOL_ID;
  if (!poolId) throw new Error('Set COGNITO_USER_POOL_ID');
  const region = poolId.split('_')[0];
  const url = `https://cognito-idp.${region}.amazonaws.com/${poolId}/.well-known/jwks.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const jwks: unknown = await res.json();
  assertIsJwks(jwks as Parameters<typeof assertIsJwks>[0]);
  const keys = (jwks as { keys: { kid?: string }[] }).keys;
  if (!keys.length) throw new Error('JWKS has no keys');
  const out = resolve(process.env.JWKS_OUT ?? 'certs/cognito-jwks.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(jwks, null, 2) + '\n');
  console.log(`wrote ${keys.length} key(s) (${keys.map((k) => k.kid).join(', ')}) to ${out}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

// Cognito signing keys, bundled with each release instead of fetched.
//
// The app subnets have no internet access and Cognito user pools that have a
// domain (needed by the ALB sign-in) cannot be reached over PrivateLink, so the
// API cannot download the pool's JWKS at runtime. CI fetches it at build time
// (`npm --prefix api run fetch:jwks`) into certs/cognito-jwks.json and the API
// verifies tokens against that file only. A token signed with a key that is
// not in the file fails closed (401) and logs `cognito_unknown_signing_key`,
// which raises a CloudWatch alarm: redeploy to pick up rotated keys
// (docs/runbooks/cognito-keys.md).
import { readFileSync } from 'node:fs';
import { KidNotFoundInJwksError } from 'aws-jwt-verify/error';
import { assertIsJwks, type Jwks, type JwksCache, type JwkWithKid } from 'aws-jwt-verify/jwk';
import type { DecomposedJwt } from 'aws-jwt-verify/jwt';

export function loadBundledJwks(path: string): Jwks {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assertIsJwks(parsed as Parameters<typeof assertIsJwks>[0]);
  const jwks = parsed as Jwks;
  if (!jwks.keys.length) throw new Error(`${path} holds no signing keys`);
  return jwks;
}

/** A JWKS cache that only ever serves the bundled keys: it never fetches. */
export class BundledJwksCache implements JwksCache {
  private readonly byUri = new Map<string, Jwks>();

  constructor(private readonly onUnknownKid: (kid: string) => void) {}

  addJwks(jwksUri: string, jwks: Jwks): void {
    this.byUri.set(jwksUri, jwks);
  }

  async getJwks(jwksUri: string): Promise<Jwks> {
    const jwks = this.byUri.get(jwksUri);
    if (!jwks) throw new KidNotFoundInJwksError(`No bundled signing keys for ${jwksUri}`);
    return jwks;
  }

  getCachedJwk(jwksUri: string, decomposedJwt: DecomposedJwt): JwkWithKid {
    const kid = decomposedJwt.header.kid;
    const jwk = kid ? this.byUri.get(jwksUri)?.keys.find((k) => k.kid === kid) : undefined;
    if (!jwk || !kid) {
      this.onUnknownKid(String(kid ?? ''));
      throw new KidNotFoundInJwksError('Token signed with a key that is not bundled');
    }
    return jwk as JwkWithKid;
  }

  async getJwk(jwksUri: string, decomposedJwt: DecomposedJwt): Promise<JwkWithKid> {
    return this.getCachedJwk(jwksUri, decomposedJwt);
  }
}

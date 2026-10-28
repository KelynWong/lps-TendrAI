// Reads DB role credentials from Secrets Manager (over the secretsmanager
// PrivateLink endpoint). The secret is {"username","password"}; see
// infra/modules/tendrai/secrets.tf db_role. Values are never logged.
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export interface DbCredentials { username: string; password: string }

export async function readDbCredentials(region: string, secretArn: string): Promise<DbCredentials> {
  const sm = new SecretsManagerClient({ region });
  const r = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  let parsed: Partial<DbCredentials>;
  try {
    parsed = JSON.parse(r.SecretString ?? '') as Partial<DbCredentials>;
  } catch {
    throw new Error('DB secret is not JSON');
  }
  if (!parsed.username || !parsed.password) throw new Error('DB secret has no username or password');
  return { username: parsed.username, password: parsed.password };
}

// Bootstrap the least-privilege DB roles: apply db/roles.sql as the master
// user, then set each role's password from its Secrets Manager secret.
//
//   npm --prefix api run db:roles
//
// Runs on an operator's machine with the operator's AWS credentials, through
// an SSM port-forward to RDS (docs/runbooks/db-roles.md) — the master secret
// is never readable by the app tier. Re-run after every schema change (grants
// on new tables) and after bumping db_role_password_version (rotation).
//
// Env:
//   DB_HOST, DB_PORT, DB_NAME            the tunnel end, e.g. localhost / 15432 / tendrai
//   DB_MASTER_SECRET_ARN                 RDS-managed master secret (db_master_secret_arn output)
//   DB_APP_SECRET_ARN, DB_STATUS_UPDATER_SECRET_ARN, DB_RESULT_LOADER_SECRET_ARN
//                                        role secrets (db_role_secret_arns output)
//   DB_SSL_CA_PATH, DB_TLS_SERVERNAME    optional: verify the RDS certificate through the tunnel
//   DATABASE_URL                         local dev instead of the master secret; passwords are skipped
//                                        when the role secret ARNs are not set
// Passwords are never printed.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readDbCredentials } from '../lib/secrets.js';

const ROLE_SECRETS: Record<string, string> = {
  tendrai_app: 'DB_APP_SECRET_ARN',
  tendrai_status_updater: 'DB_STATUS_UPDATER_SECRET_ARN',
  tendrai_result_loader: 'DB_RESULT_LOADER_SECRET_ARN',
};

async function main() {
  const env = process.env;
  const region = env.AWS_REGION ?? 'ap-southeast-1';
  const rolesSql = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/roles.sql'), 'utf8');

  let client: pg.Client;
  if (env.DB_MASTER_SECRET_ARN) {
    if (!env.DB_HOST || !env.DB_NAME) throw new Error('Set DB_HOST and DB_NAME (the SSM tunnel end)');
    const master = await readDbCredentials(region, env.DB_MASTER_SECRET_ARN);
    const ssl = env.DB_SSL_CA_PATH
      ? { ca: readFileSync(env.DB_SSL_CA_PATH, 'utf8'), servername: env.DB_TLS_SERVERNAME, rejectUnauthorized: true }
      : { rejectUnauthorized: false }; // the SSM tunnel is encrypted end to end; RDS still requires TLS
    client = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT ?? 5432), database: env.DB_NAME, user: master.username, password: master.password, ssl, application_name: 'tendrai-db-roles' });
  } else if (env.DATABASE_URL) {
    client = new pg.Client({ connectionString: env.DATABASE_URL, application_name: 'tendrai-db-roles' });
  } else {
    throw new Error('Set DB_MASTER_SECRET_ARN (+ DB_HOST, DB_NAME) or DATABASE_URL');
  }

  await client.connect();
  try {
    await client.query(rolesSql);
    console.log('db/roles.sql applied');
    for (const [role, varName] of Object.entries(ROLE_SECRETS)) {
      const arn = env[varName];
      if (!arn) {
        console.log(`${role}: ${varName} not set, password left unchanged`);
        continue;
      }
      const creds = await readDbCredentials(region, arn);
      if (creds.username !== role) throw new Error(`${varName} holds credentials for ${creds.username}, expected ${role}`);
      await client.query(`ALTER ROLE ${client.escapeIdentifier(role)} WITH PASSWORD ${client.escapeLiteral(creds.password)}`);
      console.log(`${role}: password set from its secret`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

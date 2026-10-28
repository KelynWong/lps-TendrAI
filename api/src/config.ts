// Environment configuration, validated once at start-up.
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default('info'),
  AWS_REGION: z.string().default('ap-southeast-1'),

  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().optional(),
  DB_SECRET_ARN: z.string().optional(), // EC2: the tendrai_app role secret, read at start-up (lib/secrets.ts)
  DB_CREDENTIALS: z.string().optional(), // local only: JSON {"username","password"}
  DB_SSL_CA_PATH: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  DOCUMENTS_BUCKET: z.string(),
  JOB_QUEUE_URL: z.string().optional(),
  BACKUP_BUCKET: z.string().optional(),
  BACKUP_BUCKET_REGION: z.string().default('ap-southeast-2'),

  AUTH_MODE: z.enum(['alb', 'cognito', 'dev']).default('alb'),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  // Cognito signing keys bundled with the release by CI (auth/jwks.ts); never fetched at runtime
  COGNITO_JWKS_PATH: z.string().optional(),

  CORS_ORIGIN: z.string().optional(),
  PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  TRUST_PROXY: bool.default('true'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;

  let dbUser: string | undefined;
  let dbPassword: string | undefined;
  if (env.DB_CREDENTIALS) {
    try {
      const creds = JSON.parse(env.DB_CREDENTIALS) as { username?: string; password?: string };
      dbUser = creds.username;
      dbPassword = creds.password;
    } catch {
      throw new Error('DB_CREDENTIALS must be JSON with username and password');
    }
  }
  if (!env.DATABASE_URL && !(env.DB_HOST && env.DB_NAME && (env.DB_SECRET_ARN || (dbUser && dbPassword)))) {
    throw new Error('Set DATABASE_URL, or DB_HOST + DB_NAME + DB_SECRET_ARN (or DB_CREDENTIALS locally)');
  }
  if (env.AUTH_MODE !== 'dev' && !(env.COGNITO_USER_POOL_ID && env.COGNITO_CLIENT_ID && env.COGNITO_JWKS_PATH)) {
    throw new Error(`AUTH_MODE=${env.AUTH_MODE} requires COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID and COGNITO_JWKS_PATH`);
  }
  if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
    throw new Error('AUTH_MODE=dev is not allowed in production');
  }

  return {
    ...env,
    isProd: env.NODE_ENV === 'production',
    db: {
      connectionString: env.DATABASE_URL,
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      secretArn: env.DB_SECRET_ARN || undefined,
      user: dbUser,
      password: dbPassword,
      sslCaPath: env.DB_SSL_CA_PATH || undefined,
      max: env.DB_POOL_MAX,
    },
    corsOrigins: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean) : [],
  };
}

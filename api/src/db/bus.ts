// Cross-instance event bus on PostgreSQL LISTEN/NOTIFY.
//
// Every API task LISTENs on `tendrai_events`. Anything that must reach the
// WebSocket clients of a tender (clause saves, presence, job progress) is
// published through pg_notify so clients connected to a different ECS task
// receive it too. The workflow Lambdas use the same channel via
// notify_tender_event() when a processing job advances.
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Config } from '../config.js';

export const CHANNEL = 'tendrai_events';
/** pg_notify payload limit is 8000 bytes; keep a margin. */
const MAX_PAYLOAD = 7500;

export interface BusEvent {
  tenderId: string;
  type: string;
  [k: string]: unknown;
}

export class EventBus extends EventEmitter {
  private client: pg.Client | null = null;
  private stopped = false;

  constructor(private readonly cfg: Config, private readonly pool: pg.Pool, private readonly log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
    super();
    this.setMaxListeners(0);
  }

  async start() {
    this.stopped = false;
    await this.connect();
  }

  async stop() {
    this.stopped = true;
    await this.client?.end().catch(() => undefined);
    this.client = null;
  }

  private async connect() {
    const { connectionString, host, port, database, user, password } = this.cfg.db;
    const client = new pg.Client({ connectionString, host, port, database, user, password, ssl: this.sslOf(), application_name: 'tendrai-api-listener' });
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const ev = JSON.parse(msg.payload) as BusEvent;
        if (ev.tenderId && ev.type) this.emit('event', ev);
      } catch (e) {
        this.log.error({ err: e }, 'bad bus payload');
      }
    });
    client.on('error', (err) => {
      this.log.error({ err }, 'listener connection error; reconnecting');
      this.reconnect();
    });
    client.on('end', () => { if (!this.stopped) this.reconnect(); });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    this.client = client;
    this.log.info({ channel: CHANNEL }, 'listening for tender events');
  }

  private sslOf() {
    // Same policy as the pool: verify with the RDS bundle when provided.
    if (this.cfg.db.sslCaPath) return { rejectUnauthorized: true, ca: readFileSync(this.cfg.db.sslCaPath, 'utf8') };
    return this.cfg.isProd ? { rejectUnauthorized: false } : undefined;
  }

  private reconnecting = false;
  private reconnect() {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    this.client?.removeAllListeners();
    this.client = null;
    setTimeout(() => {
      this.reconnecting = false;
      this.connect().catch((err) => {
        this.log.error({ err }, 'listener reconnect failed');
        this.reconnect();
      });
    }, 2000);
  }

  /** Publish to every instance (including this one, via the notification). */
  async publish(ev: BusEvent): Promise<boolean> {
    const payload = JSON.stringify(ev);
    if (Buffer.byteLength(payload) > MAX_PAYLOAD) {
      // Too large for NOTIFY: deliver locally only; callers send ids instead of bodies for big events.
      this.emit('event', ev);
      return false;
    }
    await this.pool.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
    return true;
  }
}

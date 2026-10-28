// Live collaboration on a tender's clauses / compliance table.
//
//   ws://host/ws/tenders/:tenderId/clauses
//
// Protocol (JSON text frames)
//   client -> server
//     {type:'auth', token?}                      first frame (ALB cookie / dev header are also accepted)
//     {type:'focus', clauseId, field}            user is editing a cell (field: compliance|category|response)
//     {type:'blur', clauseId, field}
//     {type:'draft', clauseId, field, value}     unsaved value, so others see live typing
//     {type:'save', patches:[{clauseId, version, patch}]}
//     {type:'ping'}
//   server -> client
//     {type:'ready', you, presence:[...]}
//     {type:'presence', users:[{id,name,role,editing:[{clauseId,field}]}]}
//     {type:'draft', clauseId, field, value, by, byId}
//     {type:'clauses-updated', clauses:[Clause], by, byId}   after any save (REST or WS)
//     {type:'saved', clauses, conflicts}         ack to the saver
//     {type:'conflict', conflicts}               stale version(s) in a save
//     {type:'job', ...} {type:'documents-changed'} {type:'tender-updated'} ... other tender events
//     {type:'error', message}
//     {type:'pong'}
//
// Fan-out: every instance relays bus events (PostgreSQL NOTIFY) to the
// sockets it holds for that tender, so two browsers on different ECS tasks
// stay in sync. Presence is held in memory per instance and merged through
// the bus.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { AuthUser } from '../auth/rbac.js';
import type { buildAuth } from '../auth/index.js';
import type { AppContext } from '../context.js';
import type { BusEvent } from '../db/bus.js';
import { HttpError } from '../lib/errors.js';
import { ClausePatches, loadClauses, saveClausePatches } from '../routes/clauses.js';

const Field = z.enum(['compliance', 'category', 'response']);
const Incoming = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().optional() }),
  z.object({ type: z.literal('focus'), clauseId: z.string().uuid(), field: Field }),
  z.object({ type: z.literal('blur'), clauseId: z.string().uuid(), field: Field }),
  z.object({ type: z.literal('draft'), clauseId: z.string().uuid(), field: Field, value: z.string().max(20_000) }),
  z.object({ type: z.literal('save'), patches: ClausePatches }),
  z.object({ type: z.literal('ping') }),
]);

interface Member {
  socket: WebSocket;
  user: AuthUser;
  editing: Set<string>; // `${clauseId}:${field}`
  lastSeen: number;
}

interface Presence { id: string; name: string; role: string; editing: { clauseId: string; field: string }[] }

export class ClauseRooms {
  private rooms = new Map<string, Set<Member>>();
  /** presence reported by other instances: tenderId -> instanceId -> users */
  private remote = new Map<string, Map<string, { at: number; users: Presence[] }>>();
  private readonly instanceId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(private readonly ctx: AppContext, private readonly auth: ReturnType<typeof buildAuth>) {
    ctx.bus.on('event', (ev: BusEvent) => void this.onBusEvent(ev));
    setInterval(() => this.sweep(), 15_000).unref();
  }

  register(app: FastifyInstance) {
    app.get('/ws/tenders/:tenderId/clauses', { websocket: true }, (socket, req) => {
      const tenderId = (req.params as { tenderId: string }).tenderId;
      void this.handle(socket, req, tenderId);
    });
  }

  private async handle(socket: WebSocket, req: FastifyRequest, tenderId: string) {
    let member: Member | null = null;
    const send = (msg: unknown) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg)); };

    // Authenticate from the upgrade request (ALB session / dev header); if that
    // fails, wait for an `auth` frame carrying a bearer token.
    const tryAuth = async (token?: string): Promise<AuthUser | null> => {
      try {
        if (token) req.headers.authorization = `Bearer ${token}`;
        return await this.auth.resolve(req);
      } catch { return null; }
    };
    let user = await tryAuth();
    const join = async () => {
      if (!user) return;
      const t = await this.ctx.pool.query('SELECT 1 FROM tenders WHERE id = $1 AND deleted_at IS NULL', [tenderId]);
      if (!t.rows[0]) { send({ type: 'error', message: 'Tender not found' }); socket.close(4404, 'not found'); return; }
      member = { socket, user, editing: new Set(), lastSeen: Date.now() };
      this.roomOf(tenderId).add(member);
      send({ type: 'ready', you: user, presence: this.presence(tenderId) });
      await this.broadcastPresence(tenderId);
    };
    await join();
    const authTimer = setTimeout(() => { if (!member) socket.close(4401, 'auth timeout'); }, 10_000);

    socket.on('message', async (raw) => {
      let msg: z.infer<typeof Incoming>;
      try { msg = Incoming.parse(JSON.parse(raw.toString())); } catch { return send({ type: 'error', message: 'Bad message' }); }
      if (msg.type === 'auth') {
        if (member) return;
        user = await tryAuth(msg.token);
        if (!user) { send({ type: 'error', message: 'Sign in required' }); return socket.close(4401, 'unauthorized'); }
        clearTimeout(authTimer);
        return join();
      }
      if (!member) return send({ type: 'error', message: 'Send auth first' });
      member.lastSeen = Date.now();
      switch (msg.type) {
        case 'ping': return send({ type: 'pong' });
        case 'focus':
          member.editing.add(`${msg.clauseId}:${msg.field}`);
          return this.broadcastPresence(tenderId);
        case 'blur':
          member.editing.delete(`${msg.clauseId}:${msg.field}`);
          return this.broadcastPresence(tenderId);
        case 'draft':
          return this.ctx.bus.publish({ tenderId, type: 'draft', clauseId: msg.clauseId, field: msg.field, value: msg.value, by: member.user.name, byId: member.user.id, origin: this.instanceId });
        case 'save': {
          try {
            const result = await saveClausePatches(this.ctx, member.user, tenderId, msg.patches);
            for (const p of msg.patches) for (const f of ['compliance', 'category', 'response']) member.editing.delete(`${p.clauseId}:${f}`);
            send({ type: result.conflicts.length ? 'conflict' : 'saved', clauses: result.clauses, conflicts: result.conflicts });
            await this.broadcastPresence(tenderId);
          } catch (e) {
            send({ type: 'error', message: e instanceof HttpError ? e.message : 'Save failed', status: e instanceof HttpError ? e.status : 500 });
          }
          return;
        }
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (!member) return;
      this.roomOf(tenderId).delete(member);
      if (this.roomOf(tenderId).size === 0) this.rooms.delete(tenderId);
      void this.broadcastPresence(tenderId);
    });
    socket.on('error', () => socket.close());
  }

  private roomOf(tenderId: string) {
    let r = this.rooms.get(tenderId);
    if (!r) { r = new Set(); this.rooms.set(tenderId, r); }
    return r;
  }

  /** Local members merged with what other instances reported. */
  private presence(tenderId: string): Presence[] {
    const byUser = new Map<string, Presence>();
    const add = (p: Presence) => {
      const cur = byUser.get(p.id);
      if (!cur) byUser.set(p.id, { ...p, editing: [...p.editing] });
      else for (const e of p.editing) if (!cur.editing.some((x) => x.clauseId === e.clauseId && x.field === e.field)) cur.editing.push(e);
    };
    for (const m of this.rooms.get(tenderId) ?? []) add(this.toPresence(m));
    for (const [, inst] of this.remote.get(tenderId) ?? []) for (const p of inst.users) add(p);
    return [...byUser.values()];
  }

  private toPresence(m: Member): Presence {
    return { id: m.user.id, name: m.user.name, role: m.user.roleLabel, editing: [...m.editing].map((k) => { const [clauseId, field] = k.split(':'); return { clauseId, field }; }) };
  }

  private async broadcastPresence(tenderId: string) {
    const users = [...(this.rooms.get(tenderId) ?? [])].map((m) => this.toPresence(m));
    await this.ctx.bus.publish({ tenderId, type: 'presence-report', origin: this.instanceId, users });
  }

  private localSend(tenderId: string, msg: unknown, except?: (m: Member) => boolean) {
    const data = JSON.stringify(msg);
    for (const m of this.rooms.get(tenderId) ?? []) {
      if (except?.(m)) continue;
      if (m.socket.readyState === m.socket.OPEN) m.socket.send(data);
    }
  }

  private async onBusEvent(ev: BusEvent) {
    const { tenderId } = ev;
    switch (ev.type) {
      case 'presence-report': {
        const origin = String(ev.origin);
        if (origin !== this.instanceId) {
          let inst = this.remote.get(tenderId);
          if (!inst) { inst = new Map(); this.remote.set(tenderId, inst); }
          inst.set(origin, { at: Date.now(), users: (ev.users as Presence[]) ?? [] });
        }
        if (this.rooms.has(tenderId)) this.localSend(tenderId, { type: 'presence', users: this.presence(tenderId) });
        return;
      }
      case 'draft':
        if (!this.rooms.has(tenderId)) return;
        return this.localSend(tenderId, { type: 'draft', clauseId: ev.clauseId, field: ev.field, value: ev.value, by: ev.by, byId: ev.byId }, (m) => m.user.id === ev.byId);
      case 'clauses-updated': {
        if (!this.rooms.has(tenderId)) return;
        const clauses = await loadClauses(this.ctx, tenderId, ev.ids as string[]);
        return this.localSend(tenderId, { type: 'clauses-updated', clauses, by: ev.by, byId: ev.byId });
      }
      default:
        if (!this.rooms.has(tenderId)) return;
        return this.localSend(tenderId, ev);
    }
  }

  /** Drop stale remote presence (an instance that died without reporting). */
  private sweep() {
    const cutoff = Date.now() - 60_000;
    for (const [tenderId, inst] of this.remote) {
      for (const [id, rep] of inst) if (rep.at < cutoff) inst.delete(id);
      if (inst.size === 0) this.remote.delete(tenderId);
    }
    // keep remote instances informed while members are idle
    for (const tenderId of this.rooms.keys()) void this.broadcastPresence(tenderId);
  }
}

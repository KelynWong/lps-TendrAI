import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canDo, type Permission } from '../auth/rbac.js';
import { audit } from '../lib/audit.js';
import { assertCan } from '../auth/rbac.js';
import { parse, uuid } from '../lib/validate.js';
import { many } from '../db/pool.js';

export async function meRoutes(app: FastifyInstance) {
  const { pool } = app.ctx;

  /** Signed-in user, role and the permission map the UI gates on. */
  app.get('/api/me', async (req) => {
    const perms = Object.fromEntries((Object.keys(canDo) as Permission[]).map((p) => [p, canDo[p](req.user.role)]));
    return { user: req.user, permissions: perms };
  });

  /** Called once per browser session so "Signed in" appears in the audit log. */
  app.post('/api/me/session', async (req) => {
    await audit(pool, req.user, { action: 'Signed in', detail: req.user.email }, req);
    return { ok: true };
  });

  app.post('/api/me/logout', async (req) => {
    await audit(pool, req.user, { action: 'Signed out', detail: req.user.email }, req);
    return { ok: true };
  });

  /** Directory for owner pickers. */
  app.get('/api/users', async () => {
    const rows = await many<{ id: string; name: string; email: string; role: string; role_label: string }>(pool, 'SELECT id, name, email, role, role_label FROM users WHERE active ORDER BY name');
    return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, roleLabel: u.role_label }));
  });

  app.patch('/api/users/:id', async (req) => {
    assertCan(req, 'manageUsers');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ role: z.enum(['bd', 'bidding-manager', 'presales', 'delivery', 'finance', 'drb', 'admin']).optional(), roleLabel: z.string().min(1).optional(), active: z.boolean().optional() }), req.body);
    const r = await pool.query(
      `UPDATE users SET role = COALESCE($2, role), role_label = COALESCE($3, role_label), active = COALESCE($4, active) WHERE id = $1 RETURNING id, name, email, role, role_label AS "roleLabel", active`,
      [id, body.role ?? null, body.roleLabel ?? null, body.active ?? null],
    );
    await audit(pool, req.user, { action: 'User updated', detail: `${r.rows[0]?.email}: ${JSON.stringify(body)}` }, req);
    return r.rows[0];
  });
}

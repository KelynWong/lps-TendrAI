// Qualification requirements: link evidence (certificate / CV) and auto-match.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertNotReadOnly } from '../auth/rbac.js';
import { many, one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { assertUnlocked, mapQual, refOf, tenderRow } from '../lib/tenderDto.js';
import { parse, TenderParams, uuid } from '../lib/validate.js';
import { suggestCertificate } from '../domain/templateMatch.js';
import { loadLibrary } from './library.js';

export async function qualificationRoutes(app: FastifyInstance) {
  const { pool, bus } = app.ctx;
  const qualsOf = (tenderId: string) => many(pool, 'SELECT * FROM qualifications WHERE tender_id = $1 ORDER BY sort_order, created_at', [tenderId]).then((r) => r.map(mapQual));

  app.patch('/api/tenders/:id/qualifications/:qualId', async (req) => {
    assertNotReadOnly(req);
    const { id, qualId } = parse(z.object({ id: uuid, qualId: uuid }), req.params);
    const { evidence } = parse(z.object({ evidence: uuid.nullable() }), req.body);
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const q = await one<{ requirement: string; evidence_item_id: string | null }>(c, 'SELECT requirement, evidence_item_id FROM qualifications WHERE id = $1 AND tender_id = $2 FOR UPDATE', [qualId, id]);
      if (!q) throw notFound('Qualification requirement');
      if (q.evidence_item_id === evidence) return;
      await c.query('UPDATE qualifications SET evidence_item_id = $3, review_state = \'reviewed\', reviewed_by = $4, reviewed_at = now() WHERE id = $1 AND tender_id = $2', [qualId, id, evidence, req.user.id]);
      const item = evidence ? await one<{ name: string; version: string }>(c, 'SELECT name, version FROM library_items WHERE id = $1', [evidence]) : null;
      await audit(c, req.user, { action: 'Certificate linked', detail: `${q.requirement} -> ${item ? `${item.name} v${item.version}` : 'None'}`, tenderId: id, tenderRef: refOf(t), section: 'Qualification' }, req);
    });
    await bus.publish({ tenderId: id, type: 'qualifications-changed', by: req.user.name });
    return qualsOf(id);
  });

  /** Link library certificates whose name appears in each certification requirement. */
  app.post('/api/tenders/:id/qualifications/match', async (req) => {
    assertNotReadOnly(req);
    const { id } = parse(TenderParams, req.params);
    const certs = (await loadLibrary(pool, 'certification'));
    const linked: string[] = [];
    let total = 0;
    await withTx(pool, async (c) => {
      const t = await tenderRow(c, id);
      assertUnlocked(t);
      const quals = await many<{ id: string; requirement: string; evidence_item_id: string | null }>(c, `SELECT id, requirement, evidence_item_id FROM qualifications WHERE tender_id = $1 AND kind = 'Certification'`, [id]);
      total = quals.length;
      for (const q of quals) {
        const m = suggestCertificate(q.requirement, certs);
        if (!m) continue;
        linked.push(q.requirement);
        if (m.id !== q.evidence_item_id) {
          await c.query('UPDATE qualifications SET evidence_item_id = $2 WHERE id = $1', [q.id, m.id]);
          await audit(c, req.user, { action: 'Certificate linked', detail: `${q.requirement} -> ${m.name} v${m.version}`, tenderId: id, tenderRef: refOf(t), section: 'Qualification' }, req);
        }
      }
    });
    await bus.publish({ tenderId: id, type: 'qualifications-changed', by: req.user.name });
    return { matched: linked.length, total, quals: await qualsOf(id) };
  });
}

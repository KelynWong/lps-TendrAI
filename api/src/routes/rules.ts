// Business case management: Final Check rules and MSPO mapping defaults.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan } from '../auth/rbac.js';
import { many, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { cellRefProblem, ruleDefinition } from '../domain/finalChecks.js';
import { evaluateVersion, loadRules, versionData } from './businessCase.js';
import type { FieldMapEntry, MapGroup, RuleDef } from '../types.js';

const CellRef = z.object({ tab: z.string().min(1), ref: z.string().min(1) });
const Rule = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'id must be a lowercase slug'),
  name: z.string().trim().min(1),
  description: z.string().default(''),
  severity: z.enum(['error', 'warning']),
  enabled: z.boolean().default(true),
  kind: z.enum(['compare', 'range', 'every-line', 'builtin']),
  left: CellRef.optional(), right: CellRef.optional(), tolerance: z.number().nonnegative().optional(),
  target: CellRef.optional(), min: z.number().optional(), max: z.number().optional(),
  op: z.enum(['>', '>=', '<', '<=', '=', 'between']).optional(), value: z.number().optional(), value2: z.number().optional(),
  builtin: z.enum(['line-totals-consistent', 'billing-within-duration', 'quote-line-assigned', 'billing-present']).optional(),
  tabs: z.array(z.string()).optional(),
});

function ruleProblems(r: RuleDef): string[] {
  const p: string[] = [];
  const check = (c: z.infer<typeof CellRef> | undefined, label: string, range = false) => {
    if (!c) return p.push(`${label} cell is required`);
    const err = cellRefProblem(c.ref, range);
    if (err) p.push(err);
  };
  if (r.kind === 'compare') { check(r.left, 'left'); check(r.right, 'right'); }
  if (r.kind === 'range') { check(r.target, 'target'); if (r.min === undefined && r.max === undefined) p.push('range rules need a min or a max'); }
  if (r.kind === 'every-line') { check(r.target, 'target', true); if (!r.op) p.push('every-line rules need an operator'); if (r.op === 'between' && (r.value === undefined || r.value2 === undefined)) p.push('between needs two values'); if (r.op !== 'between' && r.value === undefined) p.push('every-line rules need a value'); }
  if (r.kind === 'builtin' && !r.builtin) p.push('builtin rules need a builtin key');
  return p;
}

const Group = z.enum(['product', 'resource', 'billing', 'figures']);
const Entry = z.object({
  target: z.string().min(1), source: z.enum(['workbook', 'mspo', 'manual', 'calculated']),
  tab: z.string().optional(), from: z.string().regex(/^[A-Za-z]{1,2}[1-9]\d*$/).optional(), span: z.enum(['single', 'rows', 'cols', 'rows-cols']).optional(),
  note: z.string().optional(), dropdown: z.enum(['category', 'subcategory']).optional(),
});

export async function loadMspoDefaults(q: Parameters<typeof many>[0]): Promise<Record<MapGroup, FieldMapEntry[]>> {
  const rows = await many<{ group: MapGroup; target: string; source: FieldMapEntry['source']; tab: string | null; from_cell: string | null; span: FieldMapEntry['span'] | null; note: string | null; dropdown: FieldMapEntry['dropdown'] | null }>(q, 'SELECT * FROM mspo_mapping_defaults ORDER BY "group", position');
  const out: Record<MapGroup, FieldMapEntry[]> = { product: [], resource: [], billing: [], figures: [] };
  for (const r of rows) out[r.group].push({ target: r.target, source: r.source, tab: r.tab ?? undefined, from: r.from_cell ?? undefined, span: r.span ?? undefined, note: r.note ?? undefined, dropdown: r.dropdown ?? undefined });
  return out;
}

export async function rulesRoutes(app: FastifyInstance) {
  const { pool } = app.ctx;

  // ---- Final Check rules ---------------------------------------------------------
  app.get('/api/rules', async () => loadRules(pool));

  /** Create or update a rule, then re-evaluate every live business case version. */
  app.put('/api/rules/:id', async (req) => {
    assertCan(req, 'manageRules', 'Only the BD team manages Final Check rules');
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const rule = parse(Rule, { ...(req.body as object), id }) as RuleDef;
    const problems = ruleProblems(rule);
    if (problems.length) throw badRequest('Rule is incomplete', problems);
    await withTx(pool, async (c) => {
      const old = (await loadRules(c)).find((r) => r.id === id);
      await c.query(
        `INSERT INTO final_check_rules (id, name, description, severity, enabled, kind, definition, sort_order, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM final_check_rules), $8, $8)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, severity = EXCLUDED.severity, enabled = EXCLUDED.enabled, kind = EXCLUDED.kind, definition = EXCLUDED.definition, updated_by = EXCLUDED.updated_by`,
        [id, rule.name, rule.description, rule.severity, rule.enabled, rule.kind, JSON.stringify(ruleDefinition(rule)), req.user.id]);
      const toggledOnly = old && old.enabled !== rule.enabled && JSON.stringify({ ...old, enabled: rule.enabled }) === JSON.stringify({ ...old, ...rule });
      await audit(c, req.user, toggledOnly
        ? { action: rule.enabled ? 'Rule enabled' : 'Rule disabled', detail: rule.name, section: 'Business case management' }
        : { action: old ? 'Rule edited' : 'Rule added', detail: `${rule.name} (${rule.severity})`, section: 'Business case management' }, req);
      await reevaluateAll(c);
    });
    return loadRules(pool);
  });

  app.delete('/api/rules/:id', async (req) => {
    assertCan(req, 'manageRules');
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await withTx(pool, async (c) => {
      const r = await c.query('DELETE FROM final_check_rules WHERE id = $1 RETURNING name', [id]);
      if (!r.rows[0]) throw notFound('Rule');
      await audit(c, req.user, { action: 'Rule deleted', detail: r.rows[0].name, section: 'Business case management' }, req);
    });
    return loadRules(pool);
  });

  async function reevaluateAll(c: Parameters<typeof many>[0]) {
    const rules = await loadRules(c);
    const versions = await many<{ id: string }>(c, 'SELECT id FROM bc_versions WHERE deleted_at IS NULL AND NOT layout_unrecognised');
    for (const v of versions) {
      const data = await versionData(c, v.id);
      if (data) await evaluateVersion(c, v.id, data, rules);
    }
  }

  // ---- MSPO mapping defaults -------------------------------------------------------
  app.get('/api/mspo-defaults', async () => loadMspoDefaults(pool));

  /** Replace the default mapping of one plan (order = template column order). */
  app.put('/api/mspo-defaults/:group', async (req) => {
    assertCan(req, 'manageRules', 'Only the BD team manages MSPO mapping defaults');
    const { group } = parse(z.object({ group: Group }), req.params);
    const { entries } = parse(z.object({ entries: z.array(Entry).min(1) }), req.body);
    const bad = entries.filter((e) => e.source === 'workbook' && !(e.tab && e.from && e.span)).map((e) => e.target);
    if (bad.length) throw badRequest('Workbook-sourced columns need a tab, first cell and span', bad);
    await withTx(pool, async (c) => {
      await c.query('DELETE FROM mspo_mapping_defaults WHERE "group" = $1', [group]);
      for (const [i, e] of entries.entries()) {
        await c.query(
          'INSERT INTO mspo_mapping_defaults ("group", position, target, source, tab, from_cell, span, note, dropdown, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [group, i + 1, e.target, e.source, e.tab ?? null, e.from?.toUpperCase() ?? null, e.span ?? null, e.note ?? null, e.dropdown ?? null, req.user.id]);
      }
      await audit(c, req.user, { action: 'MSPO default mapping changed', detail: group === 'figures' ? 'Business case figures' : `${group} plan`, section: 'Business case management' }, req);
    });
    return loadMspoDefaults(pool);
  });
}

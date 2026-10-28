// Library: templates, boilerplate, certifications and CVs with version history
// and tags. Files are uploaded straight to S3 via presigned URLs.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertCan } from '../auth/rbac.js';
import type { Queryable } from '../db/pool.js';
import { many, one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { libraryKey } from '../lib/s3.js';
import { bumpVersion } from '../domain/templateMatch.js';
import { nonEmpty, parse, uuid } from '../lib/validate.js';
import type { LibraryItem, LibraryKind } from '../types.js';

const Kind = z.enum(['template', 'boilerplate', 'certification', 'cv']);
const TemplateType = z.enum(['Compliance table', 'Cover letter', 'Company profile', 'Form', 'Document formatting']);
const TYPE_OF_KIND: Record<Exclude<LibraryKind, 'template'>, string> = { boilerplate: 'Company background', certification: 'Certification', cv: 'CV' };
const KIND_LABEL: Record<LibraryKind, string> = { template: 'Template', boilerplate: 'Boilerplate', certification: 'Certification', cv: 'CV' };

const LIBRARY_SQL = `
  SELECT i.*, o.name AS owner_name, u.name AS uploaded_by_name,
    (SELECT COALESCE(json_agg(json_build_object('version', v.version, 'updated', to_char(v.uploaded_at, 'YYYY-MM-DD'), 'uploadedBy', vu.name, 'fileName', v.file_name, 'current', v.is_current) ORDER BY v.uploaded_at DESC), '[]')
       FROM library_item_versions v LEFT JOIN users vu ON vu.id = v.uploaded_by WHERE v.item_id = i.id) AS versions,
    (SELECT COALESCE(array_agg(tg.name::text ORDER BY tg.name), '{}') FROM library_item_tags lt JOIN tags tg ON tg.id = lt.tag_id WHERE lt.item_id = i.id) AS tags,
    COALESCE((SELECT tender_ids::text[] FROM v_template_usage vu WHERE vu.template_id = i.id), '{}') AS used_by
  FROM library_items i LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN users u ON u.id = i.uploaded_by`;

function mapItem(r: any): LibraryItem {
  const versions = (r.versions ?? []) as { version: string; updated: string; uploadedBy: string; fileName: string; current: boolean }[];
  const current = versions.find((v) => v.current);
  return {
    id: r.id, kind: r.kind, name: r.name, agency: r.agency, type: r.item_type, version: r.version,
    updated: (r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)).slice(0, 10),
    owner: r.owner_name ?? '', uploadedBy: r.uploaded_by_name ?? '', fileName: current?.fileName,
    usedBy: r.used_by ?? [],
    history: versions.filter((v) => !v.current).map(({ current: _c, ...v }) => { void _c; return v; }),
    expires: r.expires ?? undefined, issuer: r.issuer ?? undefined, certNumber: r.cert_number ?? undefined, issued: r.issued ?? undefined,
    tags: r.tags?.length ? r.tags : undefined, role: r.cv_role ?? undefined, years: r.cv_years ?? undefined,
  };
}

export async function loadLibrary(q: Queryable, kind?: LibraryKind): Promise<LibraryItem[]> {
  const rows = kind
    ? await many<any>(q, `${LIBRARY_SQL} WHERE i.deleted_at IS NULL AND i.kind = $1 ORDER BY i.updated_at DESC`, [kind])
    : await many<any>(q, `${LIBRARY_SQL} WHERE i.deleted_at IS NULL ORDER BY i.kind, i.updated_at DESC`);
  return rows.map(mapItem);
}

async function syncTags(c: Queryable, itemId: string, tags: string[] | undefined): Promise<string[]> {
  if (tags === undefined) return [];
  const existing = await many<{ name: string }>(c, 'SELECT name FROM tags');
  const added = tags.filter((t) => !existing.some((e) => e.name.toLowerCase() === t.toLowerCase()));
  await c.query('DELETE FROM library_item_tags WHERE item_id = $1', [itemId]);
  for (const t of tags) {
    const tag = await one<{ id: number }>(c, 'INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = tags.name RETURNING id', [t.trim()]);
    await c.query('INSERT INTO library_item_tags (item_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [itemId, tag!.id]);
  }
  return added;
}
const tagNote = (added: string[]) => (added.length ? ` (new tag${added.length > 1 ? 's' : ''} added to the list: ${added.join(', ')})` : '');

export async function libraryRoutes(app: FastifyInstance) {
  const { pool, storage, cfg } = app.ctx;

  app.get('/api/library', async (req) => {
    const { kind } = parse(z.object({ kind: Kind.optional() }), req.query);
    return loadLibrary(pool, kind);
  });

  app.get('/api/library/tags', async () => (await many<{ name: string }>(pool, 'SELECT name FROM tags ORDER BY name')).map((t) => t.name));

  /** Step 1: presigned PUT. `replaceId` targets an existing item (new version). */
  app.post('/api/library/presign', async (req) => {
    assertCan(req, 'manageTemplates', 'Only the Bidding Manager and BD team upload library items');
    const b = parse(z.object({ kind: Kind, fileName: nonEmpty, contentType: z.string().optional(), version: z.string().trim().optional(), replaceId: uuid.optional() }), req.body);
    let itemId = b.replaceId ?? randomUUID();
    let version = b.version;
    if (b.replaceId) {
      const cur = await one<{ id: string; version: string }>(pool, 'SELECT id, version FROM library_items WHERE id = $1 AND deleted_at IS NULL', [b.replaceId]);
      if (!cur) throw notFound('Library item');
      itemId = cur.id;
      version = version || bumpVersion(cur.version);
      if (version === cur.version) throw conflict(`Choose a version other than the current v${cur.version}`);
    }
    version = version || '1.0';
    const key = libraryKey(itemId, version, b.fileName);
    return { itemId, version, key, url: await storage.presignUpload(key, b.contentType) };
  });

  /** Step 2: create the item, or add a version to an existing one. */
  app.post('/api/library', async (req, reply) => {
    assertCan(req, 'manageTemplates');
    const b = parse(z.object({
      itemId: uuid, kind: Kind, name: nonEmpty, version: nonEmpty, key: z.string(), fileName: nonEmpty, contentType: z.string().optional(),
      agency: z.string().trim().min(1).default('Generic'), type: TemplateType.optional(),
      expires: z.string().optional(), issuer: z.string().trim().optional(), certNumber: z.string().trim().optional(), issued: z.string().optional(),
      tags: z.array(z.string().trim().min(1)).optional(), role: z.string().trim().optional(), years: z.number().int().nonnegative().optional(),
    }), req.body);
    if (b.key !== libraryKey(b.itemId, b.version, b.fileName)) throw badRequest('Unexpected object key');
    if (b.kind === 'certification' && !(b.expires && b.issuer && b.certNumber && b.issued)) throw badRequest('Certificates need issuer, certificate number, issue date and expiry');
    const head = await storage.head(b.key);
    if (!head) throw badRequest('The file was not uploaded');
    const itemType = b.kind === 'template' ? (b.type ?? 'Form') : TYPE_OF_KIND[b.kind];
    const { replaced } = await withTx(pool, async (c) => {
      const existing = await one<{ id: string; version: string; name: string }>(c, 'SELECT id, version, name FROM library_items WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [b.itemId]);
      // same name (and agency for templates) as another item -> treat as a replacement of that item
      const byName = existing ? null : await one<{ id: string; version: string }>(c,
        b.kind === 'template'
          ? `SELECT id, version FROM library_items WHERE kind = 'template' AND deleted_at IS NULL AND name = $1 AND agency = $2`
          : 'SELECT id, version FROM library_items WHERE kind = $3 AND deleted_at IS NULL AND name = $1',
        b.kind === 'template' ? [b.name, b.agency] : [b.name, null, b.kind]);
      if (byName) throw conflict('An item with this name already exists - upload it as a new version instead', { itemId: byName.id, version: byName.version });
      if (existing) {
        if (existing.version === b.version) throw conflict(`Version ${b.version} is the current version`);
        await c.query('UPDATE library_item_versions SET is_current = false WHERE item_id = $1', [b.itemId]);
        await c.query(
          `UPDATE library_items SET name = $2, version = $3, uploaded_by = $4, expires = COALESCE($5::date, expires), issuer = COALESCE($6, issuer), cert_number = COALESCE($7, cert_number), issued = COALESCE($8::date, issued), cv_role = COALESCE($9, cv_role), cv_years = COALESCE($10, cv_years), updated_at = now()
           WHERE id = $1`,
          [b.itemId, b.name, b.version, req.user.id, b.expires || null, b.issuer || null, b.certNumber || null, b.issued || null, b.role || null, b.years ?? null]);
      } else {
        await c.query(
          `INSERT INTO library_items (id, kind, name, agency, item_type, version, owner_id, uploaded_by, expires, issuer, cert_number, issued, cv_role, cv_years)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13)`,
          [b.itemId, b.kind, b.name, b.kind === 'template' ? b.agency : 'Generic', itemType, b.version, req.user.id, b.expires || null, b.issuer || null, b.certNumber || null, b.issued || null, b.role || null, b.years ?? null]);
      }
      await c.query(
        'INSERT INTO library_item_versions (item_id, version, file_name, size_bytes, content_type, s3_key, s3_version_id, is_current, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)',
        [b.itemId, b.version, b.fileName, head.size, b.contentType ?? head.contentType ?? null, b.key, head.versionId ?? null, req.user.id]);
      const added = await syncTags(c, b.itemId, b.kind === 'boilerplate' ? b.tags : undefined);
      const label = KIND_LABEL[b.kind];
      await audit(c, req.user, {
        action: `${label} ${existing ? 'replaced' : 'uploaded'}`,
        detail: b.kind === 'template' ? `${b.name} v${b.version} (${b.agency}, ${itemType})` : `${b.name} v${b.version}${tagNote(added)}`,
        section: 'Templates',
      }, req);
      return { replaced: !!existing };
    });
    const item = (await loadLibrary(pool)).find((i) => i.id === b.itemId);
    return reply.status(replaced ? 200 : 201).send(item);
  });

  app.patch('/api/library/:id', async (req) => {
    assertCan(req, 'manageTemplates');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(z.object({
      name: nonEmpty.optional(), version: nonEmpty.optional(), expires: z.string().optional(), issuer: z.string().optional(), certNumber: z.string().optional(), issued: z.string().optional(),
      tags: z.array(z.string().trim().min(1)).optional(), role: z.string().optional(), years: z.number().int().nonnegative().optional(),
    }), req.body);
    await withTx(pool, async (c) => {
      const cur = await one<{ kind: LibraryKind; name: string; item_type: string }>(c, 'SELECT kind, name, item_type FROM library_items WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
      if (!cur) throw notFound('Library item');
      await c.query(
        `UPDATE library_items SET name = COALESCE($2, name), version = COALESCE($3, version),
           expires = CASE WHEN $4::boolean THEN NULLIF($5, '')::date ELSE expires END, issuer = COALESCE($6, issuer), cert_number = COALESCE($7, cert_number),
           issued = CASE WHEN $8::boolean THEN NULLIF($9, '')::date ELSE issued END, cv_role = COALESCE($10, cv_role), cv_years = COALESCE($11, cv_years), updated_at = now()
         WHERE id = $1`,
        [id, b.name ?? null, b.version ?? null, b.expires !== undefined, b.expires ?? null, b.issuer ?? null, b.certNumber ?? null, b.issued !== undefined, b.issued ?? null, b.role ?? null, b.years ?? null]);
      if (b.version) await c.query('UPDATE library_item_versions SET version = $2 WHERE item_id = $1 AND is_current', [id, b.version]);
      const added = await syncTags(c, id, cur.kind === 'boilerplate' ? b.tags : undefined);
      await audit(c, req.user, { action: cur.kind === 'template' ? 'Template edited' : 'Boilerplate edited', detail: `${b.name ?? cur.name}${tagNote(added)}`, section: 'Templates' }, req);
    });
    return (await loadLibrary(pool)).find((i) => i.id === id);
  });

  app.delete('/api/library/:id', async (req, reply) => {
    assertCan(req, 'manageTemplates');
    const { id } = parse(z.object({ id: uuid }), req.params);
    await withTx(pool, async (c) => {
      const cur = await one<{ kind: LibraryKind; name: string }>(c, 'UPDATE library_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING kind, name', [id]);
      if (!cur) throw notFound('Library item');
      await audit(c, req.user, { action: cur.kind === 'template' ? 'Template deleted' : 'Boilerplate deleted', detail: cur.name, section: 'Templates' }, req);
    });
    return reply.status(204).send();
  });

  /** Download the current or an earlier version. */
  app.get('/api/library/:id/versions/:version/download', async (req) => {
    const { id, version } = parse(z.object({ id: uuid, version: z.string() }), req.params);
    const row = await one<{ name: string; file_name: string; s3_key: string; s3_version_id: string | null }>(pool,
      'SELECT i.name, v.file_name, v.s3_key, v.s3_version_id FROM library_item_versions v JOIN library_items i ON i.id = v.item_id WHERE v.item_id = $1 AND v.version = $2 AND i.deleted_at IS NULL', [id, version]);
    if (!row) throw notFound('Library item version');
    await audit(pool, req.user, { action: 'File downloaded', detail: `${row.name} v${version}`, section: 'Templates' }, req);
    return { url: await storage.presignDownload(row.s3_key, row.file_name, row.s3_version_id ?? undefined), fileName: row.file_name, expiresIn: cfg.PRESIGN_TTL_SECONDS };
  });
}

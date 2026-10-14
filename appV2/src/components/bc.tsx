// Business case sections: version upload + Final Check (warn, never block),
// version diff, MSPO auto-fill with visible mapping, the read-only DRB view,
// and tender document generation.

import { Fragment, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  Inbox,
  Pencil,
  Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { BcVersion, BcVersionData, Tender } from '../types';
import { canDo } from '../config';
import { dateShort, money, pct, ts } from '../lib/format';
import { useStore } from '../state/store';
import { TextCell } from './common';
import { failedChecks, runFinalChecks, type CheckRun } from '../rules/finalChecks';
import {
  BC_TABS,
  BILLING_FIELD_MAP,
  BILLING_HEADERS,
  PRODUCT_FIELD_MAP,
  PRODUCT_HEADERS,
  RESOURCE_FIELD_MAP,
  RESOURCE_HEADERS,
  buildBillingRows,
  buildProductRows,
  buildResourceRows,
  downloadMspoBilling,
  downloadMspoProduct,
  downloadMspoResource,
  type FieldMapEntry,
} from '../mspo/mapping';
import { Banner, Button, ConfirmDialog, EmptyState, IconButton, TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import { ProgressStages } from './ProgressStages';
import { SpreadsheetDocumentViewer, useCitation } from '../ui/citation';
import { isTenderLocked } from './rfp';

const latest = (t: Tender): BcVersion | undefined => t.bcVersions[t.bcVersions.length - 1];

function checksLine(runs: CheckRun[]): string {
  const failed = failedChecks(runs);
  return failed.length === 0 ? 'all checks passed' : `${failed.length} check${failed.length > 1 ? 's' : ''} failed`;
}

// ---- Checks panel ------------------------------------------------------------

export function ChecksPanel({ runs, version }: { runs: CheckRun[]; version?: BcVersion }) {
  const { show } = useCitation();
  // The viewer opens one pane per involved workbook tab (e.g. "Billing plan
  // equals CCB" shows Basic Info beside Summary), not the whole workbook.
  const showCheckCitation = (rule: CheckRun['rule']) => show({
    docId: `BC-${version?.v ?? 'current'}`,
    title: `Business case - ${version?.fileName ?? 'uploaded workbook'}`,
    fileName: version?.fileName ?? 'uploaded workbook',
    documentUrl: version?.documentUrl ?? '/mock-documents/MHA_business_case_demo.xlsm',
    similarity: 1,
    source: 'historical',
    tab: rule.tabs.join(' · '),
    context: rule.name,
    excerpt: rule.description,
    references: rule.tabs.map((tab) => ({ location: tab, excerpt: `${rule.name}: ${rule.description}` })),
  });
  return (
    <div>
      <table className="grid">
        <thead><tr><th>Result</th><th>Rule</th><th>Tabs involved</th><th>Expected</th><th>Actual</th><th>Source</th></tr></thead>
        <tbody>
          {runs.map(({ rule, result }) => (
            <tr key={rule.id}>
              <td style={{ whiteSpace: 'nowrap' }}>
                {result.ok
                  ? <span className="ok"><Check size={13} aria-hidden style={{ verticalAlign: '-2px' }} /> Pass</span>
                  : <span className="err"><AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px' }} /> {rule.severity === 'error' ? 'Fail' : 'Warning'}</span>}
              </td>
              <td><b>{rule.name}</b><div className="muted small">{rule.description}</div></td>
              <td>
                {rule.tabs.map((tab) => <span className="badge badge-neutral" key={tab} style={{ marginRight: 4 }}>{tab}</span>)}
              </td>
              <td className="check-value">{result.expected}</td>
              <td className="check-value">{result.actual}</td>
              <td>
                <button className="link-btn" type="button" onClick={() => showCheckCitation(rule)}>View source</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- MSPO panel --------------------------------------------------------------

function MspoPanel({ t, data, runs, version }: { t: Tender; data: BcVersionData; runs: CheckRun[]; version?: BcVersion }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [editMapping, setEditMapping] = useState(false);
  const layoutBad = version?.layoutUnrecognised;
  const canDl = canDo.downloadMspo(state.role) && !layoutBad;
  const canEditMapping = canDo.downloadMspo(state.role) && !layoutBad;
  const failed = failedChecks(runs);
  const pRows = buildProductRows(t, data).slice(0, 4);
  const rRows = buildResourceRows(t, data).slice(0, 4);
  const bRows = buildBillingRows(t, data).slice(0, 4);
  // the preview hides the "(Do Not Modify)" system columns; the downloaded
  // Excel still contains them
  const previewCols = (headers: string[]) =>
    headers.map((h, i) => ({ h, i })).filter((x) => !x.h.startsWith('(Do Not Modify)'));

  const dl = (which: 'product' | 'resource' | 'billing') => {
    if (which === 'product') downloadMspoProduct(t, data);
    else if (which === 'resource') downloadMspoResource(t, data);
    else downloadMspoBilling(t, data);
    toast.push(
      failed.length ? 'warning' : 'success',
      `MSPO ${which} plan downloaded`,
      failed.length ? `Generated although ${failed.length} Final Check(s) failed - review before uploading to MSPO.` : 'Filled from the latest business case.',
    );
  };

  const dlTitle = canDl
    ? (failed.length ? 'Checks failed - download carries a warning' : undefined)
    : layoutBad ? 'Blocked: the uploaded workbook does not match a known template layout' : 'Only the BD team downloads MSPO templates';

  const mappingFor = (plan: string, e: FieldMapEntry): { tab: string; from: string; to?: string } =>
    t.mspoMapping?.[`${plan}:${e.target}`] ?? { tab: e.tab, from: e.from, to: e.to };

  const parseCell = (s: string) => {
    const m = /^([A-Za-z]{1,2})([1-9]\d*)$/.exec(s.trim());
    return m ? { col: m[1].toUpperCase(), row: +m[2] } : null;
  };

  /** Validates and saves a range edit. The from/to column letters must match,
   *  and every multi-row range in one plan must span the same number of rows
   *  (each template column produces the same number of MSPO rows). */
  const commitRange = (plan: string, entries: FieldMapEntry[], e: FieldMapEntry, tab: string, fromStr: string, toStr: string) => {
    const from = parseCell(fromStr);
    if (!from) {
      toast.push('error', 'Invalid cell reference', `"${fromStr}" is not a cell like C4.`);
      return;
    }
    let to: { col: string; row: number } | null = null;
    if (toStr.trim()) {
      to = parseCell(toStr);
      if (!to) {
        toast.push('error', 'Invalid cell reference', `"${toStr}" is not a cell like C23. Leave it empty for a single cell.`);
        return;
      }
      if (to.col !== from.col) {
        toast.push('error', 'Column letters must match', `${from.col}${from.row} to ${to.col}${to.row} spans two columns - a range must stay within one column.`);
        return;
      }
      if (to.row < from.row) {
        toast.push('error', 'Range is reversed', `The "to" cell (${to.col}${to.row}) comes before the "from" cell (${from.col}${from.row}).`);
        return;
      }
      const rows = to.row - from.row + 1;
      const otherCounts = entries
        .filter((x) => x.target !== e.target)
        .map((x) => mappingFor(plan, x))
        .filter((x) => x.to)
        .map((x) => parseCell(x.to!)!.row - parseCell(x.from)!.row + 1);
      if (otherCounts.length && otherCounts[0] !== rows) {
        toast.push('error', 'Row counts must match', `The other ranges in this plan span ${otherCounts[0]} rows, but ${from.col}${from.row} to ${to.col}${to.row} spans ${rows}. Every template column must produce the same number of rows.`);
        return;
      }
    }
    dispatch({ type: 'set-mspo-mapping', tenderId: t.id, key: `${plan}:${e.target}`, tab, from: `${from.col}${from.row}`, to: to ? `${to.col}${to.row}` : undefined });
    toast.push('success', 'Mapping updated', `${e.target} is now filled from ${tab} ${from.col}${from.row}${to ? ` to ${to.col}${to.row}` : ''}.`);
  };

  return (
    <section>
      {!layoutBad && failed.length > 0 && (
        <Banner kind="warning">
          {failed.length} Final Check{failed.length > 1 ? 's' : ''} failed on this version. You can
          still generate the MSPO templates, but the downloads carry this warning.
        </Banner>
      )}
      <div className="review-toolbar">
        <span className="muted small">
          {version?.mspoDownloadedAt
            ? <>MSPO templates were last generated from v{version.v} on {ts(version.mspoDownloadedAt)}.</>
            : <>Filled from business case v{version?.v ?? '-'} ({t.projectType.toLowerCase()} project).</>}
        </span>
        <span className="review-toolbar-actions">
          <Button icon={Download} compact disabled={!canDl} title={dlTitle} onClick={() => dl('product')}>
            Download product plan
          </Button>
          <Button icon={Download} compact disabled={!canDl} title={dlTitle} onClick={() => dl('billing')}>
            Download billing plan
          </Button>
          <Button variant="primary" compact icon={Download} disabled={!canDl} title={dlTitle} onClick={() => dl('resource')}>
            Download resource plan
          </Button>
          <Button
            compact
            icon={Pencil}
            disabled={!canEditMapping}
            title={canEditMapping ? 'Change which business case tab and cell range fills each template column' : layoutBad ? 'Unavailable: the workbook layout was not recognised' : 'Only the BD team edits the MSPO mapping'}
            onClick={() => setEditMapping((v) => !v)}
          >
            {editMapping ? 'Done editing mapping' : 'Edit mapping'}
          </Button>
        </span>
      </div>
      {layoutBad && (
        <Banner kind="error">
          <b>MSPO generation is blocked for this version.</b> The uploaded workbook does not match a
          known business case template layout - these anchors were not found:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {layoutBad.missingAnchors.map((a) => <li key={a}>{a}</li>)}
          </ul>
          Upload a version based on the current template to continue. Failed Final Checks only warn,
          but an unreadable layout cannot be mapped to the MSPO templates at all.
        </Banner>
      )}
      {!layoutBad && <><details className="mapping-panel" open={editMapping}>
        <summary>Field mapping (business case tab and cell range per template column){editMapping ? ' - editing' : ''}</summary>
        <div className="two-col">
          {([
            { title: 'Product plan template', plan: 'product', m: PRODUCT_FIELD_MAP },
            { title: 'Resource plan template', plan: 'resource', m: RESOURCE_FIELD_MAP },
            { title: 'Billing plan template', plan: 'billing', m: BILLING_FIELD_MAP },
          ]).map((g) => (
            <table className="grid" key={g.title}>
              <thead>
                <tr><th colSpan={4}>{g.title}</th></tr>
                <tr><th>Template column</th><th>Business case tab</th><th>From cell</th><th>To cell (optional)</th></tr>
              </thead>
              <tbody>
                {g.m.map((e) => {
                  const cur = mappingFor(g.plan, e);
                  const edited = t.mspoMapping?.[`${g.plan}:${e.target}`] !== undefined;
                  return (
                    <tr key={e.target}>
                      <td>
                        {e.target}
                        {edited && <span className="badge badge-human" style={{ marginLeft: 6 }}><Check size={12} aria-hidden /> Edited</span>}
                      </td>
                      <td>
                        {editMapping && canEditMapping ? (
                          <select
                            value={cur.tab}
                            aria-label={`Business case tab for ${e.target}`}
                            onChange={(ev) => {
                              dispatch({ type: 'set-mspo-mapping', tenderId: t.id, key: `${g.plan}:${e.target}`, tab: ev.target.value, from: cur.from, to: cur.to });
                              toast.push('success', 'Mapping updated', `${e.target} is now filled from ${ev.target.value} ${cur.from}${cur.to ? ` to ${cur.to}` : ''}.`);
                            }}
                          >
                            {BC_TABS.map((tab) => <option key={tab}>{tab}</option>)}
                          </select>
                        ) : <span className="muted">{cur.tab}</span>}
                      </td>
                      <td className="mono">
                        <TextCell
                          value={cur.from}
                          editable={editMapping && canEditMapping}
                          onCommit={(v) => commitRange(g.plan, g.m, e, cur.tab, v, cur.to ?? '')}
                        />
                      </td>
                      <td className="mono">
                        <TextCell
                          value={cur.to ?? ''}
                          placeholder="Single cell"
                          editable={editMapping && canEditMapping}
                          onCommit={(v) => commitRange(g.plan, g.m, e, cur.tab, cur.from, v)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
      </details>
      <h3>Preview <span className="muted small">(first rows of what will be written; the "(Do Not Modify)" system columns are included in the download but hidden here)</span></h3>
      {[
        { h: PRODUCT_HEADERS, r: pRows, name: 'Product plan' },
        { h: RESOURCE_HEADERS, r: rRows, name: 'Resource plan' },
        { h: BILLING_HEADERS, r: bRows, name: 'Billing plan' },
      ].map((p) => {
        const cols = previewCols(p.h);
        return (
          <div key={p.name} style={{ marginBottom: 12 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>{p.name}</div>
            <div className="scroll-x">
              <table className="grid tiny">
                <thead><tr>{cols.map((c) => <th key={c.h}>{c.h}</th>)}</tr></thead>
                <tbody>
                  {p.r.map((row, i) => (
                    <tr key={i}>{cols.map((c) => <td key={c.i} className={typeof row[c.i] === 'number' ? 'num' : ''}>{typeof row[c.i] === 'number' ? (row[c.i] as number).toLocaleString() : row[c.i]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}</>}
    </section>
  );
}

// ---- Best-effort Excel parsing for uploads -----------------------------------

async function parseUpload(file: File, fallback: BcVersionData): Promise<{ data: BcVersionData; parsed: boolean }> {
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const prodSheet = wb.Sheets['Product Plan'];
    const resSheet = wb.Sheets['Resource Plan'];
    if (!prodSheet || !resSheet) throw new Error('expected sheets missing');
    const prows = XLSX.utils.sheet_to_json<Record<string, unknown>>(prodSheet);
    const rrows = XLSX.utils.sheet_to_json<Record<string, unknown>>(resSheet);
    const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v)) || 0);
    const products = prows.map((r, i) => ({
      id: `p${i + 1}`,
      ql: num(r['Quote Line'] ?? r['QL'] ?? 1) || 1,
      category: String(r['Category'] ?? 'Software'),
      desc: String(r['Description'] ?? r['Commodity/Service descriptions'] ?? `Line ${i + 1}`),
      unitCost: num(r['Unit Cost'] ?? r['Unit Price']),
      qty: num(r['Quantity'] ?? r['Qty'] ?? 1),
      total: num(r['Total'] ?? r['Total Cost']),
    }));
    const resources = rrows.map((r, i) => ({
      id: `r${i + 1}`,
      ql: num(r['Quote Line'] ?? 1) || 1,
      role: String(r['Role'] ?? `Role ${i + 1}`),
      grade: String(r['Grade'] ?? '4'),
      team: String(r['Team'] ?? 'Insys - Cloud - SG'),
      mandays: num(r['Man-days'] ?? r['Total MD']),
      dayRate: num(r['Day Rate'] ?? r['iRate']),
      total: num(r['Total'] ?? r['Total Amount']),
    }));
    if (products.length === 0 && resources.length === 0) throw new Error('no rows');
    return {
      parsed: true,
      data: {
        header: {
          ...fallback.header,
          productTotal: products.reduce((a, p) => a + p.total, 0),
          labourTotal: resources.reduce((a, r) => a + r.total, 0),
        },
        products: products.length ? products : fallback.products,
        resources: resources.length ? resources : fallback.resources,
        billing: fallback.billing,
      },
    };
  } catch {
    // Not a parseable business case workbook: use mock parsed data (stated assumption)
    return { data: fallback, parsed: false };
  }
}

// ---- Versions + upload --------------------------------------------------------

export function BcSection({ t }: { t: Tender }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const canUpload = canDo.uploadBc(state.role) && !isTenderLocked(t);
  const [tab, setTab] = useState<'versions' | 'mspo'>('versions');
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [deleteVersion, setDeleteVersion] = useState<BcVersion | null>(null);
  const [comment, setComment] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const lv = latest(t);
  const selected = lv;
  // checks cannot run when the workbook layout was not recognised
  const runs = useMemo(() => (selected && !selected.layoutUnrecognised ? runFinalChecks(selected.data) : []), [selected]);

  if (!lv || !selected) {
    return (
      <section>
        {canUpload &&         <UploadZone t={t} comment={comment} setComment={setComment} uploading={uploading} setUploading={setUploading} selectedFile={selectedFile} setSelectedFile={setSelectedFile} />}
        <EmptyState icon={Inbox} title="No business case uploaded yet" body="The BD team uploads the Excel business case here; each upload becomes a new version and is checked automatically." />
      </section>
    );
  }

  const failed = failedChecks(runs);

  return (
    <section>
      <TabsBar
        tabs={[
          { key: 'versions', label: `Versions (${t.bcVersions.length})` },
          { key: 'mspo', label: 'MSPO templates' },
        ]}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />
      {/* the MSPO tab carries its own warning right above the download buttons */}
      {tab !== 'mspo' && (selected.layoutUnrecognised ? (
        <Banner kind="error">
          Version {selected.v} could not be matched to a known template layout, so the Final Check
          rules did not run and MSPO generation is blocked. See the MSPO templates tab for the
          anchors that were not found, or upload a version based on the current template.
        </Banner>
      ) : failed.length > 0 && (
        <Banner kind="warning">
          Version {selected.v} failed {failed.length} Final Check{failed.length > 1 ? 's' : ''}. This
          warns but does not block: MSPO generation and DRB review stay available.
        </Banner>
      ))}

      {tab === 'versions' && (
        <>
          {canUpload && <UploadZone t={t} comment={comment} setComment={setComment} uploading={uploading} setUploading={setUploading} selectedFile={selectedFile} setSelectedFile={setSelectedFile} />}
          <table className="grid">
            <thead><tr><th aria-label="Expand checks" /><th>Version</th><th>Uploaded</th><th>File</th><th>Comment</th><th>Checks</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {[...t.bcVersions].reverse().map((v) => {
                const bad = !!v.layoutUnrecognised;
                const r = bad ? [] : runFinalChecks(v.data);
                const f = failedChecks(r).length;
                const expanded = expandedVersions.has(v.v);
                return (
                  <Fragment key={v.v}>
                  <tr key={`${v.v}-summary`} className={v.v === selected.v ? 'row-selected' : ''}>
                    <td className="expand-cell">
                      {!bad && (
                        <button
                          className="expand-btn"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} checks for version ${v.v}`}
                          onClick={() => setExpandedVersions((current) => {
                            const next = new Set(current);
                            if (next.has(v.v)) next.delete(v.v); else next.add(v.v);
                            return next;
                          })}
                        >
                          {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                        </button>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <b>v{v.v}</b> {v.v === lv.v && <span className="badge badge-human"><Check size={12} aria-hidden /> Latest</span>}
                    </td>
                    <td className="muted">{v.uploadedBy}<div className="small">{ts(v.uploadedAt)}</div></td>
                    <td className="mono small">{v.fileName}</td>
                    <td className="muted">{v.comment ?? '-'}</td>
                    <td>
                      {bad
                        ? <span className="err"><AlertTriangle size={13} aria-hidden /> Layout not recognised</span>
                        : f === 0 ? <span className="ok"><Check size={13} aria-hidden /> All passed</span> : <span className="err"><AlertTriangle size={13} aria-hidden /> {f} failed</span>}
                    </td>
                    <td className="table-actions">
                      {canUpload && (
                        <IconButton label={`Delete version ${v.v}`} icon={Trash2} danger onClick={() => setDeleteVersion(v)} />
                      )}
                    </td>
                  </tr>
                  {expanded && !bad && (
                    <tr key={`${v.v}-checks`}>
                      <td colSpan={7}><ChecksPanel runs={r} version={v} /></td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {tab === 'mspo' && <MspoPanel t={t} data={lv.data} runs={lv.layoutUnrecognised ? [] : runFinalChecks(lv.data)} version={lv} />}

      <ConfirmDialog
        open={deleteVersion !== null}
        title={`Delete business case version ${deleteVersion?.v}?`}
        confirmLabel="Delete version"
        danger
        onClose={() => setDeleteVersion(null)}
        onConfirm={() => {
          if (deleteVersion) {
            dispatch({ type: 'delete-bc-version', tenderId: t.id, v: deleteVersion.v });
            toast.push('success', `Version ${deleteVersion.v} deleted`, `${deleteVersion.fileName} and its check results were removed. Other versions are unaffected.`);
          }
          setDeleteVersion(null);
        }}
      >
        <p>
          You are about to delete <b>v{deleteVersion?.v}</b> ({deleteVersion?.fileName}),
          uploaded by {deleteVersion?.uploadedBy}. Its file and Final Check results are removed;
          other versions are unaffected.
        </p>
        <p className="muted small">This action cannot be undone.</p>
      </ConfirmDialog>
    </section>
  );
}

function UploadZone({
  t, comment, setComment, uploading, setUploading,
  selectedFile, setSelectedFile,
}: {
  t: Tender; comment: string; setComment: (v: string) => void;
  uploading: string | null; setUploading: (v: string | null) => void;
  selectedFile: File | null; setSelectedFile: (v: File | null) => void;
}) {
  const { dispatch } = useStore();
  const toast = useToast();
  const lv = latest(t);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      toast.push('error', 'Excel file required', 'Business case uploads must be .xlsx or .xlsm files.');
      return;
    }
    setUploading(file.name);
    const fallbackBase: BcVersionData = lv
      ? JSON.parse(JSON.stringify(lv.data))
      : {
          header: { tcv: 1000000, productTotal: 400000, labourTotal: 500000, marginPct: 12, currency: 'SGD', durationMonths: 12, projectStart: new Date().toISOString().slice(0, 10) },
          products: [{ id: 'p1', ql: 1, category: 'Software', desc: 'Platform licence', unitCost: 200000, qty: 2, total: 400000 }],
          resources: [{ id: 'r1', ql: 1, role: 'Project Manager', grade: '7', team: 'Insys - Cloud - SG', mandays: 510, dayRate: 980, total: 499800 }],
          billing: [{ id: 'b1', date: new Date().toISOString().slice(0, 10), schedule: 'Single billing', amount: 1000000 }],
        };
    // Demo note: a workbook we cannot parse is treated like the real system
    // treats an unknown template layout - the version is stored, but checks do
    // not run and MSPO generation is blocked (banner names the anchors).
    if (lv && !lv.layoutUnrecognised) {
      fallbackBase.products[0].qty += 10;
      fallbackBase.products[0].total = fallbackBase.products[0].qty * fallbackBase.products[0].unitCost;
      fallbackBase.header.productTotal = fallbackBase.products.reduce((a: number, p: { total: number }) => a + p.total, 0);
    }
    const { data, parsed } = await parseUpload(file, fallbackBase);
    const version: BcVersion = {
      v: (lv?.v ?? 0) + 1,
      uploadedBy: 'Felicia Phan',
      uploadedAt: new Date().toISOString(),
      fileName: file.name,
      documentUrl: URL.createObjectURL(file),
      comment: comment || undefined,
      parsedFromFile: parsed,
      layoutUnrecognised: parsed ? undefined : {
        missingAnchors: [
          'Sheet "Product Plan" with header row "Quote Line / Category / Description"',
          'Sheet "Resource Plan" with header row "Role / Grade / Team"',
        ],
      },
      data: parsed ? data : { header: { tcv: 0, productTotal: 0, labourTotal: 0, marginPct: 0, currency: 'SGD', durationMonths: 0, projectStart: new Date().toISOString().slice(0, 10) }, products: [], resources: [], billing: [] },
    };
    window.setTimeout(() => {
      dispatch({ type: 'upload-bc', tenderId: t.id, version });
      setUploading(null);
      setComment('');
      if (!parsed) {
        toast.push('warning', `Business case v${version.v} stored, layout not recognised`, 'The workbook does not match a known template layout. Final Check did not run and MSPO generation is blocked for this version.');
        return;
      }
      const f = failedChecks(runFinalChecks(data)).length;
      toast.push(
        f ? 'warning' : 'success',
        `Business case v${version.v} uploaded`,
        `Parsed in seconds (no AI pipeline) · ${f ? `${f} Final Check(s) failed - warnings only, nothing is blocked` : 'all Final Checks passed'}.`,
      );
    }, 1800);
  };

  return (
    <div className="bc-upload-action">
      {uploading ? (
        <ProgressStages
          stages={[
            { label: `Reading ${uploading}`, ms: 500 },
            { label: 'Parsing workbook tabs (Product Plan, Resource Plan, Basic Info)', ms: 700 },
            { label: 'Running Final Check rules', ms: 500 },
          ]}
        />
      ) : (
        <div className="bc-upload-row">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
            className="sr-only"
            aria-label="Upload Excel business case"
            onChange={(e) => { const f = e.target.files?.[0]; if (f && /\.(xlsx|xlsm)$/i.test(f.name)) setSelectedFile(f); e.target.value = ''; }}
          />
          <Button compact icon={FileUp} onClick={() => inputRef.current?.click()}>
            Upload Excel
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={!!selectedFile}
        title="Add business case comment"
        confirmLabel="Upload Excel"
        onClose={() => setSelectedFile(null)}
        onConfirm={() => {
          if (selectedFile) onFile(selectedFile);
          setSelectedFile(null);
        }}
      >
        <div className="hd-form">
          <label>
            Comment <span className="muted">(optional)</span>
            <input autoFocus type="text" value={comment} placeholder="What changed in this version" onChange={(e) => setComment(e.target.value)} />
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
}


// ---- Read-only DRB views -------------------------------------------------------
// The Deal Review Board sees two tabs: a Summary of the figures that drive the
// go/no-go decision, and the latest uploaded business case workbook itself.

/** Latest version the DRB can actually review (parseable layout). */
function drbVersion(t: Tender): BcVersion | undefined {
  return [...t.bcVersions].reverse().find((v) => !v.layoutUnrecognised);
}

export function DrbSummarySection({ t }: { t: Tender }) {
  const lv = drbVersion(t);
  const skipped = latest(t)?.layoutUnrecognised ? latest(t) : undefined;
  if (!lv) {
    return <EmptyState icon={Inbox} title="Nothing to review yet" body={t.bcVersions.length ? 'The only uploaded version could not be matched to a known template layout, so there is nothing the DRB can review yet.' : 'The summary appears once the BD team has uploaded a business case version.'} />;
  }
  const runs = runFinalChecks(lv.data);
  const failed = failedChecks(runs);
  const d = lv.data;
  // Figures for the decision: direct cost from the plans, indirect cost as the
  // template's 4% contingency (demo estimate), EBITDA as the remainder.
  const direct = d.header.productTotal + d.header.labourTotal;
  const indirect = Math.round(direct * 0.04);
  const ebitda = d.header.tcv - direct - indirect;
  const ebitdaPct = d.header.tcv ? (ebitda / d.header.tcv) * 100 : 0;

  return (
    <section>
      <p className="sub" style={{ marginBottom: 10 }}>
        Version {lv.v}, {checksLine(runs)} - uploaded by {lv.uploadedBy}, {ts(lv.uploadedAt)}
      </p>
      {skipped && (
        <Banner kind="warning">
          Version {skipped.v} (the newest upload) could not be matched to a known template layout,
          so this summary shows version {lv.v} instead.
        </Banner>
      )}
      <div className="kpi-row">
        <div className="kpi"><span>TCV (contract value)</span><b>{money(d.header.tcv)}</b></div>
        <div className="kpi"><span>Direct cost</span><b>{money(direct)}</b><div className="muted small">Product + internal labour</div></div>
        <div className="kpi"><span>Indirect cost</span><b>{money(indirect)}</b><div className="muted small">4% contingency (estimate)</div></div>
        <div className="kpi"><span>EBITDA</span><b className={ebitda >= 0 ? 'pos' : 'neg'}>{money(ebitda)}</b><div className="muted small">{pct(ebitdaPct)} of TCV</div></div>
        <div className="kpi"><span>Final Check</span><b className={failed.length ? 'neg' : 'pos'}>{failed.length ? `${failed.length} failed` : 'All passed'}</b></div>
      </div>
      <table className="grid narrow">
        <tbody>
          <tr><td>Project type</td><td>{t.projectType}</td></tr>
          <tr><td>Project start</td><td>{dateShort(d.header.projectStart)}</td></tr>
          <tr><td>Duration</td><td>{d.header.durationMonths} months</td></tr>
          <tr><td>Currency</td><td>{d.header.currency}</td></tr>
          <tr><td>Stated margin</td><td className="num">{pct(d.header.marginPct)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

export function DrbBcSection({ t }: { t: Tender }) {
  const lv = drbVersion(t);
  if (!lv) {
    return <EmptyState icon={Inbox} title="No business case to show yet" body="The workbook appears here once the BD team has uploaded a business case version." />;
  }
  const runs = lv.layoutUnrecognised ? [] : runFinalChecks(lv.data);
  return (
    <section>
      <p className="sub" style={{ marginBottom: 10 }}>
        Version {lv.v}, {checksLine(runs)} - uploaded by {lv.uploadedBy}, {ts(lv.uploadedAt)} · {lv.fileName}
      </p>
      <div className="drb-bc-viewer">
        <SpreadsheetDocumentViewer
          src={lv.documentUrl ?? '/mock-documents/MHA_business_case_demo.xlsm'}
          fileName={lv.fileName}
          initialSheet="Summary"
        />
      </div>
    </section>
  );
}

// Template and boilerplate libraries: agency templates (MHA and ATFM kept
// separate, generic fallbacks), certifications with issuer and expiry, and
// company boilerplate - each with upload (replace = new version), version
// history, preview, edit and delete. Only the latest version of an item is
// matched to tenders.

import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Eye, Pencil, Trash2 } from 'lucide-react';
import { canDo } from '../config';
import { dateShort } from '../lib/format';
import { useStore } from '../state/store';
import { SortTh, useColFilters, useSort } from '../components/common';
import { LibraryUpload, TagPicker, certProblems } from '../components/library';
import { BackToTender } from '../components/backToTender';
import { ConfirmDialog, IconButton, TabsBar } from '../ui/ui';
import { useToast } from '../ui/toast';
import { useCitation } from '../ui/citation';
import type { Boilerplate, LibraryVersion, TemplateDoc } from '../types';

type EditTarget =
  | { kind: 'template'; item: TemplateDoc }
  | { kind: 'boilerplate'; item: Boilerplate };
type DeleteTarget = EditTarget;

const LIB_ONLY = 'only the Bidding Manager and BD team manage the library';

export default function TemplatesPage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const { show } = useCitation();
  const editable = canDo.manageTemplates(state.role);
  const { sort, toggle, apply: applySort } = useSort();
  const filters = useColFilters();
  const certs = state.boilerplate.filter((b) => b.type === 'Certification');
  const backgrounds = state.boilerplate.filter((b) => b.type === 'Company background');
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // one sub-tab per library, so certificates and boilerplate are never buried
  // under a long template list
  // uploads from a tender land on the matching sub tab
  const [libTab, setLibTab] = useState(() => (state.nav?.page === 'templates' && state.nav.sub ? state.nav.sub : 'templates'));
  const [editForm, setEditForm] = useState({ name: '', version: '', expires: '', issuer: '', certNumber: '', issued: '', tags: [] as string[] });
  const editingCert = editing?.kind === 'boilerplate' && editing.item.type === 'Certification';
  const editProblems = [...(editForm.name.trim() ? [] : ['name']), ...(editingCert ? certProblems(editForm) : [])];

  const accessors = {
    name: (t: TemplateDoc) => t.name,
    agency: (t: TemplateDoc) => t.agency,
    type: (t: TemplateDoc) => t.type,
    version: (t: TemplateDoc) => t.version,
    uploadedBy: (t: TemplateDoc) => t.uploadedBy,
    updated: (t: TemplateDoc) => t.updated,
  };
  const filterColumn = (key: keyof typeof accessors) => ({
    filterValues: state.templates.map((t) => String(accessors[key](t))),
    filter: filters.filters[key],
    onFilter: (filter: Parameters<typeof filters.set>[1]) => filters.set(key, filter),
  });
  const templates = applySort(filters.apply(state.templates, accessors), accessors);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const toggleRow = (id: string) => setExpanded((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const previewTemplate = (t: TemplateDoc) => show({
    docId: t.id,
    title: t.name,
    fileName: `${t.name.replace(/\W+/g, '_')}.${t.type === 'Compliance table' ? 'xlsx' : 'docx'}`,
    documentUrl: t.type === 'Compliance table'
      ? '/mock-documents/MHA_business_case_demo.xlsm'
      : '/mock-documents/supplier-response.docx',
    similarity: 1,
    source: 'tender',
    tab: `${t.agency} · v${t.version}`,
    excerpt: '',
  });

  // certificates preview as PDF, boilerplate as a Word document - the same
  // viewers used everywhere else in the app
  const previewBoilerplate = (b: Boilerplate) => show({
    docId: b.id,
    title: b.name,
    fileName: `${b.name.replace(/\W+/g, '_')}.${b.type === 'Certification' ? 'pdf' : 'docx'}`,
    documentUrl: b.type === 'Certification'
      ? '/mock-documents/certificate-demo.pdf'
      : '/mock-documents/supplier-response.docx',
    similarity: 1,
    source: 'tender',
    tab: `v${b.version}`,
    excerpt: '',
  });

  /** Downloads one version of a library item (the demo serves a sample file). */
  const downloadVersion = (target: EditTarget, version: string) => {
    const isCert = target.kind === 'boilerplate' && target.item.type === 'Certification';
    const isSheet = target.kind === 'template' && target.item.type === 'Compliance table';
    const a = document.createElement('a');
    a.href = isCert ? '/mock-documents/certificate-demo.pdf' : isSheet ? '/mock-documents/MHA_business_case_demo.xlsm' : '/mock-documents/supplier-response.docx';
    a.download = `${target.item.name.replace(/\W+/g, '_').replace(/_+$/, '')}_v${version}.${isCert ? 'pdf' : isSheet ? 'xlsm' : 'docx'}`;
    a.click();
    dispatch({ type: 'log', event: { action: 'File downloaded', detail: `${target.item.name} v${version}`, section: 'Templates' } });
  };

  const openEdit = (target: EditTarget) => {
    setEditForm({
      name: target.item.name,
      version: target.item.version,
      expires: target.kind === 'boilerplate' ? (target.item.expires ?? '') : '',
      issuer: target.kind === 'boilerplate' ? (target.item.issuer ?? '') : '',
      certNumber: target.kind === 'boilerplate' ? (target.item.certNumber ?? '') : '',
      issued: target.kind === 'boilerplate' ? (target.item.issued ?? '') : '',
      tags: target.kind === 'boilerplate' ? (target.item.tags ?? []) : [],
    });
    setEditing(target);
  };

  const commitEdit = () => {
    if (!editing) return;
    if (editing.kind === 'template') {
      dispatch({ type: 'update-template', id: editing.item.id, patch: { name: editForm.name.trim(), version: editForm.version.trim(), updated: today } });
    } else {
      dispatch({
        type: 'update-boilerplate',
        id: editing.item.id,
        patch: editing.item.type === 'Certification'
          ? {
            name: editForm.name.trim(), version: editForm.version.trim(), updated: today,
            expires: editForm.expires, issuer: editForm.issuer.trim(),
            certNumber: editForm.certNumber.trim(), issued: editForm.issued,
          }
          : { name: editForm.name.trim(), version: editForm.version.trim(), updated: today, tags: editForm.tags.length ? editForm.tags : undefined },
      });
    }
    toast.push('success', 'Changes saved', `${editForm.name} updated.`);
    setEditing(null);
  };

  const commitDelete = () => {
    if (!deleting) return;
    if (deleting.kind === 'template') dispatch({ type: 'delete-template', id: deleting.item.id });
    else dispatch({ type: 'delete-boilerplate', id: deleting.item.id });
    toast.push('success', 'Deleted', `${deleting.item.name} was removed from the library.`);
    setDeleting(null);
  };

  const expiryCell = (expires?: string) => {
    if (!expires) return <span className="muted">-</span>;
    if (expires < today) {
      return <span className="attn"><AlertTriangle size={12} aria-hidden /> Expired {dateShort(expires)}</span>;
    }
    if (expires < soon) {
      return <span className="attn"><AlertTriangle size={12} aria-hidden /> Expires {dateShort(expires)}</span>;
    }
    return <span className="muted">{dateShort(expires)}</span>;
  };

  const expandCell = (id: string, name: string, history?: LibraryVersion[]) => (
    <td className="expand-cell">
      {history && history.length > 0 && (
        <button
          className="expand-btn"
          aria-expanded={expanded.has(id)}
          aria-label={`${expanded.has(id) ? 'Hide' : 'Show'} version history of ${name}`}
          onClick={() => toggleRow(id)}
        >
          {expanded.has(id) ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </button>
      )}
    </td>
  );

  /** Version history rows shown under an expanded item. */
  const historyRow = (id: string, colSpan: number, target: EditTarget, history?: LibraryVersion[]) =>
    expanded.has(id) && history?.length ? (
      <tr className="expand-row">
        <td />
        <td colSpan={colSpan - 1}>
          <div className="muted small" style={{ margin: '4px 0' }}>
            Version history (latest first) - only the latest version is matched to tenders:
          </div>
          <table className="grid narrow">
            <tbody>
              <tr>
                <td style={{ whiteSpace: 'nowrap' }}><b>v{target.item.version}</b> <span className="badge badge-human">Latest</span></td>
                <td className="muted">{dateShort(target.item.updated)} · {target.item.uploadedBy}</td>
                <td className="table-actions" style={{ width: 48 }}>
                  <IconButton label={`Download v${target.item.version}`} icon={Download} onClick={() => downloadVersion(target, target.item.version)} />
                </td>
              </tr>
              {history.map((h) => (
                <tr key={h.version}>
                  <td className="mono">v{h.version}</td>
                  <td className="muted">{dateShort(h.updated)} · {h.uploadedBy}</td>
                  <td className="table-actions" style={{ width: 48 }}>
                    <IconButton label={`Download v${h.version}`} icon={Download} onClick={() => downloadVersion(target, h.version)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </td>
      </tr>
    ) : null;

  const rowActions = (target: EditTarget, onPreview: () => void) => (
    <td className="table-actions" style={{ whiteSpace: 'nowrap' }}>
      <IconButton label={`Preview ${target.item.name}`} icon={Eye} onClick={onPreview} />
      <IconButton label={`Download ${target.item.name} v${target.item.version}`} icon={Download} onClick={() => downloadVersion(target, target.item.version)} />
      <IconButton label={`Edit ${target.item.name}`} icon={Pencil} disabled={!editable} reason={LIB_ONLY} onClick={() => openEdit(target)} />
      <IconButton label={`Delete ${target.item.name}`} icon={Trash2} danger disabled={!editable} reason={LIB_ONLY} onClick={() => setDeleting(target)} />
    </td>
  );

  /** Section heading: title (with an optional note right beside it) on the
   *  left, upload button on the right. */
  const heading = (title: string, upload: ReactNode, note?: ReactNode) => (
    <div className="section-heading lib-heading">
      <div className="heading-with-note">
        {title && <h3>{title}</h3>}
        {note}
      </div>
      {upload}
    </div>
  );

  const expiredCount = certs.filter((c) => c.expires && c.expires < today).length;

  return (
    <div>
      {state.returnTo && <div className="back-row"><BackToTender /></div>}
      <TabsBar
        tabs={[
          { key: 'templates', label: 'Templates' },
          { key: 'certs', label: 'Certifications', badge: expiredCount, badgeTitle: `${expiredCount} certification(s) expired` },
          { key: 'boilerplate', label: 'Boilerplate' },
        ]}
        active={libTab}
        onChange={setLibTab}
      />

      {libTab === 'templates' && (
        <section>
          {heading('', <LibraryUpload kind="template" />)}
          <table className="grid">
            <thead>
              <tr>
                <th aria-label="Expand" />
                <SortTh label="Name" k="name" sort={sort} onToggle={toggle} {...filterColumn('name')} />
                <SortTh label="Agency" k="agency" sort={sort} onToggle={toggle} {...filterColumn('agency')} />
                <SortTh label="Type" k="type" sort={sort} onToggle={toggle} {...filterColumn('type')} />
                <SortTh label="Version" k="version" sort={sort} onToggle={toggle} {...filterColumn('version')} />
                <SortTh label="Uploaded by" k="uploadedBy" sort={sort} onToggle={toggle} {...filterColumn('uploadedBy')} />
                <SortTh label="Last updated" k="updated" sort={sort} onToggle={toggle} {...filterColumn('updated')} />
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <Fragment key={t.id}>
                  <tr>
                    {expandCell(t.id, t.name, t.history)}
                    <td><b>{t.name}</b></td>
                    <td><span className="badge badge-sector">{t.agency}</span></td>
                    <td>{t.type}</td>
                    <td className="mono">v{t.version}</td>
                    <td className="muted">{t.uploadedBy}</td>
                    <td className="muted">{dateShort(t.updated)}</td>
                    {rowActions({ kind: 'template', item: t }, () => previewTemplate(t))}
                  </tr>
                  {historyRow(t.id, 8, { kind: 'template', item: t }, t.history)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {libTab === 'certs' && (
        <section>
          {heading(
            '',
            <LibraryUpload kind="certification" />,
            expiredCount > 0 ? (
              <span className="attn" role="status">
                <AlertTriangle size={13} aria-hidden /> {expiredCount} certification{expiredCount > 1 ? 's have' : ' has'} expired - renew and upload the new copy
              </span>
            ) : undefined,
          )}
          <table className="grid">
            <thead><tr><th aria-label="Expand" /><th>Certificate</th><th>Issuing body</th><th>Certificate number</th><th>Issue date</th><th>Expiry</th><th>Version</th><th>Uploaded by</th><th>Last updated</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {certs.map((b) => (
                <Fragment key={b.id}>
                  <tr>
                    {expandCell(b.id, b.name, b.history)}
                    <td><b>{b.name}</b></td>
                    <td>{b.issuer ?? <span className="muted">-</span>}</td>
                    <td className="mono small">{b.certNumber ?? <span className="muted">-</span>}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{b.issued ? dateShort(b.issued) : '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{expiryCell(b.expires)}</td>
                    <td className="mono">v{b.version}</td>
                    <td className="muted">{b.uploadedBy}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateShort(b.updated)}</td>
                    {rowActions({ kind: 'boilerplate', item: b }, () => previewBoilerplate(b))}
                  </tr>
                  {historyRow(b.id, 10, { kind: 'boilerplate', item: b }, b.history)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {libTab === 'boilerplate' && (
        <section>
          {heading('', <LibraryUpload kind="boilerplate" />)}
          <table className="grid">
            <thead><tr><th aria-label="Expand" /><th>Item</th><th>Tags</th><th>Version</th><th>Uploaded by</th><th>Last updated</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {backgrounds.map((b) => (
                <Fragment key={b.id}>
                  <tr>
                    {expandCell(b.id, b.name, b.history)}
                    <td><b>{b.name}</b></td>
                    <td>
                      {b.tags?.length
                        ? <span className="tag-list">{b.tags.map((tag) => <span key={tag} className="badge badge-neutral">{tag}</span>)}</span>
                        : <span className="muted">-</span>}
                    </td>
                    <td className="mono">v{b.version}</td>
                    <td className="muted">{b.uploadedBy}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateShort(b.updated)}</td>
                    {rowActions({ kind: 'boilerplate', item: b }, () => previewBoilerplate(b))}
                  </tr>
                  {historyRow(b.id, 7, { kind: 'boilerplate', item: b }, b.history)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <ConfirmDialog
        open={!!editing}
        title={`Edit ${editing?.item.name ?? ''}`}
        confirmLabel="Save changes"
        confirmDisabled={editProblems.length > 0}
        onClose={() => setEditing(null)}
        onConfirm={commitEdit}
      >
        <div className="hd-form">
          <label>Name<span className="req" aria-hidden>*</span><input value={editForm.name} autoFocus onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))} /></label>
          <label>Version<input value={editForm.version} onChange={(e) => setEditForm((c) => ({ ...c, version: e.target.value }))} /></label>
          {editingCert && (
            <>
              <label>Issuing body<span className="req" aria-hidden>*</span><input aria-required value={editForm.issuer} onChange={(e) => setEditForm((c) => ({ ...c, issuer: e.target.value }))} /></label>
              <label>Certificate number<span className="req" aria-hidden>*</span><input aria-required value={editForm.certNumber} onChange={(e) => setEditForm((c) => ({ ...c, certNumber: e.target.value }))} /></label>
              <label>Issue date<span className="req" aria-hidden>*</span><input type="date" aria-required value={editForm.issued} onChange={(e) => setEditForm((c) => ({ ...c, issued: e.target.value }))} /></label>
              <label>Expiry date<span className="req" aria-hidden>*</span><input type="date" aria-required value={editForm.expires} onChange={(e) => setEditForm((c) => ({ ...c, expires: e.target.value }))} /></label>
            </>
          )}
          {editing?.kind === 'boilerplate' && !editingCert && (
            <TagPicker value={editForm.tags} onChange={(tags) => setEditForm((c) => ({ ...c, tags }))} />
          )}
        </div>
        {editProblems.length > 0 && <p className="err small" role="alert">Please fill in: {editProblems.join(', ')}.</p>}
        <p className="muted small">Editing changes the details only. To store a new file, upload it under the same name - that creates a new version.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.item.name ?? ''}?`}
        confirmLabel="Delete from library"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={commitDelete}
      >
        <p>
          <b>{deleting?.item.name}</b> and its version history are removed from the library and can
          no longer be matched to tenders. Documents already generated from it are unaffected.
        </p>
      </ConfirmDialog>
    </div>
  );
}

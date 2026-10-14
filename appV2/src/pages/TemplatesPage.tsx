// Template and boilerplate libraries: agency templates (MHA and ATFM kept
// separate, generic fallbacks, MSPO plans), certifications with expiry and
// company boilerplate - each with upload, preview, edit and delete.

import { useState } from 'react';
import { AlertTriangle, Eye, FileUp, Pencil, Trash2 } from 'lucide-react';
import { canDo } from '../config';
import { dateShort } from '../lib/format';
import { useStore } from '../state/store';
import { SortTh, useColFilters, useSort } from '../components/common';
import { ConfirmDialog, IconButton } from '../ui/ui';
import { useToast } from '../ui/toast';
import { useCitation } from '../ui/citation';
import type { Boilerplate, TemplateDoc } from '../types';

type EditTarget =
  | { kind: 'template'; item: TemplateDoc }
  | { kind: 'boilerplate'; item: Boilerplate };
type DeleteTarget = EditTarget;

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
  const [editForm, setEditForm] = useState({ name: '', version: '', expires: '' });

  const tenderName = (id: string) => state.tenders.find((t) => t.id === id)?.ref || state.tenders.find((t) => t.id === id)?.name || id;
  const accessors = {
    name: (t: TemplateDoc) => t.name,
    agency: (t: TemplateDoc) => t.agency,
    type: (t: TemplateDoc) => t.type,
    version: (t: TemplateDoc) => t.version,
    updated: (t: TemplateDoc) => t.updated,
    usedBy: (t: TemplateDoc) => t.usedBy.map(tenderName).join(', '),
  };
  const filterColumn = (key: keyof typeof accessors) => ({
    filterValues: state.templates.map((t) => String(accessors[key](t))),
    filter: filters.filters[key],
    onFilter: (filter: Parameters<typeof filters.set>[1]) => filters.set(key, filter),
  });
  const templates = applySort(filters.apply(state.templates, accessors), accessors);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const uploadTemplate = (file: File | undefined) => {
    if (!file) return;
    const tpl: TemplateDoc = {
      id: `tpl-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      agency: 'Generic',
      type: 'Form',
      version: '1.0',
      updated: new Date().toISOString().slice(0, 10),
      usedBy: [],
    };
    dispatch({ type: 'add-template', tpl });
    toast.push('success', 'Template added', `${tpl.name} stored under ${tpl.agency} (demo - only the file name is used).`);
  };

  const uploadBoilerplate = (file: File | undefined, type: Boilerplate['type']) => {
    if (!file) return;
    const item: Boilerplate = {
      id: `bp-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      type,
      version: '1.0',
      owner: state.user?.name ?? 'BD team',
    };
    dispatch({ type: 'add-boilerplate', item });
    toast.push('success', `${type} added`, `${item.name} stored (demo - only the file name is used).`);
  };

  const previewTemplate = (t: TemplateDoc) => show({
    docId: t.id,
    title: t.name,
    fileName: `${t.name.replace(/\W+/g, '_')}.${t.type === 'Compliance table' || t.type === 'MSPO plan' ? 'xlsx' : 'docx'}`,
    documentUrl: t.type === 'Compliance table' || t.type === 'MSPO plan'
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

  const openEdit = (target: EditTarget) => {
    setEditForm({
      name: target.item.name,
      version: target.item.version,
      expires: target.kind === 'boilerplate' ? (target.item.expires ?? '') : '',
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
        patch: { name: editForm.name.trim(), version: editForm.version.trim(), expires: editForm.expires || undefined },
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

  const rowActions = (target: EditTarget, onPreview: () => void) => (
    <td className="table-actions" style={{ whiteSpace: 'nowrap' }}>
      <IconButton label={`Preview ${target.item.name}`} icon={Eye} onClick={onPreview} />
      {editable && <IconButton label={`Edit ${target.item.name}`} icon={Pencil} onClick={() => openEdit(target)} />}
      {editable && <IconButton label={`Delete ${target.item.name}`} icon={Trash2} danger onClick={() => setDeleting(target)} />}
    </td>
  );

  const uploadButton = (label: string, onFile: (f: File | undefined) => void) =>
    editable ? (
      <label className="btn btn-secondary btn-compact" style={{ cursor: 'pointer' }}>
        <FileUp size={14} aria-hidden /> {label}
        <input type="file" className="sr-only" aria-label={label} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
    ) : null;

  return (
    <div>
      <section>
        <div className="section-heading">
          <h3>Templates</h3>
          {uploadButton('Upload template', uploadTemplate)}
        </div>
        <table className="grid">
          <thead>
            <tr>
              <SortTh label="Name" k="name" sort={sort} onToggle={toggle} {...filterColumn('name')} />
              <SortTh label="Agency" k="agency" sort={sort} onToggle={toggle} {...filterColumn('agency')} />
              <SortTh label="Type" k="type" sort={sort} onToggle={toggle} {...filterColumn('type')} />
              <SortTh label="Version" k="version" sort={sort} onToggle={toggle} {...filterColumn('version')} />
              <SortTh label="Last updated" k="updated" sort={sort} onToggle={toggle} {...filterColumn('updated')} />
              <SortTh label="Used by" k="usedBy" sort={sort} onToggle={toggle} {...filterColumn('usedBy')} />
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td><b>{t.name}</b></td>
                <td><span className="badge badge-sector">{t.agency}</span></td>
                <td>{t.type}</td>
                <td className="mono">v{t.version}</td>
                <td className="muted">{dateShort(t.updated)}</td>
                <td className="muted small">{t.usedBy.length ? t.usedBy.map(tenderName).join(', ') : '-'}</td>
                {rowActions({ kind: 'template', item: t }, () => previewTemplate(t))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="two-col">
        <section>
          <div className="section-heading">
            <h3>Certifications</h3>
            {certs.some((c) => c.expires && c.expires < today) && (
              <span className="attn" role="status">
                <AlertTriangle size={13} aria-hidden /> At least one certification has expired - renew and upload the new copy
              </span>
            )}
            {uploadButton('Upload certification', (f) => uploadBoilerplate(f, 'Certification'))}
          </div>
          <table className="grid">
            <thead><tr><th>Certificate</th><th>Version</th><th>Expiry</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {certs.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.name}</b></td>
                  <td className="mono">v{b.version}</td>
                  <td>{expiryCell(b.expires)}</td>
                  {rowActions({ kind: 'boilerplate', item: b }, () => previewBoilerplate(b))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <div className="section-heading">
            <h3>Company boilerplate</h3>
            {uploadButton('Upload boilerplate', (f) => uploadBoilerplate(f, 'Company background'))}
          </div>
          <table className="grid">
            <thead><tr><th>Item</th><th>Version</th><th>Owner</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {backgrounds.map((b) => (
                <tr key={b.id}>
                  <td><b>{b.name}</b></td>
                  <td className="mono">v{b.version}</td>
                  <td className="muted">{b.owner}</td>
                  {rowActions({ kind: 'boilerplate', item: b }, () => previewBoilerplate(b))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <ConfirmDialog
        open={!!editing}
        title={`Edit ${editing?.item.name ?? ''}`}
        confirmLabel="Save changes"
        confirmDisabled={!editForm.name.trim()}
        onClose={() => setEditing(null)}
        onConfirm={commitEdit}
      >
        <div className="hd-form">
          <label>Name<input value={editForm.name} autoFocus onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))} /></label>
          <label>Version<input value={editForm.version} onChange={(e) => setEditForm((c) => ({ ...c, version: e.target.value }))} /></label>
          {editing?.kind === 'boilerplate' && editing.item.type === 'Certification' && (
            <label>Expiry date<input type="date" value={editForm.expires} onChange={(e) => setEditForm((c) => ({ ...c, expires: e.target.value }))} /></label>
          )}
        </div>
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
          <b>{deleting?.item.name}</b> is removed from the library and can no longer be matched to
          tenders. Documents already generated from it are unaffected.
        </p>
      </ConfirmDialog>
    </div>
  );
}

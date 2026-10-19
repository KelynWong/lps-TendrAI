// Library uploads (templates, certifications, boilerplate). One component is
// used everywhere an upload is offered, so the Templates page and a tender's
// Submission tab behave identically: drop one or more files, fill in what the
// system cannot know for each (name, agency, type, expiry, version), and if an
// item with the same name exists, the file replaces it - the old version moves
// to version history and the version number increases.

import { useState } from 'react';
import { AlertTriangle, FileUp } from 'lucide-react';
import { canDo } from '../config';
import { useStore, type ReturnTarget } from '../state/store';
import { useToast } from '../ui/toast';
import { UploadDialog, type StagedFile } from './upload';
import type { Agency, Boilerplate, TemplateDoc } from '../types';

export type LibraryKind = 'template' | 'certification' | 'boilerplate';

const TEMPLATE_TYPES: TemplateDoc['type'][] = ['Compliance table', 'Cover letter', 'Company profile', 'Form', 'Document formatting'];
const AGENCIES: Agency[] = ['MHA', 'ATFM', 'Generic'];
const KIND_LABEL: Record<LibraryKind, string> = { template: 'template', certification: 'certification', boilerplate: 'boilerplate' };

/** Next version: bump the last numeric segment ("3.1" -> "3.2", "2026" -> "2027"). */
export function bumpVersion(v: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(v.trim());
  return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : `${v}.1`;
}

interface FileForm {
  name: string;
  agency: Agency;
  type: TemplateDoc['type'];
  /** undefined = use the suggested version */
  version?: string;
  expires: string;
}

const nameFromFile = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

export function LibraryUpload({ kind, compact = true, returnTo }: { kind: LibraryKind; compact?: boolean; returnTo?: ReturnTarget }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const editable = canDo.manageTemplates(state.role);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [forms, setForms] = useState<Record<string, FileForm>>({});
  const label = `Upload ${KIND_LABEL[kind]}`;
  const today = new Date().toISOString().slice(0, 10);
  const who = state.user?.name ?? 'Unknown';

  /** Form for a staged file, created on first use from the file name. A file
   *  named like an existing template prefills that template's agency and type. */
  const formFor = (f: StagedFile): FileForm => {
    if (forms[f.key]) return forms[f.key];
    const name = nameFromFile(f.file);
    const match = kind === 'template' ? state.templates.find((x) => x.name.toLowerCase() === name.toLowerCase()) : undefined;
    return { name, agency: match?.agency ?? 'Generic', type: match?.type ?? 'Form', expires: '' };
  };
  const update = (f: StagedFile, patch: Partial<FileForm>) =>
    setForms((cur) => ({ ...cur, [f.key]: { ...formFor(f), ...patch } }));

  const existingFor = (form: FileForm) => {
    const n = form.name.trim().toLowerCase();
    if (!n) return undefined;
    if (kind === 'template') return state.templates.find((x) => x.name.toLowerCase() === n && x.agency === form.agency);
    const type = kind === 'certification' ? 'Certification' : 'Company background';
    return state.boilerplate.find((x) => x.type === type && x.name.toLowerCase() === n);
  };
  const versionFor = (form: FileForm) => form.version ?? (existingFor(form) ? bumpVersion(existingFor(form)!.version) : '1.0');

  const problemsFor = (form: FileForm): string[] => {
    const p: string[] = [];
    if (!form.name.trim()) p.push('name');
    if (!versionFor(form).trim()) p.push('version');
    if (kind === 'certification' && !form.expires) p.push('expiry date');
    const ex = existingFor(form);
    if (ex && versionFor(form).trim() === ex.version) p.push(`a version other than the current v${ex.version}`);
    return p;
  };
  // two files in one upload must not target the same library item
  const names = files.map((f) => formFor(f).name.trim().toLowerCase());
  const duplicateInBatch = names.some((n, i) => n && names.indexOf(n) !== i);
  const invalid = files.some((f) => problemsFor(formFor(f)).length > 0) || duplicateInBatch;

  const confirm = (staged: StagedFile[]) => {
    let replaced = 0;
    for (const f of staged) {
      const form = formFor(f);
      const existing = existingFor(form);
      const version = versionFor(form).trim();
      if (existing) replaced += 1;
      if (kind === 'template') {
        const tpl: TemplateDoc = {
          id: `tpl-${Date.now()}-${f.key}`, name: form.name.trim(), agency: form.agency,
          // a replacement keeps the existing item's type; only the version moves on
          type: existing ? (existing as TemplateDoc).type : form.type,
          version, updated: today, uploadedBy: who, usedBy: [],
        };
        dispatch({ type: 'upload-template', tpl, replaceId: existing?.id });
      } else {
        const item: Boilerplate = {
          id: `bp-${Date.now()}-${f.key}`, name: form.name.trim(),
          type: kind === 'certification' ? 'Certification' : 'Company background',
          version, owner: who, uploadedBy: who, updated: today,
          expires: kind === 'certification' ? form.expires : undefined,
        };
        dispatch({ type: 'upload-boilerplate', item, replaceId: existing?.id });
      }
    }
    const added = staged.length - replaced;
    toast.push(
      'success',
      `${staged.length} ${KIND_LABEL[kind]}${staged.length > 1 ? 's' : ''} uploaded`,
      [added && `${added} added`, replaced && `${replaced} replaced (previous versions kept in version history)`].filter(Boolean).join('; ') + '. Only the latest version is matched to tenders.',
    );
    setOpen(false);
    setForms({});
    // uploaded from inside a tender: show the item in the library, with a way back
    if (returnTo) dispatch({ type: 'go-to', page: 'templates', sub: kind === 'template' ? 'templates' : kind === 'certification' ? 'certs' : 'boilerplate', returnTo });
  };

  if (!editable) {
    return (
      <button type="button" className={`btn btn-secondary ${compact ? 'btn-compact' : ''}`} disabled title={`Only the Bidding Manager and BD team upload ${KIND_LABEL[kind]}s`}>
        <FileUp size={compact ? 14 : 16} aria-hidden /> {label}
      </button>
    );
  }

  const fields = (f: StagedFile) => {
    const form = formFor(f);
    const existing = existingFor(form);
    const problems = problemsFor(form);
    return (
      <>
        <div className="hd-form">
          <label>Name<span className="req" aria-hidden>*</span>
            <input aria-required value={form.name} onChange={(e) => update(f, { name: e.target.value })} />
          </label>
          {kind === 'template' && (
            <>
              <label>Agency<span className="req" aria-hidden>*</span>
                <select value={form.agency} aria-required onChange={(e) => update(f, { agency: e.target.value as Agency })}>
                  {AGENCIES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
              <label>Type<span className="req" aria-hidden>*</span>
                <select value={existing && kind === 'template' ? (existing as TemplateDoc).type : form.type} aria-required disabled={!!existing} onChange={(e) => update(f, { type: e.target.value as TemplateDoc['type'] })}>
                  {TEMPLATE_TYPES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
            </>
          )}
          {kind === 'certification' && (
            <label>Expiry date<span className="req" aria-hidden>*</span>
              <input type="date" aria-required value={form.expires} onChange={(e) => update(f, { expires: e.target.value })} />
            </label>
          )}
          <label>Version<span className="req" aria-hidden>*</span>
            <input aria-required value={versionFor(form)} onChange={(e) => update(f, { version: e.target.value })} />
          </label>
        </div>
        {existing && (
          <div className="ref-issue" role="status">
            <AlertTriangle size={13} aria-hidden /> Replaces <b>{existing.name}</b> v{existing.version}: the current
            version moves to version history and this file becomes v{versionFor(form)}. Only the
            latest version is matched to tenders.
          </div>
        )}
        {problems.length > 0 && <p className="err small" role="alert" style={{ margin: '6px 0 0' }}>Please fill in: {problems.join(', ')}.</p>}
      </>
    );
  };

  return (
    <>
      <button type="button" className={`btn btn-secondary ${compact ? 'btn-compact' : ''}`} onClick={() => { setForms({}); setOpen(true); }}>
        <FileUp size={compact ? 14 : 16} aria-hidden /> {label}
      </button>
      <UploadDialog
        open={open}
        title={label}
        multiple
        hint={kind === 'certification' ? 'PDF certificates. Each file needs its expiry date.' : 'Word, Excel or PDF. Fill in the details for each file below.'}
        confirmLabel="Confirm upload"
        confirmDisabled={invalid}
        renderFileFields={fields}
        extra={duplicateInBatch ? <p className="err small" role="alert">Two files in this upload have the same name - each must be a different item.</p> : undefined}
        onFilesChange={setFiles}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
      />
    </>
  );
}

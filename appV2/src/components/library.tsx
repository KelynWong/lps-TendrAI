// Library uploads (templates, certifications, boilerplate). One component is
// used everywhere an upload is offered, so the Templates page and a tender's
// Submission tab behave identically: drop one or more files, fill in what the
// system cannot know for each (name, agency, type, expiry, version), and if an
// item with the same name exists, the file replaces it - the old version moves
// to version history and the version number increases.

import { useId, useRef, useState } from 'react';
import { AlertTriangle, FileUp, Plus, X } from 'lucide-react';
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
  /** certification details */
  issuer: string;
  certNumber: string;
  issued: string;
  /** boilerplate tags */
  tags: string[];
}

/** Certificate details are all compulsory; shared by upload and edit. */
export function certProblems(c: { issuer: string; certNumber: string; issued: string; expires: string }): string[] {
  const p: string[] = [];
  if (!c.issuer.trim()) p.push('issuing body');
  if (!c.certNumber.trim()) p.push('certificate number');
  if (!c.issued) p.push('issue date');
  if (!c.expires) p.push('expiry date');
  if (c.issued && c.expires && c.expires <= c.issued) p.push('an expiry date after the issue date');
  return p;
}

const nameFromFile = (f: File) => f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

/** Multi-select for boilerplate tags: pick from the shared list, or type a new
 *  tag and press Enter - it is added to the list when the item is saved. */
export function TagPicker({ value, onChange, required }: { value: string[]; onChange: (tags: string[]) => void; required?: boolean }) {
  const { state } = useStore();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = query.trim();
  const has = (list: string[], t: string) => list.some((x) => x.toLowerCase() === t.toLowerCase());
  const options = state.boilerplateTags.filter((t) => !has(value, t) && t.toLowerCase().includes(q.toLowerCase()));
  const creatable = q && !has(state.boilerplateTags, q) && !has(value, q);
  const items = creatable ? [...options, q] : options;
  const add = (tag: string) => {
    // a typed tag that matches the list uses the list's spelling
    const known = state.boilerplateTags.find((x) => x.toLowerCase() === tag.toLowerCase()) ?? tag;
    if (!has(value, known)) onChange([...value, known]);
    setQuery('');
    setActive(0);
  };
  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' || e.key === ',') {
      if (!q && e.key === ',') return;
      e.preventDefault();
      if (open && items[active]) add(items[active]);
      else if (q) add(q);
    } else if (e.key === 'Backspace' && !query && value.length) remove(value[value.length - 1]);
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="tag-field">
      <label htmlFor={id}>Tags{required && <span className="req" aria-hidden>*</span>}</label>
      <div className="tag-picker" onClick={() => inputRef.current?.focus()}>
        {value.map((tag) => (
          <span key={tag} className="badge badge-neutral tag-chip">
            {tag}
            <button type="button" aria-label={`Remove tag ${tag}`} onClick={(e) => { e.stopPropagation(); remove(tag); }}>
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-required={required}
          aria-activedescendant={open && items[active] ? `${id}-opt-${active}` : undefined}
          value={query}
          placeholder={value.length ? '' : 'Choose tags or type a new one'}
          onChange={(e) => { setQuery(e.target.value.replace(',', '')); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && items.length > 0 && (
        <ul className="tag-menu" role="listbox" id={`${id}-list`} aria-label="Tags">
          {items.map((tag, i) => (
            <li
              key={tag}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              // mousedown, so the input keeps focus and the menu stays open
              onMouseDown={(e) => { e.preventDefault(); add(tag); }}
              onMouseEnter={() => setActive(i)}
            >
              {creatable && i === items.length - 1
                ? <><Plus size={12} aria-hidden /> Add new tag "<b>{tag}</b>"</>
                : tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
    // a replacement starts from the current item's details
    const prior = kind === 'template' ? undefined : state.boilerplate.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return {
      name, agency: match?.agency ?? 'Generic', type: match?.type ?? 'Form', expires: '',
      issuer: prior?.issuer ?? '', certNumber: prior?.certNumber ?? '', issued: '',
      tags: prior?.tags ?? [],
    };
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
    if (kind === 'certification') p.push(...certProblems(form));
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
          issuer: kind === 'certification' ? form.issuer.trim() || undefined : undefined,
          certNumber: kind === 'certification' ? form.certNumber.trim() || undefined : undefined,
          issued: kind === 'certification' ? form.issued || undefined : undefined,
          tags: kind === 'boilerplate' && form.tags.length ? form.tags : undefined,
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
        <div className={`hd-form${kind === 'boilerplate' ? ' hd-form-halves' : ''}`}>
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
            <>
              <label>Issuing body<span className="req" aria-hidden>*</span>
                <input aria-required value={form.issuer} placeholder="e.g. TUV SUD PSB" onChange={(e) => update(f, { issuer: e.target.value })} />
              </label>
              <label>Certificate number<span className="req" aria-hidden>*</span>
                <input aria-required value={form.certNumber} onChange={(e) => update(f, { certNumber: e.target.value })} />
              </label>
              <label>Issue date<span className="req" aria-hidden>*</span>
                <input type="date" aria-required value={form.issued} onChange={(e) => update(f, { issued: e.target.value })} />
              </label>
              <label>Expiry date<span className="req" aria-hidden>*</span>
                <input type="date" aria-required value={form.expires} onChange={(e) => update(f, { expires: e.target.value })} />
              </label>
            </>
          )}
          <label>Version<span className="req" aria-hidden>*</span>
            <input aria-required value={versionFor(form)} onChange={(e) => update(f, { version: e.target.value })} />
          </label>
          {/* boilerplate: name and version share the first row, tags span the next */}
          {kind === 'boilerplate' && (
            <TagPicker value={form.tags} onChange={(tags) => update(f, { tags })} />
          )}
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
        hint={kind === 'certification' ? 'PDF certificates. Each file needs its issuing body, certificate number, issue date and expiry date.' : 'Word, Excel or PDF. Fill in the details for each file below.'}
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

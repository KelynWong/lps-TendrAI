// One upload experience for the whole app. A button opens a dialog with a
// drag-and-drop area; each added file shows an upload animation, then sits in
// a list with its size, a remove button and any extra details it needs. The
// user confirms once everything is right. Uploads are simulated in the demo
// (only the file name and size are used).

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, FileText, FileUp, Loader2, X } from 'lucide-react';
import { Banner, ConfirmDialog, IconButton } from '../ui/ui';

export interface StagedFile {
  key: string;
  file: File;
  /** 0-100 while uploading; 100 when stored */
  progress: number;
}

export const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

let seq = 0;

export function UploadDialog({
  open,
  title,
  multiple = true,
  accept,
  hint,
  confirmLabel,
  confirmDisabled,
  renderFileFields,
  extra,
  onClose,
  onConfirm,
  onFilesChange,
  rejectFile,
}: {
  open: boolean;
  title: string;
  multiple?: boolean;
  accept?: string;
  /** one line under the drop area, e.g. accepted formats */
  hint?: string;
  confirmLabel: string;
  /** extra validation from the caller (per-file fields, comments) */
  confirmDisabled?: boolean;
  /** details captured per file (rendered under the file's row) */
  renderFileFields?: (f: StagedFile) => ReactNode;
  /** details captured once for the whole upload */
  extra?: ReactNode;
  onClose: () => void;
  onConfirm: (files: StagedFile[]) => void;
  onFilesChange?: (files: StagedFile[]) => void;
  /** why a file cannot be added (e.g. already uploaded), else undefined */
  rejectFile?: (file: File) => string | undefined;
}) {
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setFiles([]); setRejected([]); } }, [open]);
  useEffect(() => { onFilesChange?.(files); }, [files, onFilesChange]);

  // simulated transfer: bigger files take a little longer
  const uploading = files.some((f) => f.progress < 100);
  useEffect(() => {
    if (!uploading) return;
    const timer = window.setInterval(() => {
      setFiles((cur) => cur.map((f) => (f.progress >= 100 ? f : {
        ...f,
        progress: Math.min(100, f.progress + Math.max(8, 40 - Math.log2(f.file.size + 2) * 1.5)),
      })));
    }, 120);
    return () => window.clearInterval(timer);
  }, [uploading]);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    // the same file (name and size) can only be added once
    const same = (a: File, b: File) => a.name === b.name && a.size === b.size;
    const errors: string[] = [];
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      const reason = rejectFile?.(file)
        ?? (multiple && (files.some((f) => same(f.file, file)) || accepted.some((a) => same(a, file)))
          ? 'it is already in the list below' : undefined);
      if (reason) errors.push(`${file.name} (${formatSize(file.size)}) was not added: ${reason}.`);
      else accepted.push(file);
    }
    setRejected(errors);
    const incoming = accepted.map((file) => ({ key: `f${++seq}`, file, progress: 0 }));
    if (incoming.length) setFiles((cur) => (multiple ? [...cur, ...incoming] : incoming.slice(0, 1)));
  };
  const remove = (key: string) => setFiles((cur) => cur.filter((f) => f.key !== key));

  return (
    <ConfirmDialog
      open={open}
      wide
      title={title}
      confirmLabel={confirmLabel}
      confirmDisabled={!files.length || uploading || !!confirmDisabled}
      onClose={onClose}
      onConfirm={() => onConfirm(files)}
    >
      {(multiple || files.length === 0) && (
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`Drag and drop ${multiple ? 'files' : 'a file'} here, or click to open the file browser`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
        >
          <div className="dropzone-action">
            <FileUp size={22} aria-hidden />
            <span>Drag and drop {multiple ? 'files' : 'a file'} here, or click to open the file browser</span>
            {hint && <span className="muted small">{hint}</span>}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple={multiple}
            accept={accept}
            className="sr-only"
            aria-label={multiple ? 'Choose files to upload' : 'Choose a file to upload'}
            onChange={(e) => { add(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}

      {rejected.length > 0 && (
        <Banner kind="error">
          <b>Duplicate file.</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{rejected.map((r) => <li key={r}>{r}</li>)}</ul>
        </Banner>
      )}

      {files.length > 0 && (
        <ul className="upload-list" aria-live="polite">
          {files.map((f) => (
            <li key={f.key} className="upload-item">
              <div className="upload-item-head">
                <FileText size={16} aria-hidden className="upload-item-icon" />
                <span className="upload-item-name" title={f.file.name}>{f.file.name}</span>
                <span className="muted small">{formatSize(f.file.size)}</span>
                {f.progress < 100 ? (
                  <span className="muted small upload-item-state"><Loader2 size={14} aria-hidden className="spin-icon" /> Uploading</span>
                ) : (
                  <span className="ok small upload-item-state"><CheckCircle2 size={14} aria-hidden /> Uploaded</span>
                )}
                <IconButton label={`Remove ${f.file.name}`} icon={X} onClick={() => remove(f.key)} />
              </div>
              {f.progress < 100 && (
                <div className="upload-progress-track" role="progressbar" aria-label={`Uploading ${f.file.name}`} aria-valuenow={Math.round(f.progress)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="upload-progress-bar" style={{ width: `${f.progress}%` }} />
                </div>
              )}
              {f.progress >= 100 && renderFileFields && <div className="upload-item-fields">{renderFileFields(f)}</div>}
            </li>
          ))}
        </ul>
      )}

      {extra}
    </ConfirmDialog>
  );
}

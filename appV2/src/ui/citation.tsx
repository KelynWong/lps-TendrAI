/* eslint-disable react-refresh/only-export-components */
// Clicking a citation opens the source document with the extracted passage highlighted.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, FileSearch, FileText, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { UDocClient } from '@docmentis/udoc-viewer';

export interface CitationInfo {
  docId: string;
  title: string;
  similarity: number;
  excerpt: string;
  /** which figure the citation grounds, e.g. "Omnichannel CCaaS subscription" */
  context?: string;
  /** 'tender' = extracted directly from the uploaded tender document */
  source?: 'historical' | 'tender';
  /** the matching requirement passage in the uploaded tender document */
  tenderExcerpt?: string;
  /** set when a person confirmed the cited value (badge is Confirmed) */
  confirmedBy?: string;
  /** true when the person changed the value after it was cited */
  edited?: boolean;
  /** business-case tab the cited figure lives on (Product Plan / Resource Plan) */
  tab?: string;
  /** cited page and the document's page count (enables page navigation) */
  page?: number;
  pageCount?: number;
  fileName?: string;
  references?: Array<{ location: string; excerpt: string }>;
  /** sentences immediately before / after the cited passage, for context */
  contextBefore?: string[];
  contextAfter?: string[];
  /** Local demo path now; replace with a backend document URL later. */
  documentUrl?: string;
}

/** The uploaded tender document this business case was generated from. */
export interface TenderDocInfo {
  ref: string;
  title: string;
  fileName: string;
}

// Default is a no-op so badges outside the provider degrade gracefully
const Ctx = createContext<{ show: (c: CitationInfo) => void }>({ show: () => {} });

export function useCitation() {
  return useContext(Ctx);
}

/** PDF / Word viewer. After loading it searches for the cited passage and
 *  highlights it in place (the viewer scrolls to the match); if the passage
 *  cannot be found it opens at the cited page instead. `onLocated` reports
 *  which of the two happened. */
function LocalDocumentViewer({
  src, page, find, onLocated,
}: {
  src: string;
  page?: number;
  find?: string;
  onLocated?: (how: 'match' | 'page' | 'none', pageCount: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let client: Awaited<ReturnType<typeof UDocClient.create>> | undefined;
    let viewer: Awaited<ReturnType<NonNullable<typeof client>['createViewer']>> | undefined;
    let cancelled = false;
    setError('');
    (async () => {
      try {
        client = await UDocClient.create({ disableTelemetry: true, disableUpdateCheck: true });
        if (cancelled || !containerRef.current) return;
        viewer = await client.createViewer({ container: containerRef.current, scrollMode: 'continuous' });
        await viewer.load(src);
        if (cancelled) return;
        const pages = viewer.pageCount;
        if (find && find.trim().length > 8) {
          // search a distinctive slice of the passage; fuzzy tolerates spacing differences
          const query = find.trim().slice(0, 80);
          const matches = await viewer.search(query, { fuzzy: true });
          if (cancelled) return;
          if (matches.length) {
            viewer.searchNext();
            onLocated?.('match', pages);
            return;
          }
        }
        if (page && pages > 0) {
          viewer.goToPage(Math.min(page, pages));
          onLocated?.('page', pages);
        } else {
          onLocated?.('none', pages);
        }
      } catch (reason: unknown) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to render document');
      }
    })();
    return () => {
      cancelled = true;
      viewer?.destroy();
      client?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, page, find]);
  if (error) return <p className="error docx-error">{error}</p>;
  return <div className="udoc-viewer" ref={containerRef} aria-label="Document viewer" />;
}

/** The cited passage with a few sentences of surrounding text. */
function PassageWithContext({
  location, excerpt, before, after, markRef,
}: {
  location: string;
  excerpt: string;
  before?: string[];
  after?: string[];
  markRef?: React.Ref<HTMLElement>;
}) {
  return (
    <div className="docviewer-excerpt">
      <div className="muted small" style={{ marginBottom: 4 }}><b>Extracted passage · {location}</b></div>
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        {before?.length ? <span className="cite-context">{before.join(' ')} </span> : null}
        <mark className="match" ref={markRef}>{excerpt}</mark>
        {after?.length ? <span className="cite-context"> {after.join(' ')}</span> : null}
      </p>
    </div>
  );
}

export function SpreadsheetDocumentViewer({ src, fileName, initialSheet }: { src: string; fileName: string; initialSheet?: string }) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setWorkbook(null);
    setActiveSheet('');
    setError('');
    (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Unable to load ${fileName}`);
        const sourceBuffer = await response.arrayBuffer();
        const loaded = XLSX.read(sourceBuffer, { type: 'array', bookVBA: /\.xlsm$/i.test(fileName) });
        if (!cancelled) {
          setWorkbook(loaded);
          // open the cited tab when it exists in the workbook
          const wanted = initialSheet
            ? loaded.SheetNames.find((s) => s.toLowerCase() === initialSheet.toLowerCase())
              ?? loaded.SheetNames.find((s) => s.toLowerCase().includes(initialSheet.toLowerCase()))
            : undefined;
          setActiveSheet(wanted ?? loaded.SheetNames[0] ?? '');
        }
      } catch (reason: unknown) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to render workbook');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileName, src, initialSheet]);
  if (error) return <p className="error docx-error">{error}</p>;
  if (!workbook) return <p className="muted small">Loading workbook...</p>;
  const sheet = workbook.Sheets[activeSheet];
  const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) : [];
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  return (
    <div className="spreadsheet-viewer">
      <div className="spreadsheet-grid-scroll">
        <table className="spreadsheet-grid">
          <thead>
            <tr>
              <th className="spreadsheet-corner" aria-hidden />
              {Array.from({ length: columnCount }, (_, columnIndex) => (
                <th key={columnIndex} scope="col">{XLSX.utils.encode_col(columnIndex)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${activeSheet}-${rowIndex}`}>
                <th scope="row">{rowIndex + 1}</th>
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <td key={columnIndex}>{String(row[columnIndex] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="spreadsheet-tabs" role="tablist" aria-label="Workbook sheets">
        {workbook.SheetNames.map((sheetName) => (
          <button
            className={`spreadsheet-tab${sheetName === activeSheet ? ' active' : ''}`}
            key={sheetName}
            role="tab"
            aria-selected={sheetName === activeSheet}
            type="button"
            onClick={() => setActiveSheet(sheetName)}
          >
            {sheetName}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Single-document viewer with the cited passage highlighted. Sized to 70% of
 *  the viewport (min 720px, full width on small screens), scrolls internally,
 *  traps focus while open and supports page navigation for paged sources. */
function DocumentViewer({ citation, onClose }: { citation: CitationInfo; onClose: () => void }) {
  const isTender = citation.source === 'tender';
  const extension = (citation.fileName ?? citation.documentUrl)?.split('.').pop()?.toLowerCase();
  const markRef = useRef<HTMLElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pageCount = citation.pageCount ?? (citation.page ? Math.max(citation.page + 3, 8) : undefined);
  const [curPage, setCurPage] = useState(citation.page ?? 1);
  const [pageField, setPageField] = useState(String(citation.page ?? 1));
  const paged = !!citation.page && !citation.documentUrl; // mock page renderer only
  const [located, setLocated] = useState('');
  useEffect(() => { setCurPage(citation.page ?? 1); setPageField(String(citation.page ?? 1)); }, [citation]);
  useEffect(() => { markRef.current?.scrollIntoView({ block: 'center' }); }, [citation, curPage]);

  // focus trap: focus moves into the dialog and cycles within it
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = box.querySelectorAll<HTMLElement>('button, input, [href], select');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const goToPage = (p: number) => {
    if (!pageCount) return;
    const next = Math.max(1, Math.min(pageCount, p));
    setCurPage(next);
    setPageField(String(next));
  };

  return (
    <div className="docviewer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="docviewer" role="dialog" aria-modal="true" aria-label={isTender ? 'Tender document source' : 'Business case source'} ref={boxRef}>
        <div className="docviewer-head">
          <FileSearch size={16} aria-hidden /><b>{citation.fileName ?? citation.title}</b>
          <span className="muted small">
            {citation.context ? `${citation.context} · ` : ''}
            {citation.tab ?? ''}
          </span>
          {paged && pageCount && (
            <span className="docviewer-pagenav">
              <button className="btn btn-compact" aria-label="Previous page" title="Previous page" disabled={curPage <= 1} onClick={() => goToPage(curPage - 1)}><ChevronLeft size={14} aria-hidden /></button>
              <label className="muted small docviewer-goto">
                Page
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Go to page"
                  value={pageField}
                  onChange={(e) => setPageField(e.target.value)}
                  onBlur={() => goToPage(parseInt(pageField, 10) || curPage)}
                  onKeyDown={(e) => { if (e.key === 'Enter') goToPage(parseInt(pageField, 10) || curPage); }}
                />
                of {pageCount}
              </label>
              <button className="btn btn-compact" aria-label="Next page" title="Next page" disabled={curPage >= pageCount} onClick={() => goToPage(curPage + 1)}><ChevronRight size={14} aria-hidden /></button>
            </span>
          )}
          <button className="toast-close" aria-label="Close viewer" onClick={onClose}><X size={14} aria-hidden /></button>
        </div>
        <div className={`docviewer-panes ${isTender || !citation.references || citation.references.length <= 1 ? 'single' : ''}`}>
          {(citation.references?.length
            ? citation.references
            : [{ location: citation.tab ?? (isTender ? 'Referenced section' : 'Workbook'), excerpt: isTender ? citation.excerpt : '' }]
          ).map((reference, index) => (
            <section className="docviewer-pane" aria-label={`${isTender ? 'Tender' : 'Business Case'} document reference ${index + 1}`} key={`${reference.location}-${index}`}>
              <div className="docviewer-pane-head"><FileText size={14} aria-hidden /> {citation.fileName ?? citation.title} · {reference.location}</div>
              {citation.documentUrl && (extension === 'pdf' || extension === 'docx' || extension === 'doc') ? (
                <div className="document-viewer-stack">
                  <LocalDocumentViewer
                    src={citation.documentUrl}
                    page={citation.page}
                    find={reference.excerpt || undefined}
                    onLocated={(how, pages) => setLocated(
                      how === 'match' ? 'Passage found and highlighted in the document.'
                        : how === 'page' ? `Opened at page ${Math.min(citation.page ?? 1, pages)} of ${pages}. The exact passage is shown below.`
                          : '',
                    )}
                  />
                  {reference.excerpt && (
                    <>
                      {located && <div className="muted small" style={{ padding: '6px 12px 0' }} role="status">{located}</div>}
                      <PassageWithContext location={reference.location} excerpt={reference.excerpt} before={citation.contextBefore} after={citation.contextAfter} />
                    </>
                  )}
                </div>
              ) : citation.documentUrl && (extension === 'xlsx' || extension === 'xlsm') ? (
                <div className="docpage-scroll">
                  <SpreadsheetDocumentViewer src={citation.documentUrl} fileName={citation.fileName ?? citation.title} initialSheet={reference.location} />
                </div>
              ) : <div className="docpage-scroll"><div className="docpage">
                <div className="docpage-title">{citation.title}</div>
                <div className="muted small mono">{citation.docId} · {isTender ? 'Tender document' : 'Business case workbook'}{paged ? ` · page ${curPage}` : ''}</div>
                {!paged || curPage === (citation.page ?? 1) ? (
                  <>
                    <h4>{reference.location}</h4>
                    {citation.contextBefore?.map((s, i) => <p key={`b${i}`} className="cite-context">{s}</p>)}
                    <p><mark className="match" ref={index === 0 ? markRef : undefined}>{reference.excerpt}</mark></p>
                    {citation.contextAfter?.map((s, i) => <p key={`a${i}`} className="cite-context">{s}</p>)}
                  </>
                ) : (
                  <>
                    <h4>Page {curPage}</h4>
                    <p className="muted">
                      This demo renders only the cited page of the stored document.
                      The live system shows the full page here.
                    </p>
                    <p><button className="link-btn" type="button" onClick={() => goToPage(citation.page ?? 1)}>Go back to the cited passage (page {citation.page})</button></p>
                  </>
                )}
                <div className="docpage-footer muted small">Rendered preview of the uploaded document. The highlighted passage is the extracted reference; the text around it is shown for context.</div>
              </div></div>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CitationProvider({ children }: { children: ReactNode }) {
  const [citation, setCitation] = useState<CitationInfo | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const show = (c: CitationInfo) => {
    // remember the control that opened the viewer so focus can return to it
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCitation(c);
  };
  const close = () => {
    setCitation(null);
    trigger.current?.focus();
    trigger.current = null;
  };

  useEffect(() => {
    if (!citation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citation]);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {citation && <DocumentViewer citation={citation} onClose={close} />}
    </Ctx.Provider>
  );
}

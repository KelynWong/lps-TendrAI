/* eslint-disable react-refresh/only-export-components */
// Citation side panel: clicking a "Cited" (or confirmed-cited) badge opens
// this panel with the source document, matched excerpt and similarity.
// "View similarity details" opens a side-by-side viewer:
//   LEFT  - the uploaded tender requirement document (current pursuit) with
//           the matching requirement clause highlighted.
//   RIGHT - split top/bottom: TOP is the historical tender requirement the
//           retrieval matched; BOTTOM is our past response for that tender
//           (proposal prose, or a business-case-styled table naming the tab).
// Values extracted directly from the uploaded tender show a single pane.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileSearch, FileText, X } from 'lucide-react';
import { Button } from './ui';
import { useStore } from '../state/store';

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
}

/** The uploaded tender document this business case was generated from. */
export interface TenderDocInfo {
  ref: string;
  title: string;
  fileName: string;
}

/** Historical document type, inferred from the library id prefix. */
function docTypeOf(docId: string): string {
  if (docId.startsWith('BC')) return 'Business Case';
  if (docId.startsWith('WP') || (docId.startsWith('LP') && !docId.startsWith('LPS'))) return 'Proposal';
  if (docId.startsWith('TD')) return 'Tender Requirement';
  return 'Historical document';
}

// Default is a no-op so badges outside the provider degrade gracefully
const Ctx = createContext<{ show: (c: CitationInfo) => void }>({ show: () => {} });

export function useCitation() {
  return useContext(Ctx);
}

/** Business-case-styled snippet naming the tab the cited figure sits on. */
function BcResponsePage({ citation, markRef }: { citation: CitationInfo; markRef: React.Ref<HTMLElement> }) {
  const tab = citation.tab === 'Resource Plan' ? 'Resource Plan' : 'Product Plan';
  return (
    <div className="docpage">
      <div className="docpage-title">{citation.title}</div>
      <div className="muted small mono">{citation.docId} · Business Case workbook · tab: {tab}</div>
      <p className="muted small">The matched figure sits on the {tab} tab of this business case:</p>
      <table className="grid tiny">
        <thead>
          <tr>
            {tab === 'Product Plan'
              ? <><th>Category</th><th>Commodity / Service Description</th><th className="num">Figure</th></>
              : <><th>Team</th><th>Role / effort</th><th className="num">Figure</th></>}
          </tr>
        </thead>
        <tbody>
          <tr className="muted">
            <td>…</td><td>(preceding line items)</td><td className="num">…</td>
          </tr>
          <tr>
            <td>{tab === 'Product Plan' ? 'Software' : 'Delivery'}</td>
            <td><mark className="match" ref={markRef as React.Ref<HTMLElement>}>{citation.excerpt}</mark></td>
            <td className="num">as recorded</td>
          </tr>
          <tr className="muted">
            <td>…</td><td>(following line items)</td><td className="num">…</td>
          </tr>
        </tbody>
      </table>
      <div className="docpage-footer muted small">
        Rendered preview of the archived workbook. The highlighted entry is the matched line;
        surrounding rows are illustrative.
      </div>
    </div>
  );
}

/** Side-by-side similarity viewer (see header comment for the layout). */
function SimilarityViewer({
  citation,
  tenderDoc,
  onClose,
}: {
  citation: CitationInfo;
  tenderDoc?: TenderDocInfo;
  onClose: () => void;
}) {
  const { state } = useStore();
  const isExtract = citation.source === 'tender';
  const dType = docTypeOf(citation.docId);
  const citedIsTenderReq = dType === 'Tender Requirement';
  const pct = `${(citation.similarity * 100).toFixed(0)}%`;
  const markRef = useRef<HTMLElement>(null);
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center' });
  }, [citation]);

  // Library record of the cited document, for its version (item: versioning
  // must be visible here; archived documents stay citable).
  const libDoc = state.historical.find((d) => d.id === citation.docId);
  const verLabel = libDoc ? ` · v${libDoc.version}${libDoc.archived ? ' (archived)' : ''}` : '';

  // The historical tender requirement of the referenced pursuit (synthesised
  // id for the demo when the cited doc is a proposal/business case).
  const histTenderId = citedIsTenderReq ? citation.docId : `TD-${citation.docId.slice(3)}`;
  const histClause =
    citation.tenderExcerpt ??
    `The Contractor shall provide ${citation.context ?? 'the specified item'} as part of the contracted scope.`;

  const tenderHighlight = isExtract ? citation.excerpt : histClause;

  return (
    <div className="docviewer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="docviewer" role="dialog" aria-modal="true" aria-label={isExtract ? 'Extraction source' : 'Similarity details'}>
        <div className="docviewer-head">
          <FileSearch size={16} aria-hidden />
          <b>{isExtract ? 'Extraction source' : 'Similarity details'}</b>
          <span className="muted small">
            {isExtract ? 'Read directly from the uploaded tender document' : `${dType} ${citation.docId}${verLabel} · ${pct} match`}
          </span>
          <button className="toast-close" aria-label="Close viewer" onClick={onClose}>
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className={`docviewer-panes ${isExtract ? 'single' : ''}`}>
          <section className="docviewer-pane" aria-label="Uploaded tender requirement document">
            <div className="docviewer-pane-head">
              <FileText size={14} aria-hidden /> Uploaded tender document · {isExtract ? citation.docId : tenderDoc?.ref ?? 'this pursuit'}
            </div>
            <div className="docpage-scroll">
              <div className="docpage">
                <div className="docpage-title">
                  {isExtract ? citation.title : `${tenderDoc?.title ?? 'Uploaded tender'} - Requirement Specification`}
                </div>
                <div className="muted small mono">{tenderDoc?.fileName ?? citation.docId} · this pursuit</div>
                {isExtract ? (
                  <>
                    <h4>1.2 Scope</h4>
                    <p>
                      This Invitation to Tender covers the modernisation of the contact centre platform,
                      its operation for the contracted term, and the associated security monitoring
                      services described in the sections below.
                    </p>
                    <h4>2.1 Contract period</h4>
                    <p>
                      The contract period is thirty-six (36) months from the date of award, with options
                      to extend as provided for in the conditions of contract.
                    </p>
                    <h4>Extracted information</h4>
                    <p>
                      The following was read directly from this document:{' '}
                      <mark className="match" ref={markRef}>{citation.excerpt}</mark>
                    </p>
                    <p>
                      No historical matching was involved for these values; they are a direct extraction
                      from the uploaded tender document.
                    </p>
                  </>
                ) : (
                  <>
                    <h4>2. Background</h4>
                    <p>
                      The Agency operates a national contact centre serving public enquiries across
                      multiple channels. This tender seeks a contractor to modernise the platform and
                      operate it for the contracted term.
                    </p>
                    <h4>6. Service requirements</h4>
                    <p>
                      The requirements below define the minimum service scope.{' '}
                      <mark className="match">{tenderHighlight}</mark>{' '}
                      Compliance with each requirement shall be demonstrated in the tender response.
                    </p>
                    <h4>9. Submission requirements</h4>
                    <p>
                      Tenderers shall submit their response using the forms provided, including the
                      price schedule and the compliance matrix, by the stipulated closing date.
                    </p>
                  </>
                )}
                <div className="docpage-footer muted small">
                  Rendered preview of the uploaded document. The highlighted passage is the relevant
                  section; surrounding text is illustrative.
                </div>
              </div>
            </div>
          </section>
          {!isExtract && (
            <section className="docviewer-pane docviewer-split" aria-label="Matched historical records">
              <div className="sim-row">
                <span className="muted small">Match similarity</span>
                <div className="sim-bar" aria-hidden><div style={{ width: pct }} /></div>
                <b>{pct}</b>
              </div>
              {/* TOP: the historical tender requirement the retrieval matched */}
              <div className="docviewer-pane-head">
                <FileText size={14} aria-hidden /> Historical tender requirement · {histTenderId}
              </div>
              <div className="docpage-scroll">
                <div className="docpage">
                  <div className="docpage-title">
                    {citedIsTenderReq ? citation.title : `Tender Requirement - ${citation.title.replace(/^(Business Case|Proposal) - /, '')}`}
                  </div>
                  <div className="muted small mono">{histTenderId} · Tender Requirement · Historical data library</div>
                  <h4>6. Service requirements</h4>
                  <p>
                    This specification matched the clause highlighted on the left.{' '}
                    <mark className="match" ref={citedIsTenderReq ? markRef : undefined}>
                      {citedIsTenderReq ? citation.excerpt : histClause}
                    </mark>
                  </p>
                </div>
              </div>
              {/* BOTTOM: our past response for that tender (the cited document) */}
              {citedIsTenderReq ? (
                <p className="muted small">
                  No linked proposal or business case is on record for this historical tender; the
                  figure was grounded in the requirement document itself.
                </p>
              ) : (
                <>
                  <div className="docviewer-pane-head">
                    <FileText size={14} aria-hidden /> Our past response · {dType} · {citation.docId}{verLabel}
                  </div>
                  <div className="docpage-scroll">
                    {dType === 'Business Case' ? (
                      <BcResponsePage citation={citation} markRef={markRef} />
                    ) : (
                      <div className="docpage">
                        <div className="docpage-title">{citation.title}</div>
                        <div className="muted small mono">{citation.docId} · {dType} · Historical data library</div>
                        <h4>4.2 Commercial response</h4>
                        <p>
                          Our response to the requirement above was priced as follows.{' '}
                          <mark className="match" ref={markRef}>{citation.excerpt}</mark>{' '}
                          These rates were validated against the prevailing frame agreement at the
                          time of submission.
                        </p>
                        <div className="docpage-footer muted small">
                          Rendered preview of the archived document; surrounding text is illustrative.
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export function CitationProvider({ children, tenderDoc }: { children: ReactNode; tenderDoc?: TenderDocInfo }) {
  const [citation, setCitation] = useState<CitationInfo | null>(null);
  const [viewer, setViewer] = useState(false);

  useEffect(() => {
    if (!citation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (viewer) setViewer(false);
      else setCitation(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [citation, viewer]);

  // Clicking anywhere outside the panel closes it (badge clicks re-open via
  // their own handler; the full-screen viewer manages its own backdrop).
  useEffect(() => {
    if (!citation || viewer) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('.source-panel') || t.closest('.badge'))) return;
      setCitation(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [citation, viewer]);

  const isExtract = citation?.source === 'tender';

  return (
    <Ctx.Provider value={{ show: (c) => { setCitation(c); setViewer(false); } }}>
      {children}
      {citation && (
        <aside className="source-panel" role="complementary" aria-label="Citation source">
          <div className="source-head">
            <FileText size={16} aria-hidden />
            <b>Source document</b>
            <button className="toast-close" aria-label="Close source panel" onClick={() => setCitation(null)}>
              <X size={14} aria-hidden />
            </button>
          </div>
          {citation.context && <div className="source-context">Grounds: {citation.context}</div>}
          {citation.confirmedBy && (
            <div className="source-confirm">
              {citation.edited
                ? `${citation.confirmedBy} changed this value after review. The citation is kept: the original cited passage is below, the current value is in the business case.`
                : `${citation.confirmedBy} reviewed and confirmed the cited value. The citation is kept below.`}
            </div>
          )}
          <dl className="source-meta">
            <dt>Document</dt>
            <dd className="mono">{citation.docId}</dd>
            <dt>Type</dt>
            <dd>{isExtract ? 'Uploaded tender document' : docTypeOf(citation.docId)}</dd>
            <dt>Title</dt>
            <dd>{citation.title}</dd>
            <dt>Match similarity</dt>
            <dd>{isExtract ? 'Direct extraction' : `${(citation.similarity * 100).toFixed(0)}%`}</dd>
          </dl>
          <div className="source-excerpt-label">{citation.edited ? 'Original cited value' : 'Matched section'}</div>
          <blockquote className="source-excerpt">{citation.excerpt}</blockquote>
          <div className="source-actions">
            <Button variant="primary" icon={FileSearch} onClick={() => setViewer(true)}>
              {isExtract ? 'View extraction source' : 'View similarity details'}
            </Button>
          </div>
        </aside>
      )}
      {citation && viewer && (
        <SimilarityViewer citation={citation} tenderDoc={tenderDoc} onClose={() => setViewer(false)} />
      )}
    </Ctx.Provider>
  );
}

// Where the demo's stored documents live. The live system serves each tender
// pack document and historical business case from S3 (by ID); the demo serves
// files generated from the mock data (scripts/generate-mock-documents.mjs) so
// the source viewer opens a real PDF, Word or Excel file with the cited
// passage in it. Documents uploaded during a demo session have no file and
// fall back to the built-in page preview.

import { MOCK_DOCUMENT_FILES } from './mockDocumentFiles';

const slug = (name: string) => {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const s = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
  return ext ? `${s}.${ext}` : s;
};

export const tenderDocumentPath = (tenderId: string, fileName: string) => `/mock-documents/tenders/${tenderId}/${slug(fileName)}`;
export const historicalDocumentPath = (refId: string) => `/mock-documents/history/${slug(refId)}.xlsx`;

/** URL of a tender pack document's demo file, when one was generated. */
export function tenderDocumentUrl(tenderId: string, fileName: string): string | undefined {
  const p = tenderDocumentPath(tenderId, fileName);
  return MOCK_DOCUMENT_FILES.has(p) ? p : undefined;
}

/** URL of a historical business case's demo workbook, when one was generated. */
export function historicalDocumentUrl(refId: string): string | undefined {
  const p = historicalDocumentPath(refId);
  return MOCK_DOCUMENT_FILES.has(p) ? p : undefined;
}

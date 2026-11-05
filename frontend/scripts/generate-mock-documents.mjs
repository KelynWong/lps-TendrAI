// Generates the demo's stored documents from the mock data, so every source
// the AI cites opens a real file in the source viewer with the cited passage
// findable (and highlighted):
//  - every tender pack document (PDF, Word or Excel, by its extension), with
//    each extracted clause, submission and qualification item on its page and
//    the passages the AI business case draft cites (for a tender not processed
//    yet, the results the demo produces when it is processed)
//  - every historical business case (Excel), with the past lines the AI cites
// It also writes src/data/mockDocumentFiles.ts, the list of generated files.
// All content is fictitious demo data. Re-run after changing src/data/mock.ts:
//   npm --prefix frontend run mock-docs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'mock-documents');
/** text lines that fit one PDF page under the title */
const PDF_LINES = 52;

const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { TENDERS, REPOSITORY } = await server.ssrLoadModule('/src/data/mock.ts');
  const { tenderDocumentPath, historicalDocumentPath } = await server.ssrLoadModule('/src/data/mockDocuments.ts');
  const { buildDemoExtraction } = await server.ssrLoadModule('/src/data/extraction.ts');
  const { generateBusinessCase } = await server.ssrLoadModule('/src/businessCase/generate.ts');
  const XLSX = await server.ssrLoadModule('xlsx');

  for (const dir of ['tenders', 'history']) fs.rmSync(path.join(outDir, dir), { recursive: true, force: true });
  const written = [];
  const write = (urlPath, bytes) => {
    const file = path.join(root, 'public', ...urlPath.split('/').filter(Boolean));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    written.push(urlPath);
  };

  // ---- tender pack documents ------------------------------------------------
  for (const seed of TENDERS) {
    // a tender not processed yet gets its results when the demo processes it
    // (data/extraction.ts, then the AI draft): write those passages too
    const t = seed.clauses.length ? seed : { ...seed, ...buildDemoExtraction(seed) };
    const drafts = seed.bcVersions.length ? seed.bcVersions.map((v) => v.bc) : [generateBusinessCase(t)];
    // passages the business case drafts cite, per pack document
    const bcPassages = new Map();
    for (const bc of drafts) {
      walkCitations(bc, (c) => {
        if (c.source !== 'tender' || !c.fileName) return;
        const set = bcPassages.get(c.fileName) ?? new Set();
        set.add(c.excerpt);
        bcPassages.set(c.fileName, set);
      });
    }
    for (const doc of t.pack) {
      const ext = doc.name.split('.').pop().toLowerCase();
      const scanned = /scanned/i.test(doc.name) || /scan/i.test(doc.failReason ?? '');
      // page -> blocks ({heading, text}); clauses first, then items not extracted as clauses
      const pages = new Map();
      const put = (page, heading, text) => {
        const p = Math.max(1, page || 1);
        if (!pages.has(p)) pages.set(p, []);
        if (!pages.get(p).some((b) => b.text === text)) pages.get(p).push({ heading, text });
      };
      const clauses = t.clauses.filter((c) => c.sourceDoc === doc.name);
      for (const c of clauses) put(c.page, `Clause ${c.number}`, c.text);
      const pageOf = (clause) => clauses.find((c) => c.number === clause)?.page ?? Math.max(1, 2 + 2 * (parseInt(clause, 10) || 1));
      for (const k of t.checklist.filter((x) => x.sourceDoc === doc.name)) {
        if (!clauses.some((c) => c.number === k.clause)) put(pageOf(k.clause), `Clause ${k.clause}`, k.item);
      }
      for (const q of t.quals.filter((x) => x.sourceDoc === doc.name)) {
        if (!clauses.some((c) => c.number === q.clause)) put(pageOf(q.clause), `Clause ${q.clause}`, q.requirement);
      }
      for (const text of bcPassages.get(doc.name) ?? []) put(1, 'Key terms', text);

      const urlPath = tenderDocumentPath(t.id, doc.name);
      const title = `${doc.name.replace(/\.[^.]+$/, '')} - ${t.ref || t.id}`;
      if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
        const rows = [[title], [], ['Clause', 'Requirement', 'Tenderer response']];
        for (const [, blocks] of [...pages].sort((a, b) => a[0] - b[0])) {
          for (const b of blocks) rows.push([b.heading.replace(/^Clause /, ''), b.text, '']);
        }
        rows.push(['', 'Item description', 'Unit price (SGD)'], ['', 'To be completed by the tenderer', '']);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Schedule');
        write(urlPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
      } else {
        const pageCount = Math.max(doc.pages || 1, ...pages.keys());
        const content = Array.from({ length: pageCount }, (_, i) => {
          const blocks = pages.get(i + 1) ?? [];
          if (scanned) return [{ text: 'Scanned drawing - this page has no text layer.' }];
          if (!blocks.length) return [{ text: 'This page continues the general provisions of the tender document and contains no extracted requirement.' }];
          const lines = blocks.flatMap((b, j) => [
            ...(j > 0 && blocks[j - 1].heading === b.heading ? [] : [{ text: b.heading, bold: true }]),
            ...wrap(b.text).map((line) => ({ text: line })),
            { text: '' },
          ]);
          if (lines.length > PDF_LINES) console.warn(`${t.id} ${doc.name} page ${i + 1}: ${lines.length} lines, only ${PDF_LINES} fit`);
          return lines;
        });
        write(urlPath, ext === 'docx' || ext === 'doc' ? docx(XLSX, title, content) : pdf(title, content));
      }
    }
  }

  // ---- historical business cases ----------------------------------------------
  // the past lines the AI cites, with the line they were cited for
  const product = new Map();
  const resource = new Map();
  for (const t of TENDERS) {
    for (const v of t.bcVersions ?? []) {
      for (const p of v.bc.productItems) {
        const c = citationOf(p.provenance);
        if (c?.source === 'historical' && !product.has(c.excerpt)) product.set(c.excerpt, p);
      }
      for (const r of v.bc.resourceItems) {
        const c = citationOf(r.provenance);
        if (c?.source === 'historical' && !resource.has(c.excerpt)) resource.set(c.excerpt, r);
      }
    }
  }
  const cases = REPOSITORY.filter((r) => r.kind === 'Business case' && r.refId);
  for (const r of cases) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Business case', r.name],
      ['Customer', r.agency],
      ['Reference', r.refId],
      ['Outcome', r.status],
      ['Currency', 'SGD'],
      [],
      ['Fictitious demo data.'],
    ]), 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Category', 'Description', 'Vendor', 'Unit cost (SGD)', 'Quantity', 'Pricing basis'],
      ...[...product].map(([excerpt, p]) => [p.category, p.description, p.vendor, p.unitCost, p.qtyByFY[0], excerpt]),
    ]), 'Product Plan');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Role', 'Team', 'Grade', 'Day rate (SGD)', 'Man-days', 'Effort basis'],
      ...[...resource].map(([excerpt, x]) => [x.role, x.team, x.grade, x.dayRate, x.mandaysByFY.reduce((a, b) => a + b, 0), excerpt]),
    ]), 'Resource Plan');
    write(historicalDocumentPath(r.refId), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  written.sort();
  fs.writeFileSync(path.join(root, 'src', 'data', 'mockDocumentFiles.ts'),
    '// Generated by scripts/generate-mock-documents.mjs - do not edit.\n'
    + '// The demo files under public/mock-documents that the source viewer can open.\n\n'
    + `export const MOCK_DOCUMENT_FILES: ReadonlySet<string> = new Set([\n${written.map((w) => `  '${w.replace(/'/g, "\\'")}',`).join('\n')}\n]);\n`);
  console.log(`Wrote ${written.length} documents to public/mock-documents`);
} finally {
  await server.close();
}

function citationOf(p) {
  return p?.kind === 'grounded' ? p.citation : p?.kind === 'human' ? p.citation : undefined;
}

function walkCitations(o, fn) {
  if (!o || typeof o !== 'object') return;
  const c = citationOf(o);
  if (c) fn(c);
  for (const v of Object.values(o)) walkCitations(v, fn);
}

/** Splits text into lines that fit the page (10pt Helvetica, 468pt wide). A
 *  passage always starts a new line, so the viewer's search of its opening
 *  words never spans a line break. */
function wrap(text, width = 90) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Minimal PDF (one text stream per page, standard fonts, WinAnsi text). */
function pdf(title, pages) {
  const esc = (s) => latin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((lines, i) => {
    const ops = ['BT', '/F2 12 Tf', '72 740 Td', `(${esc(title)}) Tj`, '/F1 8 Tf', '0 -14 Td', `(Page ${i + 1} of ${pages.length}) Tj`, '0 -10 Td'];
    for (const l of lines.slice(0, PDF_LINES)) ops.push(l.bold ? '/F2 10 Tf' : '/F1 10 Tf', '0 -13 Td', `(${esc(l.text)}) Tj`);
    ops.push('ET');
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Minimal .docx (one paragraph per line, a page break between pages). */
function docx(XLSX, title, pages) {
  const x = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const para = (text, b = false) => `<w:p><w:r>${b ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${x(text)}</w:t></w:r></w:p>`;
  const body = pages.map((lines, i) => [
    para(title, true),
    para(`Page ${i + 1} of ${pages.length}`),
    // Word lays out the lines itself, so each passage is one paragraph
    ...joinParagraphs(lines).map((l) => para(l.text, l.bold)),
    i < pages.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '',
  ].join('')).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  };
  const cfb = XLSX.CFB.utils.cfb_new();
  for (const [name, text] of Object.entries(files)) XLSX.CFB.utils.cfb_add(cfb, name, Buffer.from(text, 'utf8'));
  return Buffer.from(XLSX.CFB.write(cfb, { type: 'buffer', fileType: 'zip' }));
}

/** Rejoins wrapped lines into one paragraph per passage (for Word). */
function joinParagraphs(lines) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (l.bold || !l.text) { if (cur) out.push(cur); cur = null; if (l.bold) out.push(l); continue; }
    cur = cur ? { text: `${cur.text} ${l.text}` } : { text: l.text };
  }
  if (cur) out.push(cur);
  return out;
}

/** PDF standard fonts take WinAnsi text: typographic punctuation maps to ASCII. */
function latin1(s) {
  return s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/[^\x00-\xFF]/g, '?');
}

// Business case workbook parser (.xlsx / .xlsm).
//
// Reads the template layout the MSPO mapping anchors describe:
//   Summary       B6 TCV/CCB, B14 direct cost (= B15 internal labour + B16:B20
//                 product categories), B24 indirect cost, B50 EBITDA, C22 margin %
//                 (headline figures are read from `cells` through the MSPO
//                 "Business case figures" mapping; see frontend/src/lib/figures.ts)
//   Basic Info    D9 duration (months), D10 project start, rows 31.. billing
//                 (A date, B name, C amount, D remark)
//   Product Plan  row 6 onward: B QL, C category, D description, E vendor
//                 commitment, F unit price, G total, H.. quantity per FY
//   Resource Plan row 8 onward: B QL, D role, E grade, F man-days, G total,
//                 H skill, I.. man-days per FY
//   Labour Inputs row 8 onward: F day rate (iRate)
// If the anchor sheets are missing it falls back to header-name parsing
// (same as frontend bc.tsx); if that fails too the layout is "unrecognised" and
// the missing anchors are reported.
import * as XLSX from 'xlsx';
import type { BcBilling, BcProduct, BcResource, BcVersionData } from '../types.js';

export interface ParsedWorkbook {
  data: BcVersionData;
  parsed: boolean;
  missingAnchors: string[];
}

const ANCHORS = {
  productSheet: 'Sheet "Product Plan" with lines from row 6 (Quote Line / Category / Description)',
  resourceSheet: 'Sheet "Resource Plan" with lines from row 8 (Role / Grade / Team)',
  summarySheet: 'Sheet "Summary" with B6 contract value, B15 internal labour, B16:B20 product categories, C22 margin',
  basicInfoSheet: 'Sheet "Basic Info" with D9 duration and the billing plan from row 31',
};

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return 0;
  const n = parseFloat(String(v ?? '').replace(/[,$%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const dateStr = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = str(v);
  const parsed = s ? new Date(s) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
};

function cell(ws: XLSX.WorkSheet | undefined, ref: string): unknown {
  return ws?.[ref]?.v;
}
const colLetter = (i: number) => XLSX.utils.encode_col(i);

/** Raw numeric cells the Final Check rules may reference (tab -> ref -> value). */
function captureCells(wb: XLSX.WorkBook): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const name of ['Summary', 'Basic Info', 'Product Plan', 'Resource Plan', 'Labour Inputs', 'Cash Flow', 'Working']) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const tab: Record<string, number> = {};
    for (let r = range.s.r; r <= Math.min(range.e.r, 400); r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, 60); c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const v = ws[ref]?.v;
        if (typeof v === 'number') tab[ref] = v;
      }
    }
    out[name] = tab;
  }
  return out;
}

function readLines<T>(ws: XLSX.WorkSheet, firstRow: number, keyCol: string, build: (row: number) => T | null): T[] {
  const out: T[] = [];
  let blank = 0;
  for (let r = firstRow; r < firstRow + 500 && blank < 3; r++) {
    const key = cell(ws, `${keyCol}${r}`);
    if (key === undefined || key === null || str(key) === '') { blank++; continue; }
    blank = 0;
    const line = build(r);
    if (line) out.push(line);
  }
  return out;
}

function fyColumns(ws: XLSX.WorkSheet, headerRow: number, firstCol: number): number[] {
  // fiscal-year header cells (e.g. "26/27" or "FY26") running right from firstCol
  const cols: number[] = [];
  for (let c = firstCol; c < firstCol + 12; c++) {
    const v = str(cell(ws, `${colLetter(c)}${headerRow}`));
    if (!v) break;
    if (/\d{2}\s*\/\s*\d{2}|FY\s*\d{2}/i.test(v)) cols.push(c); else break;
  }
  return cols;
}

export function parseBusinessCase(buffer: Buffer): ParsedWorkbook {
  const empty: BcVersionData = {
    header: { tcv: 0, productTotal: 0, labourTotal: 0, marginPct: 0, currency: 'SGD', durationMonths: 0, projectStart: new Date().toISOString().slice(0, 10) },
    products: [], resources: [], billing: [],
  };
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    return { data: empty, parsed: false, missingAnchors: Object.values(ANCHORS) };
  }

  const product = wb.Sheets['Product Plan'];
  const resource = wb.Sheets['Resource Plan'];
  const summary = wb.Sheets['Summary'];
  const basic = wb.Sheets['Basic Info'];
  const labour = wb.Sheets['Labour Inputs'];
  const missing: string[] = [];
  if (!product) missing.push(ANCHORS.productSheet);
  if (!resource) missing.push(ANCHORS.resourceSheet);
  if (!summary) missing.push(ANCHORS.summarySheet);
  if (!basic) missing.push(ANCHORS.basicInfoSheet);

  // ---- anchor-based parse (the known template) ----
  if (product && resource) {
    const prodFy = fyColumns(product, 5, 7); // H5.. headers for H6.. quantities
    const products: BcProduct[] = readLines(product, 6, 'D', (r) => {
      const qtyCols = prodFy.length ? prodFy : [7];
      const fyQty = qtyCols.map((c) => num(cell(product, `${colLetter(c)}${r}`)));
      const qty = fyQty.reduce((a, b) => a + b, 0);
      const unitCost = num(cell(product, `F${r}`));
      return {
        id: `p${r}`, ql: num(cell(product, `B${r}`)) || 1,
        category: str(cell(product, `C${r}`)), desc: str(cell(product, `D${r}`)),
        unitCost, qty, fyQty: prodFy.length > 1 ? fyQty : undefined,
        total: num(cell(product, `G${r}`)) || unitCost * qty,
      };
    });
    const resFy = fyColumns(resource, 6, 8); // I6.. headers for I8.. man-days
    const resources: BcResource[] = readLines(resource, 8, 'D', (r) => {
      const fyMandays = resFy.map((c) => num(cell(resource, `${colLetter(c)}${r}`)));
      const mandays = num(cell(resource, `F${r}`)) || fyMandays.reduce((a, b) => a + b, 0);
      const dayRate = num(cell(labour, `F${r}`));
      return {
        id: `r${r}`, ql: num(cell(resource, `B${r}`)) || 1,
        role: str(cell(resource, `D${r}`)), skill: str(cell(resource, `H${r}`)) || undefined,
        grade: str(cell(resource, `E${r}`)), team: str(cell(resource, `C${r}`)),
        mandays, fyMandays: resFy.length ? fyMandays : undefined, dayRate,
        total: num(cell(resource, `G${r}`)) || mandays * dayRate,
      };
    });
    const billing: BcBilling[] = basic
      ? readLines(basic, 31, 'C', (r) => ({
          id: `b${r}`, date: dateStr(cell(basic, `A${r}`)), schedule: str(cell(basic, `B${r}`)),
          amount: num(cell(basic, `C${r}`)), remark: str(cell(basic, `D${r}`)) || undefined,
        }))
      : [];
    if (products.length || resources.length) {
      // B14 is total direct cost (labour + products); the product share is the
      // five product-category rows B16:B20 as stated in the workbook
      const productCells = ['B16', 'B17', 'B18', 'B19', 'B20'].map((ref) => cell(summary, ref));
      const productTotal = productCells.some((v) => typeof v === 'number')
        ? productCells.reduce((a: number, v) => a + num(v), 0)
        : products.reduce((a, p) => a + p.total, 0);
      const labourTotal = num(cell(summary, 'B15')) || resources.reduce((a, r) => a + r.total, 0);
      return {
        parsed: true,
        missingAnchors: missing,
        data: {
          header: {
            tcv: num(cell(summary, 'B6')) || billing.reduce((a, b) => a + b.amount, 0),
            productTotal, labourTotal,
            marginPct: num(cell(summary, 'C22')),
            currency: str(cell(basic, 'D8')) || 'SGD',
            durationMonths: Math.round(num(cell(basic, 'D9'))),
            projectStart: dateStr(cell(basic, 'D10')) || billing[0]?.date || empty.header.projectStart,
          },
          products, resources, billing,
          cells: captureCells(wb),
        },
      };
    }
  }

  // ---- fallback: header-name parse (any sheet named Product Plan / Resource Plan) ----
  if (product && resource) {
    const prows = XLSX.utils.sheet_to_json<Record<string, unknown>>(product);
    const rrows = XLSX.utils.sheet_to_json<Record<string, unknown>>(resource);
    const products: BcProduct[] = prows.map((r, i) => ({
      id: `p${i + 1}`, ql: num(r['Quote Line'] ?? r['QL'] ?? 1) || 1,
      category: str(r['Category'] ?? 'Software'), desc: str(r['Description'] ?? r['Commodity/Service descriptions'] ?? `Line ${i + 1}`),
      unitCost: num(r['Unit Cost'] ?? r['Unit Price']), qty: num(r['Quantity'] ?? r['Qty'] ?? 1), total: num(r['Total'] ?? r['Total Cost']),
    }));
    const resources: BcResource[] = rrows.map((r, i) => ({
      id: `r${i + 1}`, ql: num(r['Quote Line'] ?? 1) || 1, role: str(r['Role'] ?? `Role ${i + 1}`), grade: str(r['Grade'] ?? ''), team: str(r['Team'] ?? ''),
      mandays: num(r['Man-days'] ?? r['Total MD']), dayRate: num(r['Day Rate'] ?? r['iRate']), total: num(r['Total'] ?? r['Total Amount']),
    }));
    if (products.length || resources.length) {
      return {
        parsed: true,
        missingAnchors: missing,
        data: {
          header: { ...empty.header, productTotal: products.reduce((a, p) => a + p.total, 0), labourTotal: resources.reduce((a, r) => a + r.total, 0) },
          products, resources, billing: [], cells: captureCells(wb),
        },
      };
    }
  }

  return { data: empty, parsed: false, missingAnchors: missing.length ? missing : [ANCHORS.productSheet, ANCHORS.resourceSheet] };
}

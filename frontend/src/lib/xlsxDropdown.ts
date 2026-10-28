// Writes a workbook with in-cell dropdown lists (Excel data validation).
// The bundled SheetJS build can't write data validations, so the generated
// sheet XML is patched through SheetJS's own zip container (CFB) - no extra
// dependency.

import * as XLSX from 'xlsx';

export interface ListValidation {
  /** cell range, e.g. "C3:C122" */
  sqref: string;
  /** fixed values (written inline) */
  options?: string[];
  /** or a list formula, e.g. a named range or INDIRECT(...) */
  formula?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const formula1 = (v: ListValidation) => (v.formula ? escText(v.formula) : `"${esc((v.options ?? []).join(','))}"`);

export function writeXlsxWithDropdowns(wb: XLSX.WorkBook, fileName: string, validations: ListValidation[], sheetIndex = 1) {
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const i = zip.FullPaths.findIndex((p: string) => p.endsWith(`xl/worksheets/sheet${sheetIndex}.xml`));
  const entry = zip.FileIndex[i];
  if (entry && validations.length) {
    const xml = new TextDecoder().decode(entry.content as Uint8Array);
    // dataValidations must follow sheetData (and any mergeCells) in the sheet XML
    const anchor = xml.includes('</mergeCells>') ? '</mergeCells>' : '</sheetData>';
    const block = `<dataValidations count="${validations.length}">${validations
      .map((v) => `<dataValidation type="list" allowBlank="1" showDropDown="0" showErrorMessage="1" errorTitle="Choose from the list" error="Pick one of the listed values." sqref="${v.sqref}"><formula1>${formula1(v)}</formula1></dataValidation>`)
      .join('')}</dataValidations>`;
    const patched = new TextEncoder().encode(xml.replace(anchor, `${anchor}${block}`));
    entry.content = patched;
    entry.size = patched.length;
  }
  const out = XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }) as ArrayLike<number>;
  const url = URL.createObjectURL(new Blob([Uint8Array.from(out)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { readXlsx } from './index.js';
import { XLSX_LIMITS } from './safety.js';

const xml = (value: string): Uint8Array => strToU8(value);

const workbookFiles = (
  sheet: string,
  extras: Record<string, string> = {},
): Record<string, Uint8Array> => ({
  '[Content_Types].xml': xml('<Types/>'),
  'xl/workbook.xml': xml(
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  ),
  'xl/_rels/workbook.xml.rels': xml(
    '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  ),
  'xl/worksheets/sheet1.xml': xml(sheet),
  ...Object.fromEntries(Object.entries(extras).map(([path, value]) => [path, xml(value)])),
});

const makeWorkbook = (
  files: Record<string, Uint8Array> = workbookFiles('<worksheet><sheetData/></worksheet>'),
) => zipSync(files, { level: 6 });

const errorCode = (bytes: Uint8Array) => {
  const result = readXlsx(bytes);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected XLSX read to fail.');
  return result.error.code;
};

const setLittleEndianUint32 = (bytes: Uint8Array, offset: number, value: number): void => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
};

describe('XLSX reader safety', () => {
  it('rejects archives with too many ZIP entries before decompression', () => {
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index <= XLSX_LIMITS.maxEntries; index += 1) {
      files[`junk/${index}.xml`] = xml('<x/>');
    }

    expect(errorCode(zipSync(files))).toBe('zip-entry-limit');
  });

  it('rejects an archive whose central directory claims more than 200 MB', () => {
    const bytes = makeWorkbook();
    const centralDirectoryOffset = bytes.findIndex(
      (value, index) =>
        value === 0x50 &&
        bytes[index + 1] === 0x4b &&
        bytes[index + 2] === 0x01 &&
        bytes[index + 3] === 0x02,
    );
    expect(centralDirectoryOffset).toBeGreaterThanOrEqual(0);
    setLittleEndianUint32(
      bytes,
      centralDirectoryOffset + 20,
      Math.ceil((200 * 1024 * 1024 + 1) / 200),
    );
    setLittleEndianUint32(bytes, centralDirectoryOffset + 24, 200 * 1024 * 1024 + 1);

    expect(errorCode(bytes)).toBe('uncompressed-size-limit');
  });

  it('rejects entries compressed above the 200:1 ratio', () => {
    const repeated = 'A'.repeat(100_000);
    expect(errorCode(zipSync({ 'xl/workbook.xml': xml(repeated) }, { level: 9 }))).toBe(
      'compression-ratio-limit',
    );
  });

  it('rejects XML containing a DOCTYPE declaration', () => {
    const bytes = makeWorkbook({
      ...workbookFiles('<!DOCTYPE worksheet><worksheet><sheetData/></worksheet>'),
    });

    expect(errorCode(bytes)).toBe('xml-doctype');
  });
});

describe('XLSX reader formulas and workbook metadata', () => {
  it('expands shared formulas, strips prefixes, and preserves unsupported formula markers', () => {
    const files: Record<string, Uint8Array> = {
      '[Content_Types].xml': xml('<Types/>'),
      'xl/workbook.xml': xml(
        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="Hidden" sheetId="1" state="hidden" r:id="rId1"/></sheets><definedNames><definedName name="Input">Hidden!$A$1</definedName></definedNames><calcPr calcMode="autoNoTable"/></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': xml(
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': xml(
        '<sst><si><t>Hello</t></si><si><r><t>Rich</t></r><r><t> text</t></r></si></sst>',
      ),
      'xl/styles.xml': xml(
        '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="1"><xf numFmtId="164"/></cellXfs></styleSheet>',
      ),
      'xl/worksheets/sheet1.xml': xml(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f t="shared" si="0" ref="B1:B3">A1+_xlfn.SOMETHING()</f><v>2</v></c><c r="C1" s="0"><v>1</v></c><c r="D1" t="s"><v>1</v></c><c r="E1"><f t="array" ref="E1:E2">SUM(A1:A2)</f><v>3</v></c><c r="F1"><f>Table1[Amount]+_xlws.OLD()</f><v>4</v></c></row><row r="2"><c r="B2"><f t="shared" si="0"/><v>3</v></c></row><row r="3"><c r="B3"><f t="shared" si="0"/><v>4</v></c></row></sheetData></worksheet>',
      ),
    };

    const result = readXlsx(zipSync(files), 'formula.xlsx');
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    const workbook = result.workbook;
    const sheet = workbook.sheets[0]!;
    expect(workbook.name).toBe('formula.xlsx');
    expect(workbook.dateSystem).toBe('1904');
    expect(workbook.calcMode).toBe('automaticExceptTables');
    expect(workbook.definedNames).toEqual({ Input: 'Hidden!$A$1' });
    expect(sheet.hidden).toBe(true);
    expect(sheet.state).toBe('hidden');
    expect(sheet.cells.find((cell) => cell.address === 'A1')?.value).toBe('Hello');
    expect(sheet.cells.find((cell) => cell.address === 'D1')?.value).toBe('Rich text');
    expect(sheet.cells.find((cell) => cell.address === 'C1')?.value).toBe('1904-01-02');
    expect(sheet.cells.find((cell) => cell.address === 'B1')?.formula).toBe('A1+SOMETHING()');
    expect(sheet.cells.find((cell) => cell.address === 'B2')?.formula).toBe('A2+SOMETHING()');
    expect(sheet.cells.find((cell) => cell.address === 'B3')?.formula).toBe('A3+SOMETHING()');
    expect(sheet.cells.find((cell) => cell.address === 'E1')?.unsupportedReason).toContain(
      'array formula',
    );
    expect(sheet.cells.find((cell) => cell.address === 'F1')?.unsupportedReason).toContain(
      'structured reference',
    );
    expect(sheet.cells.find((cell) => cell.address === 'F1')?.formula).toBe('Table1[Amount]+OLD()');
  });
});

#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const SPECS_DIR = join(ROOT, 'fixtures', 'specs');
const XLSX_DIR = join(ROOT, 'fixtures', 'xlsx');
const DECISIONS_PATH = join(ROOT, 'docs', 'DECISIONS.md');

const FIXTURE_NAMES = [
  'rr-reconstruction',
  'gene-list',
  'loan',
  'noise-budget',
  'agent-demo',
  'agent-edit-before',
  'agent-edit-broken',
  'agent-edit-intended',
  'agent-edit-unrelated',
];

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const FIXED_DATE = new Date('1980-01-01T00:00:00Z');

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnNumber(column) {
  let result = 0;
  for (const character of column.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function cellAddressParts(address) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(address);
  if (!match) throw new Error(`Invalid cell address: ${address}`);
  return { column: match[1].toUpperCase(), row: Number(match[2]) };
}

function cellSort(a, b) {
  const left = cellAddressParts(a);
  const right = cellAddressParts(b);
  return left.row - right.row || columnNumber(left.column) - columnNumber(right.column);
}

function normalizeCell(cell) {
  if (cell && typeof cell === 'object' && !Array.isArray(cell)) return { ...cell };
  return { value: cell };
}

function normalizeFormula(formula) {
  const text = String(formula);
  return text.startsWith('=') ? text.slice(1) : text;
}

function valueType(value) {
  if (typeof value === 'boolean') return 'b';
  if (typeof value === 'number') return null;
  if (value === null || value === undefined) return null;
  return 'str';
}

function cachedXml(cell) {
  const cached = cell.cached ?? cell.value;
  if (cached === undefined || cached === null || cached === '') return '<v/>';
  const type = cell.cachedType ?? valueType(cached);
  if (type === 'inlineStr') return `<is><t>${xmlEscape(cached)}</t></is>`;
  return `<v>${xmlEscape(cached)}</v>`;
}

function cellXml(address, rawCell) {
  const cell = normalizeCell(rawCell);
  const attributes = [`r="${xmlEscape(address)}"`];
  if (cell.style !== undefined) attributes.push(`s="${Number(cell.style)}"`);

  if (cell.formula !== undefined) {
    const type = cell.cachedType ?? valueType(cell.cached);
    if (type && type !== 'str') attributes.push(`t="${xmlEscape(type)}"`);
    if (type === 'str') attributes.push('t="str"');
    return `<c ${attributes.join(' ')}><f>${xmlEscape(normalizeFormula(cell.formula))}</f>${cachedXml(cell)}</c>`;
  }

  const value = cell.value;
  if (value === undefined || value === null || value === '') return `<c ${attributes.join(' ')}/>`;
  if (cell.type === 'inlineStr' || typeof value === 'string') {
    attributes.push('t="inlineStr"');
    return `<c ${attributes.join(' ')}><is><t>${xmlEscape(value)}</t></is></c>`;
  }
  if (typeof value === 'boolean') attributes.push('t="b"');
  return `<c ${attributes.join(' ')}><v>${xmlEscape(value)}</v></c>`;
}

function worksheetXml(sheet) {
  const cells = Object.keys(sheet.cells ?? {}).sort(cellSort);
  const rows = new Map();
  for (const address of cells) {
    const { row } = cellAddressParts(address);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(cellXml(address, sheet.cells[address]));
  }

  const dimension = cells.length
    ? `<dimension ref="${cells[0]}:${cells[cells.length - 1]}"/>`
    : '<dimension ref="A1"/>';
  const rowXml = [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([row, rowCells]) => `<row r="${row}">${rowCells.join('')}</row>`)
    .join('');

  return [
    XML_HEADER,
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    dimension,
    `<sheetData>${rowXml}</sheetData>`,
    '</worksheet>',
  ].join('');
}

function workbookXml(sheets) {
  const sheetXml = sheets
    .map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');
  return [
    XML_HEADER,
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<fileVersion appName="xl" lastEdited="1" lowestEdited="1" rupBuild="1"/>',
    '<workbookPr date1904="0"/>',
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="12000" windowHeight="8000"/></bookViews>',
    `<sheets>${sheetXml}</sheets>`,
    '<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>',
    '</workbook>',
  ].join('');
}

function workbookRels(sheets) {
  const sheetRels = sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join('');
  const stylesId = sheets.length + 1;
  return [
    XML_HEADER,
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    sheetRels,
    `<Relationship Id="rId${stylesId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    '</Relationships>',
  ].join('');
}

function contentTypes(sheets) {
  const sheetOverrides = sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('');
  return [
    XML_HEADER,
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    sheetOverrides,
    '</Types>',
  ].join('');
}

function stylesXml() {
  return [
    XML_HEADER,
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>',
    '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>',
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>',
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs>',
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    '</styleSheet>',
  ].join('');
}

function packageRels() {
  return [
    XML_HEADER,
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>',
  ].join('');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = FIXED_DATE) {
  const year = Math.max(1980, date.getUTCFullYear());
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | (date.getUTCMonth() + 1 << 5) | date.getUTCDate();
  return { time, day };
}

function zipEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const source = Buffer.from(entry.data, 'utf8');
    const compressed = deflateRawSync(source, { level: 9 });
    const checksum = crc32(source);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function buildXlsx(spec) {
  const sheets = spec.sheets ?? [];
  const entries = [
    { name: '[Content_Types].xml', data: contentTypes(sheets) },
    { name: '_rels/.rels', data: packageRels() },
    { name: 'xl/workbook.xml', data: workbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels(sheets) },
    { name: 'xl/styles.xml', data: stylesXml() },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet) })),
  ];
  return zipEntries(entries);
}

export function readXlsxEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('XLSX is missing its ZIP end record');
  const count = buffer.readUInt16LE(end + 10);
  const centralOffset = buffer.readUInt32LE(end + 16);
  let cursor = centralOffset;
  const result = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid XLSX central directory');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    result.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function formulaCellsWithMissingCache(buffer) {
  const entries = readXlsxEntries(buffer);
  const missing = [];
  for (const [name, bytes] of entries) {
    if (!name.startsWith('xl/worksheets/sheet') || !name.endsWith('.xml')) continue;
    const xml = bytes.toString('utf8');
    const cells = xml.matchAll(/<c\b[^>]*>.*?<\/c>/gs);
    for (const match of cells) {
      const cell = match[0];
      if (!/<f(?:\s|>)/.test(cell)) continue;
      const address = /\br="([^"]+)"/.exec(cell)?.[1] ?? '?';
      const cached = /<v>([^<]*)<\/v>/.exec(cell)?.[1];
      if (cached === undefined || cached.length === 0) missing.push(`${name}!${address}`);
    }
  }
  return missing;
}

export function assertFormulaCaches(buffer, label = 'workbook') {
  const missing = formulaCellsWithMissingCache(buffer);
  if (missing.length) throw new Error(`${label} has formula cells without cached values: ${missing.join(', ')}`);
}

function normalizeXlsxZip(buffer) {
  const entries = [...readXlsxEntries(buffer)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, data]) => ({ name, data }));
  return zipEntries(entries);
}

function sofficeVersion() {
  const result = spawnSync('soffice', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Unable to run soffice --version: ${result.error?.message ?? result.stderr}`);
  return `${result.stdout}${result.stderr}`.trim().split(/\r?\n/)[0];
}

function runSofficeConversion(input, outputDirectory) {
  const result = spawnSync('soffice', [
    '--headless',
    '--convert-to',
    'xlsx',
    '--outdir',
    outputDirectory,
    input,
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`soffice conversion failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  return result;
}

function basicXml(source) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ooo:module xmlns:ooo="http://openoffice.org/2004/office" ooo:name="Module1" ooo:language="StarBasic">',
    `<ooo:source>${xmlEscape(source)}</ooo:source>`,
    '</ooo:module>',
  ].join('');
}

function basicLibraryXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd">',
    '<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false">',
    '<library:element library:name="Module1"/>',
    '</library:library>',
  ].join('');
}

async function recalculateWithMacro(input, output, profileDirectory) {
  const libraryDirectory = join(profileDirectory, 'user', 'basic', 'Standard');
  await mkdir(libraryDirectory, { recursive: true });
  const inputUrl = input.replaceAll('\\', '/').replaceAll(' ', '%20');
  const outputUrl = output.replaceAll('\\', '/').replaceAll(' ', '%20');
  const source = [
    'Sub Main',
    '  Dim loadProps(0) As New com.sun.star.beans.PropertyValue',
    '  Dim saveProps(1) As New com.sun.star.beans.PropertyValue',
    `  Dim inputUrl As String : inputUrl = "file://${inputUrl}"`,
    `  Dim outputUrl As String : outputUrl = "file://${outputUrl}"`,
    '  loadProps(0).Name = "Hidden" : loadProps(0).Value = True',
    '  doc = StarDesktop.loadComponentFromURL(inputUrl, "_blank", 0, loadProps())',
    '  If IsNull(doc) Then Error 7001',
    '  doc.calculateAll()',
    '  saveProps(0).Name = "FilterName" : saveProps(0).Value = "Calc MS Excel 2007 XML"',
    '  saveProps(1).Name = "Overwrite" : saveProps(1).Value = True',
    '  doc.storeAsURL(outputUrl, saveProps())',
    '  doc.close(True)',
    'End Sub',
  ].join('\n');
  await writeFile(join(libraryDirectory, 'script.xlb'), basicLibraryXml());
  await writeFile(join(libraryDirectory, 'Module1.xba'), basicXml(source));
  const result = spawnSync('soffice', [
    '--headless',
    '--nologo',
    '--nodefault',
    '--nolockcheck',
    `-env:UserInstallation=file://${profileDirectory}`,
    'macro:///Standard.Module1.Main',
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`soffice calculateAll fallback failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
}

async function recalculate(input, output, tempDirectory) {
  const conversionDirectory = join(tempDirectory, 'conversion');
  await mkdir(conversionDirectory, { recursive: true });
  const convertedPath = join(conversionDirectory, input.split('/').pop());
  try {
    runSofficeConversion(input, conversionDirectory);
    const converted = normalizeXlsxZip(await readFile(convertedPath));
    assertFormulaCaches(converted, input);
    await writeFile(output, converted);
    return { method: 'convert-to' };
  } catch (conversionError) {
    const fallbackDirectory = join(tempDirectory, 'fallback');
    await mkdir(fallbackDirectory, { recursive: true });
    const fallbackOutput = join(fallbackDirectory, input.split('/').pop());
    await recalculateWithMacro(input, fallbackOutput, join(tempDirectory, 'profile'));
    const recalculated = normalizeXlsxZip(await readFile(fallbackOutput));
    assertFormulaCaches(recalculated, input);
    await writeFile(output, recalculated);
    return { method: 'calculateAll', conversionError: conversionError.message };
  }
}

function validateSpec(spec, fileName) {
  if (!spec.name || spec.name !== fileName.replace(/\.json$/, '')) throw new Error(`Spec name does not match ${fileName}`);
  if (!Array.isArray(spec.sheets) || spec.sheets.length === 0) throw new Error(`${fileName} must contain sheets`);
  if (!Array.isArray(spec.excludeFromFidelity)) throw new Error(`${fileName} must contain excludeFromFidelity[]`);
  for (const sheet of spec.sheets) {
    if (!sheet.name || typeof sheet.cells !== 'object') throw new Error(`${fileName} has an invalid sheet`);
    for (const [address, rawCell] of Object.entries(sheet.cells)) {
      cellAddressParts(address);
      const cell = normalizeCell(rawCell);
      if (cell.formula !== undefined && cell.cached === undefined && cell.value === undefined) {
        throw new Error(`${fileName} formula ${sheet.name}!${address} needs a cached value`);
      }
    }
  }
}

async function updateDecisions(version) {
  const existing = await readFile(DECISIONS_PATH, 'utf8');
  const line = `- Session 1 fixture generation uses ${version}; the generator records this version in every fixture spec.`;
  const lines = existing.split(/\r?\n/);
  const markerIndex = lines.findIndex((entry) => entry.includes('Session 1 fixture generation uses '));
  if (markerIndex >= 0) lines[markerIndex] = line;
  else {
    const sectionIndex = lines.findIndex((entry) => entry.trim() === '## Session 0');
    const insertAt = sectionIndex >= 0 ? sectionIndex : lines.length;
    lines.splice(insertAt, 0, '## Session 1', '', line, '');
  }
  await writeFile(DECISIONS_PATH, lines.join('\n').replace(/\n+$/, '\n'));
}

export async function generateFixtures() {
  const version = sofficeVersion();
  const tempDirectory = await mkdtemp(join('/tmp', 'sheetsleuth-fixtures-'));
  const methods = [];
  try {
    await mkdir(SPECS_DIR, { recursive: true });
    await mkdir(XLSX_DIR, { recursive: true });
    await updateDecisions(version);

    const files = (await readdir(SPECS_DIR)).filter((file) => file.endsWith('.json')).sort();
    const expectedFiles = new Set(FIXTURE_NAMES.map((name) => `${name}.json`));
    const unexpected = files.filter((file) => expectedFiles.has(file) === false);
    if (unexpected.length) throw new Error(`Unexpected fixture specs in ${SPECS_DIR}: ${unexpected.join(', ')}`);

    for (const name of FIXTURE_NAMES) {
      const fileName = `${name}.json`;
      const specPath = join(SPECS_DIR, fileName);
      const spec = JSON.parse(await readFile(specPath, 'utf8'));
      validateSpec(spec, fileName);
      spec.sofficeVersion = version;
      await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);

      const barePath = join(tempDirectory, `${name}.xlsx`);
      const outputPath = join(XLSX_DIR, `${name}.xlsx`);
      await writeFile(barePath, buildXlsx(spec));
      const method = await recalculate(barePath, outputPath, tempDirectory);
      assertFormulaCaches(await readFile(outputPath), outputPath);
      methods.push(`${name}:${method.method}`);
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
  return { version, methods };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  generateFixtures()
    .then(({ version, methods }) => {
      process.stdout.write(`Generated ${FIXTURE_NAMES.length} fixtures with ${version}\n${methods.join('\n')}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}

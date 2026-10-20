import { unzipSync } from 'fflate';

import { unverified } from '../model/index.js';
import type { Cell, Sheet, Value, Workbook } from '../model/index.js';
import { XlsxReadError } from './errors.js';
import { checkZipSafety } from './safety.js';

export interface ReadXlsxSuccess {
  readonly ok: true;
  readonly workbook: Workbook;
}

export interface ReadXlsxFailure {
  readonly ok: false;
  readonly error: XlsxReadError;
}

/** Result returned by the public XLSX reader. It never throws for bad input. */
export type ReadXlsxResult = ReadXlsxSuccess | ReadXlsxFailure;

interface XmlNode {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly children: XmlNode[];
  readonly content: Array<XmlNode | string>;
}

interface Relationship {
  readonly target: string;
  readonly type: string;
}

interface StyleInfo {
  readonly isDate: boolean;
}

interface ParsedCell {
  readonly node: XmlNode;
  readonly address: string;
  readonly row: number;
  readonly column: number;
  readonly value: Value;
  readonly hasValue: boolean;
  readonly formulaText?: string;
  readonly formulaType?: string;
  readonly sharedIndex?: string;
  readonly arrayReference?: string;
}

interface SharedFormula {
  readonly address: string;
  readonly formula: string;
}

const decoder = new TextDecoder();
const XML_PART_PATTERN = /(?:\.xml|\.rels)$/i;
const BUILT_IN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47,
]);

const fail = (
  code: ConstructorParameters<typeof XlsxReadError>[0],
  message: string,
  path?: string,
): never => {
  throw new XlsxReadError(code, message, path);
};

const localName = (name: string): string => {
  const separator = name.lastIndexOf(':');
  return separator >= 0 ? name.slice(separator + 1) : name;
};

const attribute = (node: XmlNode, name: string): string | undefined => {
  if (node.attrs[name] !== undefined) {
    return node.attrs[name];
  }
  return Object.entries(node.attrs).find(([key]) => localName(key) === name)?.[1];
};

const child = (node: XmlNode, name: string): XmlNode | undefined =>
  node.children.find((candidate) => localName(candidate.name) === name);

const children = (node: XmlNode, name: string): XmlNode[] =>
  node.children.filter((candidate) => localName(candidate.name) === name);

const descendants = (node: XmlNode, name: string): XmlNode[] => {
  const result: XmlNode[] = [];
  for (const candidate of node.children) {
    if (localName(candidate.name) === name) {
      result.push(candidate);
    }
    result.push(...descendants(candidate, name));
  }
  return result;
};

const textContent = (node: XmlNode): string =>
  node.content.map((part) => (typeof part === 'string' ? part : textContent(part))).join('');

const decodeXmlEntities = (value: string, path: string): string => {
  try {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, body: string) => {
      if (body.toLowerCase() === 'amp') return '&';
      if (body.toLowerCase() === 'lt') return '<';
      if (body.toLowerCase() === 'gt') return '>';
      if (body.toLowerCase() === 'quot') return '"';
      if (body.toLowerCase() === 'apos') return "'";
      const codePoint = body.toLowerCase().startsWith('#x')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        fail('invalid-xml', `Invalid XML character entity in ${path}.`, path);
      }
      return String.fromCodePoint(codePoint);
    });
  } catch (error) {
    if (error instanceof XlsxReadError) throw error;
    return fail('invalid-xml', `Unable to decode XML entities in ${path}.`, path);
  }
};

const findTagEnd = (xml: string, start: number, path: string): number => {
  let quote: '"' | "'" | undefined;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return fail('invalid-xml', `An XML tag in ${path} is not closed.`, path);
};

const parseStartTag = (
  body: string,
  path: string,
): { name: string; attrs: Record<string, string>; selfClosing: boolean } => {
  let value = body.trim();
  const selfClosing = /\/\s*$/.test(value);
  if (selfClosing) value = value.replace(/\/\s*$/, '').trim();

  let cursor = 0;
  const skipWhitespace = () => {
    while (/\s/.test(value[cursor] ?? '')) cursor += 1;
  };
  const readName = (): string => {
    const start = cursor;
    while (cursor < value.length && !/[\s=]/.test(value[cursor]!)) cursor += 1;
    return value.slice(start, cursor);
  };

  skipWhitespace();
  const name = readName();
  if (!name) fail('invalid-xml', `An XML element in ${path} has no name.`, path);

  const attrs: Record<string, string> = {};
  while (cursor < value.length) {
    skipWhitespace();
    if (cursor >= value.length) break;
    const attrName = readName();
    if (!attrName) fail('invalid-xml', `An XML attribute in ${path} has no name.`, path);
    skipWhitespace();
    if (value[cursor] !== '=') {
      fail('invalid-xml', `XML attribute ${attrName} in ${path} has no value.`, path);
    }
    cursor += 1;
    skipWhitespace();
    const quote = value[cursor];
    if (quote !== '"' && quote !== "'") {
      fail('invalid-xml', `XML attribute ${attrName} in ${path} is not quoted.`, path);
    }
    cursor += 1;
    const start = cursor;
    while (cursor < value.length && value[cursor] !== quote) cursor += 1;
    if (cursor >= value.length) {
      fail('invalid-xml', `XML attribute ${attrName} in ${path} is not closed.`, path);
    }
    attrs[attrName] = decodeXmlEntities(value.slice(start, cursor), path);
    cursor += 1;
  }

  return { name, attrs, selfClosing };
};

const parseXml = (xml: string, path: string): XmlNode => {
  const document: XmlNode = { name: '#document', attrs: {}, children: [], content: [] };
  const stack: XmlNode[] = [document];
  let cursor = 0;

  while (cursor < xml.length) {
    const opening = xml.indexOf('<', cursor);
    if (opening < 0) {
      const text = xml.slice(cursor);
      if (text) {
        stack[stack.length - 1]!.content.push(decodeXmlEntities(text, path));
      }
      break;
    }

    if (opening > cursor) {
      stack[stack.length - 1]!.content.push(decodeXmlEntities(xml.slice(cursor, opening), path));
    }

    if (xml.startsWith('<!--', opening)) {
      const commentEnd = xml.indexOf('-->', opening + 4);
      if (commentEnd < 0) fail('invalid-xml', `An XML comment in ${path} is not closed.`, path);
      cursor = commentEnd + 3;
      continue;
    }

    if (xml.startsWith('<![CDATA[', opening)) {
      const cdataEnd = xml.indexOf(']]>', opening + 9);
      if (cdataEnd < 0) fail('invalid-xml', `A CDATA section in ${path} is not closed.`, path);
      stack[stack.length - 1]!.content.push(xml.slice(opening + 9, cdataEnd));
      cursor = cdataEnd + 3;
      continue;
    }

    if (xml.startsWith('<?', opening)) {
      const instructionEnd = xml.indexOf('?>', opening + 2);
      if (instructionEnd < 0)
        fail('invalid-xml', `An XML declaration in ${path} is not closed.`, path);
      cursor = instructionEnd + 2;
      continue;
    }

    if (/^<!DOCTYPE\b/i.test(xml.slice(opening))) {
      fail('xml-doctype', `DOCTYPE declarations are not allowed in ${path}.`, path);
    }

    if (xml.startsWith('</', opening)) {
      const closeEnd = xml.indexOf('>', opening + 2);
      if (closeEnd < 0) fail('invalid-xml', `An XML closing tag in ${path} is not closed.`, path);
      const name = xml.slice(opening + 2, closeEnd).trim();
      const current = stack[stack.length - 1];
      if (stack.length === 1 || localName(current!.name) !== localName(name)) {
        fail('invalid-xml', `Mismatched XML closing tag in ${path}.`, path);
      }
      stack.pop();
      cursor = closeEnd + 1;
      continue;
    }

    if (xml.startsWith('<!', opening)) {
      fail('invalid-xml', `Unsupported XML declaration in ${path}.`, path);
    }

    const tagEnd = findTagEnd(xml, opening + 1, path);
    const tag = parseStartTag(xml.slice(opening + 1, tagEnd), path);
    const node: XmlNode = { name: tag.name, attrs: tag.attrs, children: [], content: [] };
    stack[stack.length - 1]!.children.push(node);
    stack[stack.length - 1]!.content.push(node);
    if (!tag.selfClosing) stack.push(node);
    cursor = tagEnd + 1;
  }

  if (stack.length !== 1 || document.children.length !== 1) {
    fail('invalid-xml', `The XML document ${path} is incomplete.`, path);
  }
  return document.children[0]!;
};

const normalizePath = (path: string): string => {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
};

const resolveTarget = (basePath: string, target: string): string => {
  let decodedTarget = target;
  try {
    decodedTarget = decodeURIComponent(target);
  } catch {
    // Keep the literal target; the missing-part error will remain readable.
  }
  if (decodedTarget.startsWith('/')) return normalizePath(decodedTarget);
  const baseDirectory = basePath.slice(0, basePath.lastIndexOf('/') + 1);
  return normalizePath(`${baseDirectory}${decodedTarget}`);
};

const readXmlPart = (files: Record<string, Uint8Array>, path: string): XmlNode => {
  const bytes = files[path];
  if (!bytes) fail('missing-part', `The XLSX part ${path} is missing.`, path);
  return parseXml(decoder.decode(bytes), path);
};

const readRelationships = (
  files: Record<string, Uint8Array>,
  path: string,
): Map<string, Relationship> => {
  const root = readXmlPart(files, path);
  const result = new Map<string, Relationship>();
  for (const node of descendants(root, 'Relationship')) {
    const id = attribute(node, 'Id');
    const target = attribute(node, 'Target');
    const type = attribute(node, 'Type');
    if (!id || !target || !type)
      fail('invalid-workbook', `Relationship in ${path} is missing an attribute.`, path);
    result.set(id!, {
      target: resolveTarget(path.replace(/\/_rels\/([^/]+)\.rels$/i, '/$1'), target!),
      type: type!,
    });
  }
  return result;
};

const stripFormulaPrefixes = (formula: string): string => formula.replace(/_(?:xlfn|xlws)\./gi, '');

const columnToNumber = (letters: string): number => {
  let result = 0;
  for (const character of letters.toUpperCase())
    result = result * 26 + character.charCodeAt(0) - 64;
  return result;
};

const numberToColumn = (number: number): string => {
  let result = '';
  let value = number;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || 'A';
};

const parseAddress = (address: string): { row: number; column: number } => {
  const match = /^([A-Za-z]{1,3})(\d+)$/.exec(address);
  if (!match) fail('invalid-workbook', `Invalid cell address ${address}.`);
  const row = Number.parseInt(match![2]!, 10);
  const column = columnToNumber(match![1]!);
  if (!Number.isSafeInteger(row) || row < 1 || column < 1) {
    fail('invalid-workbook', `Invalid cell address ${address}.`);
  }
  return { row, column };
};

const shiftFormulaSegment = (
  formula: string,
  source: { row: number; column: number },
  target: { row: number; column: number },
): string => {
  const rowDelta = target.row - source.row;
  const columnDelta = target.column - source.column;
  const reference = /(^|[^A-Za-z0-9_])(?:(\$?)([A-Za-z]{1,3})(\$?)(\d+))(?![A-Za-z0-9_]|\s*\()/g;
  return formula.replace(
    reference,
    (
      whole,
      boundary: string,
      columnAbsolute: string,
      letters: string,
      rowAbsolute: string,
      rowText: string,
    ) => {
      const row = Number.parseInt(rowText, 10);
      const column = columnToNumber(letters);
      const shiftedColumn = columnAbsolute ? column : Math.max(1, column + columnDelta);
      const shiftedRow = rowAbsolute ? row : Math.max(1, row + rowDelta);
      return `${boundary}${columnAbsolute ? '$' : ''}${numberToColumn(shiftedColumn)}${rowAbsolute ? '$' : ''}${shiftedRow}`;
    },
  );
};

const shiftFormula = (formula: string, sourceAddress: string, targetAddress: string): string => {
  const source = parseAddress(sourceAddress);
  const target = parseAddress(targetAddress);
  let result = '';
  let segmentStart = 0;
  let cursor = 0;

  while (cursor < formula.length) {
    const quote = formula[cursor];
    if (quote !== '"' && quote !== "'") {
      cursor += 1;
      continue;
    }
    result += shiftFormulaSegment(formula.slice(segmentStart, cursor), source, target);
    const quoteStart = cursor;
    cursor += 1;
    while (cursor < formula.length) {
      if (formula[cursor] === quote) {
        if (formula[cursor + 1] === quote) {
          cursor += 2;
          continue;
        }
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    result += formula.slice(quoteStart, cursor);
    segmentStart = cursor;
  }

  return result + shiftFormulaSegment(formula.slice(segmentStart), source, target);
};

const containsStructuredReference = (formula: string): boolean => {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < formula.length; index += 1) {
    const character = formula[index];
    if (quote !== undefined) {
      if (character === quote) {
        if (formula[index + 1] === quote) index += 1;
        else quote = undefined;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[' || character === ']') {
      return true;
    }
  }
  return false;
};

const dateFormatCodeIsDate = (formatCode: string): boolean => {
  const withoutQuotedText = formatCode.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  return /(?:\[[^\]]*(?:d|h|m|s|y)[^\]]*\]|[dmyhs])/i.test(withoutQuotedText);
};

const readStyles = (root: XmlNode): StyleInfo[] => {
  const customFormats = new Map<number, string>();
  const numFmts = child(root, 'numFmts');
  for (const node of numFmts ? children(numFmts, 'numFmt') : []) {
    const id = Number.parseInt(attribute(node, 'numFmtId') ?? '', 10);
    const code = attribute(node, 'formatCode');
    if (Number.isInteger(id) && code !== undefined) customFormats.set(id, code);
  }

  const cellXfs = child(root, 'cellXfs');
  return (cellXfs ? children(cellXfs, 'xf') : []).map((node) => {
    const id = Number.parseInt(attribute(node, 'numFmtId') ?? '', 10);
    return {
      isDate: BUILT_IN_DATE_FORMAT_IDS.has(id) || dateFormatCodeIsDate(customFormats.get(id) ?? ''),
    };
  });
};

const dateWithTime = (date: Date, serial: number): string => {
  if (Math.abs(serial - Math.floor(serial)) < Number.EPSILON)
    return date.toISOString().slice(0, 10);
  return date.toISOString();
};

const excelDate = (serial: number, dateSystem: '1900' | '1904'): string => {
  if (dateSystem === '1900' && Math.floor(serial) === 60) {
    const fraction = serial - 60;
    const time = new Date(Math.round(fraction * 86_400_000));
    return `1900-02-29${fraction ? `T${time.toISOString().slice(11)}` : ''}`;
  }
  const effectiveSerial = dateSystem === '1900' ? serial - (serial >= 60 ? 1 : 0) : serial;
  const base = Date.UTC(
    dateSystem === '1900' ? 1899 : 1904,
    dateSystem === '1900' ? 11 : 0,
    dateSystem === '1900' ? 31 : 1,
  );
  return dateWithTime(new Date(base + effectiveSerial * 86_400_000), serial);
};

const readCellValue = (
  node: XmlNode,
  sharedStrings: readonly string[],
  styles: readonly StyleInfo[],
  dateSystem: '1900' | '1904',
): { value: Value; hasValue: boolean } => {
  const type = attribute(node, 't');
  const styleIndex = Number.parseInt(attribute(node, 's') ?? '', 10);
  const isDate = Number.isInteger(styleIndex) && styles[styleIndex]?.isDate === true;
  const valueNode = child(node, 'v');
  const inlineNode = child(node, 'is');

  if (type === 'inlineStr')
    return { value: inlineNode ? textContent(inlineNode) : '', hasValue: true };
  if (!valueNode) return { value: null, hasValue: false };

  const raw = textContent(valueNode);
  if (type === 's') {
    const index = Number.parseInt(raw, 10);
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      fail('invalid-workbook', `Shared string index ${raw || '<empty>'} is invalid.`);
    }
    return { value: sharedStrings[index]!, hasValue: true };
  }
  if (type === 'b') return { value: raw === '1' || raw.toLowerCase() === 'true', hasValue: true };
  if (type === 'e') return { value: { kind: 'error', code: raw || '#ERROR!' }, hasValue: true };
  if (type === 'str' || type === 'd') return { value: raw, hasValue: true };

  if (raw === '') return { value: null, hasValue: true };
  const number = Number(raw);
  if (!Number.isFinite(number)) return { value: raw, hasValue: true };
  return { value: isDate ? excelDate(number, dateSystem) : number, hasValue: true };
};

const readSharedStrings = (root: XmlNode): string[] =>
  children(root, 'si').map((item) =>
    descendants(item, 't')
      .map((text) => textContent(text))
      .join(''),
  );

const parseFormula = (
  node: XmlNode,
): { text: string; type: string; sharedIndex?: string; arrayReference?: string } => ({
  text: stripFormulaPrefixes(textContent(node).trim()),
  type: attribute(node, 't') ?? 'normal',
  sharedIndex: attribute(node, 'si'),
  arrayReference: attribute(node, 'ref'),
});

const readSheet = (
  root: XmlNode,
  sharedStrings: readonly string[],
  styles: readonly StyleInfo[],
  dateSystem: '1900' | '1904',
): Cell[] => {
  const sheetData = descendants(root, 'sheetData')[0];
  if (!sheetData) return [];

  const parsed: ParsedCell[] = [];
  const sharedFormulas = new Map<string, SharedFormula>();
  for (const rowNode of descendants(sheetData, 'row')) {
    const rowNumber = Number.parseInt(attribute(rowNode, 'r') ?? '', 10);
    let implicitColumn = 1;
    for (const cellNode of children(rowNode, 'c')) {
      const address =
        attribute(cellNode, 'r') ??
        (Number.isInteger(rowNumber) ? `${numberToColumn(implicitColumn)}${rowNumber}` : '');
      if (!address) fail('invalid-workbook', 'A worksheet cell has no address.');
      const position = parseAddress(address);
      implicitColumn = position.column + 1;
      const formulaNode = child(cellNode, 'f');
      const formula = formulaNode ? parseFormula(formulaNode) : undefined;
      const cellValue = readCellValue(cellNode, sharedStrings, styles, dateSystem);
      const parsedCell: ParsedCell = {
        node: cellNode,
        address,
        row: position.row,
        column: position.column,
        value: cellValue.value,
        hasValue: cellValue.hasValue,
        formulaText: formula?.text,
        formulaType: formula?.type,
        sharedIndex: formula?.sharedIndex,
        arrayReference: formula?.arrayReference,
      };
      parsed.push(parsedCell);
      if (formula?.type === 'shared' && formula.text && formula.sharedIndex !== undefined) {
        sharedFormulas.set(formula.sharedIndex, { address, formula: formula.text });
      }
    }
  }

  return parsed.map((parsedCell) => {
    let formula = parsedCell.formulaText;
    if (parsedCell.formulaType === 'shared' && parsedCell.sharedIndex !== undefined) {
      if (!formula) {
        const anchor = sharedFormulas.get(parsedCell.sharedIndex);
        if (!anchor) {
          fail('invalid-workbook', `Shared formula ${parsedCell.sharedIndex} has no anchor.`);
        }
        formula = shiftFormula(anchor!.formula, anchor!.address, parsedCell.address);
      }
    }

    const reasons: string[] = [];
    if (parsedCell.formulaType === 'array') reasons.push('array formula');
    if (parsedCell.formulaType === 'dataTable') reasons.push('data table formula');
    if (formula && containsStructuredReference(formula)) reasons.push('structured reference');

    const cell: Cell = {
      address: parsedCell.address,
      row: parsedCell.row,
      column: parsedCell.column,
      value:
        formula && !parsedCell.hasValue
          ? unverified('formula has no cached value')
          : parsedCell.value,
    };
    if (formula !== undefined) {
      cell.formula = formula;
      if (parsedCell.hasValue) cell.cachedValue = parsedCell.value;
    }
    if (reasons.length > 0) cell.unsupportedReason = reasons.join('; ');
    return cell;
  });
};

const readWorkbook = (files: Record<string, Uint8Array>, name: string): Workbook => {
  const workbookPath = 'xl/workbook.xml';
  const workbookRoot = readXmlPart(files, workbookPath);
  const relationships = readRelationships(files, 'xl/_rels/workbook.xml.rels');
  const workbookProperties = child(workbookRoot, 'workbookPr');
  const dateSystem =
    attribute(
      workbookProperties ?? { attrs: {}, children: [], content: [], name: '' },
      'date1904',
    ) === '1'
      ? '1904'
      : '1900';
  const calcProperties = child(workbookRoot, 'calcPr');
  const rawCalcMode = attribute(
    calcProperties ?? { attrs: {}, children: [], content: [], name: '' },
    'calcMode',
  );
  const calcMode =
    rawCalcMode === 'manual'
      ? 'manual'
      : rawCalcMode === 'autoNoTable'
        ? 'automaticExceptTables'
        : 'auto';

  const sharedStringsRelation = [...relationships.values()].find((relation) =>
    relation.type.endsWith('/sharedStrings'),
  );
  const stylesRelation = [...relationships.values()].find((relation) =>
    relation.type.endsWith('/styles'),
  );
  const sharedStrings = sharedStringsRelation
    ? readSharedStrings(readXmlPart(files, sharedStringsRelation.target))
    : [];
  const styles = stylesRelation ? readStyles(readXmlPart(files, stylesRelation.target)) : [];

  const sheetsNode = child(workbookRoot, 'sheets');
  const workbookSheets = sheetsNode ? children(sheetsNode, 'sheet') : [];
  const sheets: Sheet[] = [];
  for (const sheetNode of workbookSheets) {
    const sheetName = attribute(sheetNode, 'name');
    const relationId = attribute(sheetNode, 'id');
    if (!sheetName || !relationId)
      fail('invalid-workbook', 'A workbook sheet is missing its name or relationship.');
    const safeSheetName = sheetName!;
    const safeRelationId = relationId!;
    const relation = relationships.get(safeRelationId);
    if (!relation || !relation.type.endsWith('/worksheet')) {
      fail('invalid-workbook', `Workbook sheet ${safeSheetName} has no worksheet relationship.`);
    }
    const state: Sheet['state'] =
      attribute(sheetNode, 'state') === 'hidden' || attribute(sheetNode, 'state') === 'veryHidden'
        ? (attribute(sheetNode, 'state') as 'hidden' | 'veryHidden')
        : 'visible';
    sheets.push({
      name: safeSheetName,
      cells: readSheet(readXmlPart(files, relation!.target), sharedStrings, styles, dateSystem),
      hidden: state !== 'visible',
      state,
    });
  }

  const definedNames: Record<string, string> = {};
  const definedNamesNode = child(workbookRoot, 'definedNames');
  for (const definedName of definedNamesNode ? children(definedNamesNode, 'definedName') : []) {
    const definedNameText = attribute(definedName, 'name');
    if (!definedNameText) fail('invalid-workbook', 'A defined name is missing its name.');
    const localSheetId = Number.parseInt(attribute(definedName, 'localSheetId') ?? '', 10);
    const scope =
      Number.isInteger(localSheetId) && sheets[localSheetId]?.name
        ? `${sheets[localSheetId]!.name}!`
        : '';
    definedNames[`${scope}${definedNameText}`] = stripFormulaPrefixes(
      textContent(definedName).trim(),
    );
  }

  return {
    name,
    sheets,
    definedNames: Object.keys(definedNames).length > 0 ? definedNames : undefined,
    dateSystem,
    calcMode,
  };
};

const readZip = (input: Uint8Array): Record<string, Uint8Array> => {
  const safety = checkZipSafety(input);
  if (!safety.ok) throw safety.error;

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input) as Record<string, Uint8Array>;
  } catch {
    return fail('invalid-zip', 'The XLSX ZIP archive could not be decompressed.');
  }

  for (const entry of safety.entries) {
    if (!XML_PART_PATTERN.test(entry.name)) continue;
    const bytes = files[entry.name];
    if (!bytes) continue;
    if (/<!DOCTYPE/i.test(decoder.decode(bytes))) {
      fail('xml-doctype', `DOCTYPE declarations are not allowed in ${entry.name}.`, entry.name);
    }
  }
  return files;
};

/** Reads the minimal workbook model and returns typed failures for bad XLSX input. */
export const readXlsx = (input: Uint8Array, name = 'workbook.xlsx'): ReadXlsxResult => {
  try {
    if (!(input instanceof Uint8Array)) {
      return {
        ok: false,
        error: new XlsxReadError('invalid-input', 'XLSX input must be a Uint8Array.'),
      };
    }
    return { ok: true, workbook: readWorkbook(readZip(input), name) };
  } catch (error) {
    if (error instanceof XlsxReadError) return { ok: false, error };
    return {
      ok: false,
      error: new XlsxReadError('invalid-workbook', 'The XLSX workbook could not be read.'),
    };
  }
};

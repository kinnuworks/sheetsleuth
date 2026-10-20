import { parseFormula } from '../formula/parser.js';
import type {
  A1Reference,
  CellReference,
  FormulaExpression,
  FormulaNode,
  ReferenceExpression,
} from '../formula/types.js';
import { Unverified } from '../model/index.js';
import type { ErrorValue, Value } from '../model/index.js';
import { SUPPORTED_FUNCTIONS, isSupportedFunction, type SupportedFunction } from './functions.js';
import type {
  CellValueSource,
  EvaluationContext,
  EvaluationResult,
  EvaluationValue,
  FormulaInput,
  RangeValue,
} from './types.js';
import { errorValue, isError, isUnverified } from './types.js';

const unverified = (reason: string): Unverified => new Unverified(reason);

const numberToColumn = (value: number): string => {
  let number = value;
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result || 'A';
};

const addressFor = (row: number, column: number): string => `${numberToColumn(column)}${row}`;

const getSource = (
  source: ReadonlyMap<string, CellValueSource> | Readonly<Record<string, CellValueSource>> | undefined,
  key: string,
): CellValueSource | undefined => {
  if (!source) return undefined;
  if (typeof (source as ReadonlyMap<string, CellValueSource>).get === 'function') {
    return (source as ReadonlyMap<string, CellValueSource>).get(key);
  }
  return (source as Readonly<Record<string, CellValueSource>>)[key];
};

const sourceValue = (source: CellValueSource | undefined): Value | undefined =>
  source === undefined ? undefined : typeof source === 'object' && source !== null && 'value' in source ? source.value : source;

const readCell = (context: EvaluationContext, sheet: string, row: number, column: number): Value => {
  const address = addressFor(row, column);
  const keys = [`${sheet}!${address}`, address];
  for (const candidate of keys) {
    const value = sourceValue(getSource(context.cells, candidate));
    if (value !== undefined) return value;
  }
  return unverified(`Cell ${sheet}!${address} is not available`);
};

const readName = (context: EvaluationContext, name: string): Value => {
  const source = getSource(context.names, name) ?? getSource(context.names, name.toUpperCase());
  return sourceValue(source) ?? unverified(`Defined name ${name} is not available`);
};

const asNumber = (value: EvaluationValue): number | ErrorValue | Unverified => {
  if (isUnverified(value)) return value;
  if (isError(value)) return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return errorValue('#VALUE!');
};

const asText = (value: EvaluationValue): string | ErrorValue | Unverified => {
  if (isUnverified(value)) return value;
  if (isError(value)) return value;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
};

const asBoolean = (value: EvaluationValue): boolean | ErrorValue | Unverified => {
  if (isUnverified(value)) return value;
  if (isError(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  return false;
};

const firstSpecial = (values: readonly EvaluationValue[]): ErrorValue | Unverified | undefined =>
  values.find((value): value is ErrorValue | Unverified => isError(value) || isUnverified(value));

const matrix = (value: EvaluationValue): readonly (readonly Value[])[] =>
  value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'range'
    ? value.rows
    : [[value as Value]];

const flatten = (values: readonly EvaluationValue[]): Value[] => {
  const result: Value[] = [];
  for (const value of values) {
    if (value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'range') {
      for (const row of value.rows) result.push(...row);
    } else {
      result.push(value as Value);
    }
  }
  return result;
};

const numericValues = (values: readonly EvaluationValue[]): number[] | ErrorValue | Unverified => {
  const flattened = flatten(values);
  const special = firstSpecial(flattened);
  if (special) return special;
  return flattened.filter((value): value is number => typeof value === 'number');
};

const referenceBounds = (
  context: EvaluationContext,
  reference: A1Reference,
): { sheet: string; startRow: number; endRow: number; startColumn: number; endColumn: number } | Unverified => {
  const sheet = context.currentSheet ?? '';
  if (reference.kind === 'cell') {
    return { sheet, startRow: reference.row, endRow: reference.row, startColumn: reference.column, endColumn: reference.column };
  }
  if (reference.kind === 'row') {
    const rows = [...(context.cells instanceof Map ? context.cells.values() : Object.values(context.cells ?? {}))]
      .map(sourceValue)
      .length;
    return { sheet, startRow: reference.startRow, endRow: reference.endRow, startColumn: 1, endColumn: Math.max(1, rows) };
  }
  const columns = [...(context.cells instanceof Map ? context.cells.keys() : Object.keys(context.cells ?? {}))]
    .map((key) => /^([^!]+!)?([A-Z]+)\d+$/i.exec(key)?.[2]?.length ?? 1);
  return {
    sheet,
    startRow: 1,
    endRow: Math.max(1, columns.length),
    startColumn: reference.startColumn,
    endColumn: reference.endColumn,
  };
};

const rangeFromReferences = (
  context: EvaluationContext,
  left: ReferenceExpression,
  right?: ReferenceExpression,
): EvaluationValue => {
  if (left.reference.kind !== 'cell' && right !== undefined) return unverified('Range endpoint is not a cell reference');
  if (right !== undefined && right.reference.kind !== 'cell') return unverified('Range endpoint is not a cell reference');
  const first = left.reference as CellReference;
  const second = (right?.reference as CellReference | undefined) ?? first;
  const sheet = right?.sheet ?? left.sheet ?? context.currentSheet ?? '';
  const rows: Value[][] = [];
  for (let row = Math.min(first.row, second.row); row <= Math.max(first.row, second.row); row += 1) {
    const values: Value[] = [];
    for (let column = Math.min(first.column, second.column); column <= Math.max(first.column, second.column); column += 1) {
      values.push(readCell(context, sheet, row, column));
    }
    rows.push(values);
  }
  return { kind: 'range', rows };
};

const compare = (left: Value, right: Value): number => {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
};

const criteriaMatch = (value: Value, criteria: Value): boolean => {
  if (typeof criteria === 'number') return value === criteria;
  const text = String(criteria);
  const match = /^(<=|>=|<>|=|<|>)(.*)$/.exec(text);
  if (match === null) return String(value).toLowerCase() === text.toLowerCase();
  const right = match[2] ?? '';
  const numericRight = Number(right);
  const compared = Number.isFinite(numericRight) && typeof value === 'number'
    ? compare(value, numericRight)
    : compare(String(value), right);
  switch (match[1]) {
    case '=': return compared === 0;
    case '<>': return compared !== 0;
    case '<': return compared < 0;
    case '<=': return compared <= 0;
    case '>': return compared > 0;
    case '>=': return compared >= 0;
    default: return false;
  }
};

const excelSerial = (year: number, month: number, day: number, dateSystem: '1900' | '1904'): number => {
  if (dateSystem === '1900' && year === 1900 && month === 2 && day === 29) return 60;
  const date = new Date(Date.UTC(year, month - 1, day));
  const base = dateSystem === '1904' ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const serial = Math.round((date.getTime() - base) / 86_400_000);
  return dateSystem === '1900' && serial >= 60 ? serial + 1 : serial;
};

const dateParts = (serial: number, dateSystem: '1900' | '1904'): [number, number, number] => {
  if (dateSystem === '1900' && Math.floor(serial) === 60) return [1900, 2, 29];
  const adjusted = dateSystem === '1900' && serial > 60 ? serial - 1 : serial;
  const base = dateSystem === '1904' ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const date = new Date(base + Math.floor(adjusted) * 86_400_000);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
};

const evaluateFunction = (
  name: SupportedFunction,
  args: readonly FormulaExpression[],
  context: EvaluationContext,
): EvaluationValue => {
  const evaluate = (argument: FormulaExpression): EvaluationValue => evaluateExpression(argument, context);
  const values = args.map(evaluate);
  const special = name === 'IFERROR' ? undefined : firstSpecial(values);
  if (special) return special;
  const numberArgument = (index: number): number | ErrorValue | Unverified => asNumber(values[index] ?? null);

  switch (name) {
    case 'SUM': {
      const numbers = numericValues(values);
      return Array.isArray(numbers) ? numbers.reduce((sum, value) => sum + value, 0) : numbers;
    }
    case 'AVERAGE': {
      const numbers = numericValues(values);
      return Array.isArray(numbers) ? numbers.length === 0 ? errorValue('#DIV/0!') : numbers.reduce((sum, value) => sum + value, 0) / numbers.length : numbers;
    }
    case 'COUNT': {
      const flattened = flatten(values);
      return flattened.filter((value) => typeof value === 'number').length;
    }
    case 'COUNTA': {
      const flattened = flatten(values);
      return flattened.filter((value) => value !== null && value !== '').length;
    }
    case 'MIN':
    case 'MAX': {
      const numbers = numericValues(values);
      return Array.isArray(numbers) ? numbers.length === 0 ? 0 : name === 'MIN' ? Math.min(...numbers) : Math.max(...numbers) : numbers;
    }
    case 'ROUND': {
      const number = numberArgument(0);
      const digits = numberArgument(1);
      if (typeof number !== 'number') return number;
      if (typeof digits !== 'number') return digits;
      const factor = 10 ** digits;
      return Math.sign(number) * Math.floor(Math.abs(number) * factor + 0.5) / factor;
    }
    case 'ABS': {
      const number = numberArgument(0);
      return typeof number === 'number' ? Math.abs(number) : number;
    }
    case 'IF': {
      const condition = asBoolean(values[0] ?? null);
      if (typeof condition !== 'boolean') return condition;
      return evaluate(condition ? args[1] : args[2] ?? { type: 'number', value: 0, raw: '0', span: { start: 0, end: 0 } });
    }
    case 'IFERROR': {
      const first = values[0] ?? null;
      return isError(first) ? values[1] ?? null : first;
    }
    case 'AND':
    case 'OR': {
      const booleans = values.map(asBoolean);
      const booleanSpecial = firstSpecial(booleans);
      if (booleanSpecial) return booleanSpecial;
      return name === 'AND' ? booleans.every(Boolean) : booleans.some(Boolean);
    }
    case 'NOT': {
      const boolean = asBoolean(values[0] ?? null);
      return typeof boolean === 'boolean' ? !boolean : boolean;
    }
    case 'SUMIF':
    case 'COUNTIF': {
      const criteriaRange = matrix(values[0] ?? null).flat();
      const criteria = flatten([values[1] ?? null])[0] ?? null;
      const sumRange = name === 'SUMIF' ? matrix(values[2] ?? values[0] ?? null).flat() : criteriaRange;
      const matched = criteriaRange.map((value, index) => criteriaMatch(value, criteria) ? sumRange[index] ?? null : null);
      if (name === 'COUNTIF') return matched.filter((value) => value !== null).length;
      const numbers = matched.filter((value): value is number => typeof value === 'number');
      return numbers.reduce((sum, value) => sum + value, 0);
    }
    case 'VLOOKUP':
    case 'HLOOKUP': {
      const lookup = flatten([values[0] ?? null])[0] ?? null;
      const table = matrix(values[1] ?? null);
      const index = numberArgument(2);
      if (typeof index !== 'number') return index;
      const approximate = values[3] === undefined ? true : asBoolean(values[3]);
      if (typeof approximate !== 'boolean') return approximate;
      const candidates = name === 'VLOOKUP'
        ? table.map((row, rowIndex) => ({ key: row[0] ?? null, index: rowIndex }))
        : (table[0] ?? []).map((item, columnIndex) => ({ key: item, index: columnIndex }));
      let found: { key: Value; index: number } | undefined;
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index]!;
        if (approximate ? compare(candidate.key, lookup) <= 0 : compare(candidate.key, lookup) === 0) {
          found = candidate;
          break;
        }
      }
      if (!found) return errorValue('#N/A');
      if (name === 'VLOOKUP') return table[found.index]?.[Math.max(0, Math.floor(index) - 1)] ?? errorValue('#REF!');
      return table[Math.max(0, Math.floor(index) - 1)]?.[found.index] ?? errorValue('#REF!');
    }
    case 'INDEX': {
      const table = matrix(values[0] ?? null);
      const row = numberArgument(1);
      const column = args[2] === undefined ? 1 : numberArgument(2);
      if (typeof row !== 'number') return row;
      if (typeof column !== 'number') return column;
      return table[Math.floor(row) - 1]?.[Math.floor(column) - 1] ?? errorValue('#REF!');
    }
    case 'MATCH': {
      const lookup = flatten([values[0] ?? null])[0] ?? null;
      const candidates = matrix(values[1] ?? null).flat();
      const matchType = args[2] === undefined ? 1 : numberArgument(2);
      if (typeof matchType !== 'number') return matchType;
      const exact = candidates.findIndex((candidate) => compare(candidate, lookup) === 0);
      if (matchType === 0) return exact < 0 ? errorValue('#N/A') : exact + 1;
      let selected = -1;
      candidates.forEach((candidate, index) => {
        if ((matchType > 0 && compare(candidate, lookup) <= 0) || (matchType < 0 && compare(candidate, lookup) >= 0)) selected = index;
      });
      return selected < 0 ? errorValue('#N/A') : selected + 1;
    }
    case 'LEFT':
    case 'RIGHT': {
      const text = asText(values[0] ?? null);
      const count = args[1] === undefined ? 1 : numberArgument(1);
      if (typeof text !== 'string') return text;
      if (typeof count !== 'number') return count;
      return name === 'LEFT' ? text.slice(0, Math.max(0, count)) : text.slice(Math.max(0, text.length - count));
    }
    case 'LEN': {
      const text = asText(values[0] ?? null);
      return typeof text === 'string' ? text.length : text;
    }
    case 'CONCATENATE': {
      const texts = values.map(asText);
      const textSpecial = firstSpecial(texts);
      return textSpecial ?? texts.join('');
    }
    case 'DATE': {
      const year = numberArgument(0);
      const month = numberArgument(1);
      const day = numberArgument(2);
      if (typeof year !== 'number') return year;
      if (typeof month !== 'number') return month;
      if (typeof day !== 'number') return day;
      return excelSerial(year, month, day, context.dateSystem ?? '1900');
    }
    case 'YEAR':
    case 'MONTH':
    case 'DAY': {
      const serial = numberArgument(0);
      if (typeof serial !== 'number') return serial;
      const parts = dateParts(serial, context.dateSystem ?? '1900');
      return name === 'YEAR' ? parts[0] : name === 'MONTH' ? parts[1] : parts[2];
    }
    case 'PMT': {
      const rate = numberArgument(0);
      const periods = numberArgument(1);
      const present = numberArgument(2);
      const future = args[3] === undefined ? 0 : numberArgument(3);
      const type = args[4] === undefined ? 0 : numberArgument(4);
      if (typeof rate !== 'number') return rate;
      if (typeof periods !== 'number') return periods;
      if (typeof present !== 'number') return present;
      if (typeof future !== 'number') return future;
      if (typeof type !== 'number') return type;
      if (rate === 0) return -(present + future) / periods;
      const factor = (1 + rate) ** periods;
      return -(present * factor + future) * rate * (1 + rate * type) / (factor - 1);
    }
  }
};

export const evaluateExpression = (expression: FormulaExpression, context: EvaluationContext = {}): EvaluationValue => {
  switch (expression.type) {
    case 'number': return expression.value;
    case 'string': return expression.value;
    case 'boolean': return expression.value;
    case 'error': return errorValue(expression.code);
    case 'name': return readName(context, expression.name);
    case 'reference': {
      const bounds = referenceBounds(context, expression.reference);
      if (bounds instanceof Unverified) return bounds;
      if (expression.reference.kind === 'cell') {
        const sheet = expression.sheet ?? context.currentSheet ?? '';
        return readCell(context, sheet, expression.reference.row, expression.reference.column);
      }
      const sheet = expression.sheet ?? context.currentSheet ?? '';
      const rows: Value[][] = [];
      for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
        const current: Value[] = [];
        for (let column = bounds.startColumn; column <= bounds.endColumn && column < 10000; column += 1) current.push(readCell(context, sheet, row, column));
        rows.push(current);
        if (row > bounds.startRow + 10000) break;
      }
      return { kind: 'range', rows };
    }
    case 'range':
      if (expression.left.type !== 'reference' || expression.right.type !== 'reference') return unverified('Computed ranges are not supported');
      return rangeFromReferences(context, expression.left, expression.right);
    case 'union': {
      const evaluated = expression.items.map((item) => evaluateExpression(item, context));
      const special = firstSpecial(evaluated);
      if (special) return special;
      return { kind: 'range', rows: [flatten(evaluated)] };
    }
    case 'intersection': return unverified('Intersection evaluation is not supported');
    case 'array': return unverified('Array constants are not supported');
    case 'missing': return null;
    case 'invalid': return unverified(`Invalid formula expression: ${expression.raw}`);
    case 'parenthesized': return evaluateExpression(expression.expression, context);
    case 'percent': {
      const value = asNumber(evaluateExpression(expression.operand, context));
      return typeof value === 'number' ? value / 100 : value;
    }
    case 'spill': return unverified('Spill references are not supported');
    case 'unary': {
      const value = asNumber(evaluateExpression(expression.operand, context));
      if (typeof value !== 'number') return value;
      return expression.operator === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluateExpression(expression.left, context);
      const right = evaluateExpression(expression.right, context);
      const special = firstSpecial([left, right]);
      if (special) return special;
      if (expression.operator === '&') {
        const leftText = asText(left);
        const rightText = asText(right);
        return typeof leftText === 'string' && typeof rightText === 'string' ? leftText + rightText : firstSpecial([leftText, rightText])!;
      }
      if (['=', '<>', '<', '<=', '>', '>='].includes(expression.operator)) {
        const comparison = compare(left as Value, right as Value);
        switch (expression.operator) {
          case '=': return comparison === 0;
          case '<>': return comparison !== 0;
          case '<': return comparison < 0;
          case '<=': return comparison <= 0;
          case '>': return comparison > 0;
          case '>=': return comparison >= 0;
        }
      }
      const leftNumber = asNumber(left);
      const rightNumber = asNumber(right);
      if (typeof leftNumber !== 'number') return leftNumber;
      if (typeof rightNumber !== 'number') return rightNumber;
      switch (expression.operator) {
        case '+': return leftNumber + rightNumber;
        case '-': return leftNumber - rightNumber;
        case '*': return leftNumber * rightNumber;
        case '/': return rightNumber === 0 ? errorValue('#DIV/0!') : leftNumber / rightNumber;
        case '^': return leftNumber ** rightNumber;
        default: return unverified(`Unsupported operator ${expression.operator}`);
      }
    }
    case 'call': {
      const name = expression.name.replace(/^_(?:xlfn|xlws)\./i, '').toUpperCase();
      if (!isSupportedFunction(name)) return unverified(`Unsupported function ${name}`);
      return evaluateFunction(name, expression.args, context);
    }
  }
};

export const evaluateFormula = (input: FormulaInput, context: EvaluationContext = {}): EvaluationResult => {
  const node: FormulaNode = typeof input === 'string'
    ? parseFormula(input)
    : 'type' in input && input.type === 'formula'
      ? input
      : { type: 'formula', expression: input, leadingEquals: false, span: input.span };
  if (node.diagnostics && node.diagnostics.length > 0) return unverified(node.diagnostics[0]!.message);
  const result = evaluateExpression(node.expression, context);
  if (isUnverified(result)) return result;
  if (isError(result)) return result;
  if (result !== null && typeof result === 'object' && 'kind' in result && result.kind === 'range') return unverified('Formula result is a range');
  return result;
};

export { SUPPORTED_FUNCTIONS };

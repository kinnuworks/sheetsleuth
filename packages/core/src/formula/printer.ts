import type {
  A1Reference,
  CellPosition,
  FormulaExpression,
  FormulaNode,
  SourceSpan,
} from './types.js';
import { parseFormula } from './parser.js';

export interface PrintOptions {
  readonly r1c1Host?: CellPosition;
  readonly includeEquals?: boolean;
}

const precedence = (expression: FormulaExpression): number => {
  switch (expression.type) {
    case 'union':
      return 10;
    case 'intersection':
      return 20;
    case 'binary':
      if (['=', '<>', '<', '<=', '>', '>='].includes(expression.operator)) return 30;
      if (expression.operator === '&') return 40;
      if (expression.operator === '+' || expression.operator === '-') return 50;
      if (expression.operator === '*' || expression.operator === '/') return 60;
      return 80;
    case 'unary':
      return 75;
    case 'percent':
    case 'spill':
      return 90;
    default:
      return 100;
  }
};

const columnLetters = (column: number): string => {
  let current = column;
  let result = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result || 'A';
};

const sheetText = (sheet: string): string => {
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet)) return sheet;
  return `'${sheet.replace(/'/g, "''")}'`;
};

const a1Reference = (reference: A1Reference): string => {
  switch (reference.kind) {
    case 'cell':
      return `${reference.columnAbsolute ? '$' : ''}${columnLetters(reference.column)}${reference.rowAbsolute ? '$' : ''}${reference.row}`;
    case 'row':
      return `${reference.startAbsolute ? '$' : ''}${reference.startRow}:${reference.endAbsolute ? '$' : ''}${reference.endRow}`;
    case 'column':
      return `${reference.startAbsolute ? '$' : ''}${columnLetters(reference.startColumn)}:${reference.endAbsolute ? '$' : ''}${columnLetters(reference.endColumn)}`;
  }
};

const relativePart = (absolute: boolean, value: number, host: number, prefix: 'R' | 'C'): string =>
  absolute
    ? `${prefix}${value}`
    : `${prefix}[${value - host > 0 ? '+' : ''}${value - host}]`;

const r1c1Reference = (reference: A1Reference, host: CellPosition): string => {
  switch (reference.kind) {
    case 'cell':
      return `${relativePart(reference.rowAbsolute, reference.row, host.row, 'R')}${relativePart(reference.columnAbsolute, reference.column, host.column, 'C')}`;
    case 'row':
      return `${relativePart(reference.startAbsolute, reference.startRow, host.row, 'R')}:${relativePart(reference.endAbsolute, reference.endRow, host.row, 'R')}`;
    case 'column':
      return `${relativePart(reference.startAbsolute, reference.startColumn, host.column, 'C')}:${relativePart(reference.endAbsolute, reference.endColumn, host.column, 'C')}`;
  }
};

const withParentheses = (text: string, child: FormulaExpression, parentPrecedence: number, right = false): string => {
  const childPrecedence = precedence(child);
  if (childPrecedence < parentPrecedence || (right && childPrecedence === parentPrecedence)) return `(${text})`;
  return text;
};

const printExpression = (expression: FormulaExpression, options: PrintOptions): string => {
  const child = (value: FormulaExpression, parent: number, right = false): string =>
    withParentheses(printExpression(value, options), value, parent, right);

  switch (expression.type) {
    case 'number':
      return expression.raw;
    case 'string':
      return `"${expression.value.replace(/"/g, '""')}"`;
    case 'boolean':
      return expression.value ? 'TRUE' : 'FALSE';
    case 'error':
      return expression.code;
    case 'name':
      return expression.name;
    case 'reference': {
      const reference = options.r1c1Host === undefined ? a1Reference(expression.reference) : r1c1Reference(expression.reference, options.r1c1Host);
      return expression.sheet === undefined ? reference : `${sheetText(expression.sheet)}!${reference}`;
    }
    case 'range':
      return `${child(expression.left, 70)}:${child(expression.right, 70, true)}`;
    case 'union':
      return expression.items.map((item) => child(item, 10)).join(',');
    case 'intersection':
      return `${child(expression.left, 20)} ${child(expression.right, 20, true)}`;
    case 'binary':
      return `${child(expression.left, precedence(expression))}${expression.operator}${child(expression.right, precedence(expression), true)}`;
    case 'unary':
      return `${expression.operator}${child(expression.operand, 75)}`;
    case 'percent':
      return `${child(expression.operand, 90)}%`;
    case 'spill':
      return `${child(expression.operand, 90)}#`;
    case 'call':
      return `${expression.name}(${expression.args.map((argument) => (argument.type === 'missing' ? '' : printExpression(argument, options))).join(',')})`;
    case 'parenthesized':
      return `(${printExpression(expression.expression, options)})`;
    case 'array':
      return `{${expression.rows.map((row) => row.map((item) => (item.type === 'missing' ? '' : printExpression(item, options))).join(',')).join(';')}}`;
    case 'missing':
      return '';
    case 'invalid':
      return expression.raw;
  }
};

export const printFormula = (formula: FormulaNode | FormulaExpression, options: PrintOptions = {}): string => {
  const expression = formula.type === 'formula' ? formula.expression : formula;
  const includeEquals = formula.type === 'formula' ? formula.leadingEquals : options.includeEquals ?? false;
  const text = printExpression(expression, options);
  return includeEquals ? `=${text}` : text;
};

export const print = printFormula;

export const roundTripFormula = (input: string): string => printFormula(parseFormula(input));

export const sourceSpan = (formula: FormulaNode): SourceSpan => formula.span;

import { tokenize, type FormulaToken } from './tokenizer.js';
import type {
  A1Reference,
  ArrayConstantExpression,
  BinaryOperator,
  CellReference,
  FormulaExpression,
  FormulaNode,
  ParseDiagnostic,
  SourceSpan,
  WholeColumnReference,
  WholeRowReference,
} from './types.js';

const span = (start: number, end: number): SourceSpan => ({ start, end });

const columnNumber = (letters: string): number => {
  let value = 0;
  for (const character of letters.toUpperCase()) value = value * 26 + character.charCodeAt(0) - 64;
  return value;
};

const unquoteSheet = (value: string): string => {
  if (!value.startsWith("'") || !value.endsWith("'")) return value;
  return value.slice(1, -1).replace(/''/g, "'");
};

const splitSheet = (value: string): { sheet?: string; reference: string } => {
  if (value.startsWith("'")) {
    let index = 1;
    while (index < value.length) {
      if (value[index] === "'" && value[index + 1] === "'") {
        index += 2;
      } else if (value[index] === "'") {
        if (value[index + 1] === '!') {
          return { sheet: unquoteSheet(value.slice(0, index + 1)), reference: value.slice(index + 2) };
        }
        break;
      } else {
        index += 1;
      }
    }
  }

  const separator = value.indexOf('!');
  if (separator >= 0) return { sheet: value.slice(0, separator), reference: value.slice(separator + 1) };
  return { reference: value };
};

export const parseA1Reference = (value: string): { sheet?: string; reference: A1Reference } | undefined => {
  const qualified = splitSheet(value);
  const reference = qualified.reference;

  const rowRange = reference.match(/^(\$?\d+):(\$?\d+)$/);
  if (rowRange !== null) {
    const startRow: WholeRowReference = {
      kind: 'row',
      startRow: Number(rowRange[1].replace('$', '')),
      endRow: Number(rowRange[2].replace('$', '')),
      startAbsolute: rowRange[1].startsWith('$'),
      endAbsolute: rowRange[2].startsWith('$'),
    };
    return { sheet: qualified.sheet, reference: startRow };
  }

  const columnRange = reference.match(/^(\$?[A-Za-z]{1,3}):(\$?[A-Za-z]{1,3})$/);
  if (columnRange !== null) {
    const startColumn: WholeColumnReference = {
      kind: 'column',
      startColumn: columnNumber(columnRange[1].replace('$', '')),
      endColumn: columnNumber(columnRange[2].replace('$', '')),
      startAbsolute: columnRange[1].startsWith('$'),
      endAbsolute: columnRange[2].startsWith('$'),
    };
    return { sheet: qualified.sheet, reference: startColumn };
  }

  const cell = reference.match(/^(\$?[A-Za-z]{1,3})(\$?\d+)$/);
  if (cell !== null) {
    const parsed: CellReference = {
      kind: 'cell',
      column: columnNumber(cell[1].replace('$', '')),
      row: Number(cell[2].replace('$', '')),
      columnAbsolute: cell[1].startsWith('$'),
      rowAbsolute: cell[2].startsWith('$'),
    };
    return { sheet: qualified.sheet, reference: parsed };
  }

  return undefined;
};

const binaryPrecedence = (operator: string): number | undefined => {
  switch (operator) {
    case ',':
      return 10;
    case 'intersection':
      return 20;
    case '=':
    case '<>':
    case '<':
    case '<=':
    case '>':
    case '>=':
      return 30;
    case '&':
      return 40;
    case '+':
    case '-':
      return 50;
    case '*':
    case '/':
      return 60;
    case ':':
      return 70;
    case '^':
      return 80;
    default:
      return undefined;
  }
};

const decodeString = (value: string): string => {
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') return value;
  return value.slice(1, -1).replace(/""/g, '"');
};

class PrattParser {
  private index = 0;
  private readonly diagnostics: ParseDiagnostic[] = [];

  constructor(private readonly input: string, private readonly tokens: readonly FormulaToken[]) {}

  parse(): FormulaNode {
    const leadingEquals = this.peek().kind === 'operator' && this.peek().value === '=';
    if (leadingEquals) this.index += 1;

    const expression = this.parseExpression(0);
    while (this.peek().kind !== 'eof') {
      const extra = this.consume();
      if (extra.kind === 'invalid' && extra.value.trim() === '') continue;
      this.diagnostics.push({ message: `Unexpected token ${extra.raw}`, span: extra.span });
    }

    return {
      type: 'formula',
      expression,
      leadingEquals,
      span: span(0, this.input.length),
      source: this.input,
      diagnostics: this.diagnostics,
    };
  }

  private peek(offset = 0): FormulaToken {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)] ?? {
      kind: 'eof',
      type: 'eof',
      value: '',
      raw: '',
      span: span(this.input.length, this.input.length),
    };
  }

  private consume(): FormulaToken {
    const current = this.peek();
    this.index += 1;
    return current;
  }

  private parseExpression(minPrecedence: number): FormulaExpression {
    let left = this.parsePrefix();

    while (true) {
      const current = this.peek();
      if (current.kind === 'operator' && current.value === '%' && 90 >= minPrecedence) {
        this.consume();
        left = { type: 'percent', operand: left, span: span(left.span.start, current.span.end) };
        continue;
      }
      if (current.kind === 'operator' && current.value === '#' && 90 >= minPrecedence) {
        this.consume();
        left = { type: 'spill', operand: left, span: span(left.span.start, current.span.end) };
        continue;
      }
      if (current.kind === 'lparen' && left.type === 'name') {
        left = this.parseCall(left.name, left.span.start);
        continue;
      }

      const operator = current.kind === 'intersection' ? 'intersection' : current.kind === 'operator' ? current.value : undefined;
      if (operator === undefined) break;
      const precedence = binaryPrecedence(operator);
      if (precedence === undefined || precedence < minPrecedence) break;
      this.consume();
      const right = this.parseExpression(operator === '^' ? precedence : precedence + 1);
      const combinedSpan = span(left.span.start, right.span.end);

      if (operator === ':') {
        left = { type: 'range', left, right, span: combinedSpan };
      } else if (operator === ',') {
        const items = left.type === 'union' ? [...left.items, right] : [left, right];
        left = { type: 'union', items, span: combinedSpan };
      } else if (operator === 'intersection') {
        left = { type: 'intersection', left, right, span: combinedSpan };
      } else {
        left = {
          type: 'binary',
          operator: operator as BinaryOperator,
          left,
          right,
          span: combinedSpan,
        };
      }
    }

    return left;
  }

  private parsePrefix(): FormulaExpression {
    const current = this.consume();
    switch (current.kind) {
      case 'number':
        return { type: 'number', value: Number(current.value), raw: current.value, span: current.span };
      case 'string':
        return { type: 'string', value: decodeString(current.value), span: current.span };
      case 'boolean':
        return { type: 'boolean', value: current.value.toUpperCase() === 'TRUE', span: current.span };
      case 'error':
        return { type: 'error', code: current.value.toUpperCase(), span: current.span };
      case 'reference': {
        const parsed = parseA1Reference(current.value);
        if (parsed !== undefined) {
          return { type: 'reference', sheet: parsed.sheet, reference: parsed.reference, span: current.span };
        }
        return { type: 'name', name: current.value, span: current.span };
      }
      case 'name':
        return { type: 'name', name: current.value, span: current.span };
      case 'lparen': {
        const expression = this.parseExpression(0);
        const closing = this.peek().kind === 'rparen' ? this.consume() : undefined;
        if (closing === undefined) {
          this.diagnostics.push({ message: 'Missing closing parenthesis', span: current.span });
        }
        return {
          type: 'parenthesized',
          expression,
          span: span(current.span.start, closing?.span.end ?? expression.span.end),
        };
      }
      case 'array-start':
        return this.parseArray(current.span.start);
      case 'operator':
        if (current.value === '+' || current.value === '-' || current.value === '@') {
          const operand = this.parseExpression(75);
          return { type: 'unary', operator: current.value, operand, span: span(current.span.start, operand.span.end) };
        }
        return this.invalid(current, `Unexpected operator ${current.value}`);
      case 'eof':
        return this.invalid(current, 'Expected an expression');
      default:
        return this.invalid(current, `Unexpected token ${current.raw}`);
    }
  }

  private parseCall(name: string, start: number): FormulaExpression {
    const opening = this.consume();
    const args: FormulaExpression[] = [];
    if (this.peek().kind !== 'rparen') {
      while (this.peek().kind !== 'eof' && this.peek().kind !== 'rparen') {
        if (this.peek().kind === 'operator' && this.peek().value === ',') {
          const separator = this.consume();
          args.push({ type: 'missing', span: separator.span });
          continue;
        }
        args.push(this.parseExpression(11));
        if (this.peek().kind === 'operator' && this.peek().value === ',') {
          this.consume();
          if (this.peek().kind === 'rparen') args.push({ type: 'missing', span: this.peek().span });
          continue;
        }
        break;
      }
    }
    const closing = this.peek().kind === 'rparen' ? this.consume() : undefined;
    if (closing === undefined) {
      this.diagnostics.push({ message: 'Missing closing parenthesis', span: opening.span });
    }
    return {
      type: 'call',
      name,
      args,
      span: span(start, closing?.span.end ?? args.at(-1)?.span.end ?? opening.span.end),
    };
  }

  private parseArray(start: number): ArrayConstantExpression {
    const rows: FormulaExpression[][] = [[]];
    while (this.peek().kind !== 'eof' && this.peek().kind !== 'array-end') {
      if (this.peek().kind === 'array-row-separator') {
        this.consume();
        rows.push([]);
        continue;
      }
      if (this.peek().kind === 'operator' && this.peek().value === ',') {
        this.consume();
        rows.at(-1)?.push({ type: 'missing', span: this.peek(-1).span });
        continue;
      }
      rows.at(-1)?.push(this.parseExpression(11));
      if (this.peek().kind === 'operator' && this.peek().value === ',') this.consume();
    }
    const closing = this.peek().kind === 'array-end' ? this.consume() : undefined;
    if (closing === undefined) this.diagnostics.push({ message: 'Missing closing array brace', span: span(start, start + 1) });
    return {
      type: 'array',
      rows,
      span: span(start, closing?.span.end ?? rows.at(-1)?.at(-1)?.span.end ?? start + 1),
    };
  }

  private invalid(current: FormulaToken, message: string): FormulaExpression {
    this.diagnostics.push({ message, span: current.span });
    return { type: 'invalid', raw: current.raw, span: current.span };
  }
}

export const parseFormula = (input: string): FormulaNode => new PrattParser(input, tokenize(input)).parse();

export const parse = parseFormula;

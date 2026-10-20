import type { SourceSpan } from './types.js';

export type FormulaTokenKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'error'
  | 'reference'
  | 'name'
  | 'operator'
  | 'intersection'
  | 'lparen'
  | 'rparen'
  | 'array-start'
  | 'array-end'
  | 'array-row-separator'
  | 'eof'
  | 'invalid';

export interface FormulaToken {
  readonly kind: FormulaTokenKind;
  readonly type: FormulaTokenKind;
  readonly value: string;
  readonly raw: string;
  readonly span: SourceSpan;
}

const ERROR_LITERALS = new Set([
  '#NULL!',
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#NUM!',
  '#N/A',
  '#GETTING_DATA',
  '#SPILL!',
  '#CALC!',
  '#FIELD!',
  '#BLOCKED!',
  '#CONNECT!',
  '#UNKNOWN!',
  '#BUSY!',
]);

const isIdentifierStart = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z_\\]/.test(character);

const isIdentifierPart = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z0-9_.\\]/.test(character);

const isReferenceEnd = (token: FormulaToken): boolean =>
  token.kind === 'reference' ||
  token.kind === 'name' ||
  token.kind === 'number' ||
  token.kind === 'string' ||
  token.kind === 'boolean' ||
  token.kind === 'error' ||
  token.kind === 'rparen' ||
  token.kind === 'array-end';

const isReferenceStart = (token: FormulaToken): boolean =>
  token.kind === 'reference' ||
  token.kind === 'name' ||
  token.kind === 'number' ||
  token.kind === 'string' ||
  token.kind === 'boolean' ||
  token.kind === 'error' ||
  token.kind === 'lparen' ||
  token.kind === 'array-start';

const token = (kind: FormulaTokenKind, value: string, start: number, end: number): FormulaToken => ({
  kind,
  type: kind,
  value,
  raw: value,
  span: { start, end },
});

const pushToken = (tokens: FormulaToken[], kind: FormulaTokenKind, input: string, start: number, end: number): void => {
  tokens.push(token(kind, input.slice(start, end), start, end));
};

const scanQuotedSheet = (input: string, start: number): number | undefined => {
  if (input[start] !== "'") return undefined;
  let index = start + 1;
  while (index < input.length) {
    if (input[index] !== "'") {
      index += 1;
      continue;
    }
    if (input[index + 1] === "'") {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return undefined;
};

const referenceSegmentEnd = (input: string, start: number): number => {
  let index = start;
  while (input[index] === '$') index += 1;
  while (/[A-Za-z]/.test(input[index] ?? '')) index += 1;
  if (index !== start && input[start] !== '$' && /[A-Za-z]/.test(input[start] ?? '')) {
    if (input[index] === '$') {
      index += 1;
      while (/\d/.test(input[index] ?? '')) index += 1;
    } else {
      const digitStart = index;
      while (/\d/.test(input[index] ?? '')) index += 1;
      if (digitStart === index) return start;
    }
  } else {
    while (/\d/.test(input[index] ?? '')) index += 1;
  }
  return index;
};

const referenceAt = (input: string, start: number): number | undefined => {
  const remainder = input.slice(start);
  const wholeRow = remainder.match(/^\$?\d+:\$?\d+/)?.[0];
  if (wholeRow !== undefined) return start + wholeRow.length;
  const wholeColumn = remainder.match(/^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}/)?.[0];
  if (wholeColumn !== undefined) return start + wholeColumn.length;

  const end = referenceSegmentEnd(input, start);
  if (end === start) return undefined;
  const candidate = input.slice(start, end);
  if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(candidate)) return end;
  return undefined;
};

const scanReference = (input: string, start: number): number | undefined => {
  const quotedEnd = scanQuotedSheet(input, start);
  if (quotedEnd !== undefined && input[quotedEnd] === '!') {
    const referenceEnd = referenceAt(input, quotedEnd + 1);
    return referenceEnd;
  }

  if (isIdentifierStart(input[start])) {
    let index = start + 1;
    while (isIdentifierPart(input[index])) index += 1;
    if (input[index] === '!') {
      const referenceEnd = referenceAt(input, index + 1);
      if (referenceEnd !== undefined) return referenceEnd;
    }
  }

  return referenceAt(input, start);
};

const scanNumber = (input: string, start: number): number | undefined => {
  const match = input.slice(start).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
  return match === null ? undefined : start + match[0].length;
};

const scanIdentifier = (input: string, start: number): number => {
  let index = start + 1;
  while (isIdentifierPart(input[index])) index += 1;
  return index;
};

const insertIntersections = (tokens: FormulaToken[]): FormulaToken[] => {
  const result: FormulaToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    if (current.kind !== 'invalid' || current.value.trim() !== '') {
      result.push(current);
      continue;
    }
    const previous = result.at(-1);
    const next = tokens[index + 1];
    if (previous !== undefined && next !== undefined && isReferenceEnd(previous) && isReferenceStart(next) && next.kind !== 'lparen') {
      result.push({
        kind: 'intersection',
        type: 'intersection',
        value: ' ',
        raw: current.raw,
        span: current.span,
      });
    }
  }
  return result;
};

/** Tokenizes formula text without throwing, including malformed input. */
export const tokenize = (input: string): readonly FormulaToken[] => {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < input.length) {
    const character = input[index] ?? '';
    if (/\s/.test(character)) {
      const start = index;
      while (/\s/.test(input[index] ?? '')) index += 1;
      pushToken(tokens, 'invalid', input, start, index);
      continue;
    }

    const referenceEnd = scanReference(input, index);
    if (referenceEnd !== undefined) {
      pushToken(tokens, 'reference', input, index, referenceEnd);
      index = referenceEnd;
      continue;
    }

    if (character === "'") {
      const end = scanQuotedSheet(input, index);
      if (end !== undefined) {
        pushToken(tokens, 'name', input, index, end);
        index = end;
        continue;
      }
    }

    if (character === '"') {
      const start = index;
      index += 1;
      while (index < input.length) {
        if (input[index] === '"' && input[index + 1] === '"') {
          index += 2;
        } else if (input[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      pushToken(tokens, 'string', input, start, index);
      continue;
    }

    if (character === '#') {
      const start = index;
      const errorLiteral = [...ERROR_LITERALS]
        .sort((left, right) => right.length - left.length)
        .find((candidate) => input.slice(start, start + candidate.length).toUpperCase() === candidate);
      if (errorLiteral !== undefined) {
        pushToken(tokens, 'error', input, start, start + errorLiteral.length);
        index += errorLiteral.length;
        continue;
      }
      while (index < input.length && !/[\s()+\-*/^&%<>=:,;{}]/.test(input[index] ?? '')) index += 1;
      if (index === start + 1) {
        pushToken(tokens, 'operator', input, start, index);
        continue;
      }
      const value = input.slice(start, index).toUpperCase();
      tokens.push(token(ERROR_LITERALS.has(value) ? 'error' : 'invalid', input.slice(start, index), start, index));
      continue;
    }

    const numberEnd = scanNumber(input, index);
    if (numberEnd !== undefined) {
      pushToken(tokens, 'number', input, index, numberEnd);
      index = numberEnd;
      continue;
    }

    if (isIdentifierStart(character)) {
      const end = scanIdentifier(input, index);
      const value = input.slice(index, end);
      const upper = value.toUpperCase();
      pushToken(tokens, upper === 'TRUE' || upper === 'FALSE' ? 'boolean' : 'name', input, index, end);
      index = end;
      continue;
    }

    const twoCharacterOperator = input.slice(index, index + 2);
    if (twoCharacterOperator === '<=' || twoCharacterOperator === '>=' || twoCharacterOperator === '<>') {
      pushToken(tokens, 'operator', input, index, index + 2);
      index += 2;
      continue;
    }

    const singleKind: Record<string, FormulaTokenKind> = {
      '(': 'lparen',
      ')': 'rparen',
      '{': 'array-start',
      '}': 'array-end',
      ';': 'array-row-separator',
      '=': 'operator',
      '<': 'operator',
      '>': 'operator',
      '+': 'operator',
      '-': 'operator',
      '*': 'operator',
      '/': 'operator',
      '^': 'operator',
      '&': 'operator',
      '%': 'operator',
      ':': 'operator',
      ',': 'operator',
      '@': 'operator',
      '~': 'operator',
      '!': 'operator',
      '[': 'invalid',
      ']': 'invalid',
    };
    const kind = singleKind[character];
    if (kind !== undefined) {
      pushToken(tokens, kind, input, index, index + 1);
      index += 1;
      continue;
    }

    pushToken(tokens, 'invalid', input, index, index + 1);
    index += 1;
  }

  const withIntersections = insertIntersections(tokens);
  withIntersections.push(token('eof', '', input.length, input.length));
  return withIntersections;
};

export const tokenizeFormula = tokenize;

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { normalizeR1C1, parseFormula, printFormula, tokenize } from './index.js';

const FORMULA_SEED = 0x4f4d4e49;
const FORMULA_RUNS = 64;

const formulaArbitrary = fc.constantFrom(
  '=A1',
  '=$A$1+$B2+C$3',
  "='Sales Q1'!A1:'Sales Q1'!$C$10",
  'A:A+1:3',
  'Revenue*(1-TaxRate)',
  '{1,2;3,4}',
  'SUM(A1:B2,IF(C3>0,C3,0))',
  'A1 B2',
  'A1,B2',
  'A1#%',
  '#N/A',
  '-(A1^2)+B1&" units"',
);

describe('formula language', () => {
  it('round-trips generated formulas through a stable printer', () => {
    fc.assert(
      fc.property(formulaArbitrary, (input) => {
        const printed = printFormula(parseFormula(input));
        expect(printFormula(parseFormula(printed))).toBe(printed);
      }),
      { seed: FORMULA_SEED, numRuns: FORMULA_RUNS },
    );
  });

  it('never throws while tokenizing arbitrary text', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => tokenize(input)).not.toThrow();
      }),
      { seed: FORMULA_SEED, numRuns: FORMULA_RUNS },
    );
  });

  it('retains typed references and source spans', () => {
    const parsed = parseFormula("='Sheet 1'!$B2:C$4");
    expect(parsed.span).toEqual({ start: 0, end: 18 });
    expect(parsed.expression.type).toBe('range');
    if (parsed.expression.type !== 'range') return;
    expect(parsed.expression.left.type).toBe('reference');
    expect(parsed.expression.right.type).toBe('reference');
    if (parsed.expression.left.type !== 'reference' || parsed.expression.right.type !== 'reference') return;
    expect(parsed.expression.left.sheet).toBe('Sheet 1');
    expect(parsed.expression.left.reference).toMatchObject({ kind: 'cell', row: 2, column: 2, columnAbsolute: true });
    expect(parsed.expression.right.reference).toMatchObject({ kind: 'cell', row: 4, column: 3, rowAbsolute: true });
  });

  it('tokenizes required spreadsheet constructs', () => {
    const tokens = tokenize("='Sheet 1'!$B2:C$4 A:A 1:3,Name,{1,#N/A;TRUE}");
    expect(tokens.filter((token) => token.kind === 'reference').map((token) => token.value)).toEqual([
      "'Sheet 1'!$B2",
      'C$4',
      'A:A',
      '1:3',
    ]);
    expect(tokens.some((token) => token.kind === 'error' && token.value === '#N/A')).toBe(true);
    expect(tokens.some((token) => token.kind === 'array-start')).toBe(true);
    expect(tokens.some((token) => token.kind === 'array-row-separator')).toBe(true);
    expect(tokens.some((token) => token.kind === 'intersection')).toBe(true);
  });

  it('normalizes equivalent relative patterns to the same R1C1 text', () => {
    expect(normalizeR1C1('=A1+$B2', { row: 2, column: 3 })).toBe('=R[-1]C[-2]+R[0]C2');
    expect(normalizeR1C1('=B2+$B3', { row: 3, column: 4 })).toBe('=R[-1]C[-2]+R[0]C2');
  });
});

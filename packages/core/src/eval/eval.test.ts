import { describe, expect, it } from 'vitest';

import { SUPPORTED_FUNCTIONS, evaluateFormula } from './index.js';
import { Unverified } from '../model/index.js';

describe('evaluator', () => {
  it('evaluates supported arithmetic, ranges, logic, text, dates, and finance', () => {
    const cells = new Map([
      ['Sheet1!A1', 2],
      ['Sheet1!A2', 3],
      ['Sheet1!A3', 5],
    ]);
    expect(evaluateFormula('=SUM(A1:A3)', { cells, currentSheet: 'Sheet1' })).toBe(10);
    expect(evaluateFormula('=IF(A1<3,"ok","no")', { cells, currentSheet: 'Sheet1' })).toBe('ok');
    expect(evaluateFormula('=CONCATENATE("Q",RIGHT("2026",2))', { cells })).toBe('Q26');
    expect(evaluateFormula('=DAY(DATE(1900,2,29))', { cells })).toBe(29);
    expect(evaluateFormula('=PMT(0,10,100)', { cells })).toBe(-10);
  });

  it('marks unsupported functions and propagates unverified values', () => {
    const result = evaluateFormula('=SUM(UNKNOWN(A1), 2)', { currentSheet: 'Sheet1' });
    expect(result).toBeInstanceOf(Unverified);
    expect(SUPPORTED_FUNCTIONS).toContain('VLOOKUP');
    expect(SUPPORTED_FUNCTIONS).not.toContain('XLOOKUP' as never);
  });
});

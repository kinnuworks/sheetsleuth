import { parseFormula } from './parser.js';
import { printFormula } from './printer.js';
import type { CellPosition, FormulaNode } from './types.js';

export const normalizeR1C1 = (formula: string | FormulaNode, host: CellPosition): string => {
  const parsed = typeof formula === 'string' ? parseFormula(formula) : formula;
  return printFormula(parsed, { r1c1Host: host });
};

export const normalizeFormulaR1C1 = normalizeR1C1;

import { evaluateFormula, isError, isUnverified } from './eval/index.js';
import type { EvaluationContext } from './eval/index.js';
import type { Cell, Value, Workbook } from './model/index.js';

export interface FidelityMismatch {
  readonly sheet: string;
  readonly address: string;
  readonly expected: Value | undefined;
  readonly actual: Value;
  readonly reason: string;
}

export interface FidelityResult {
  readonly checked: number;
  readonly mismatches: readonly FidelityMismatch[];
}

const numericMatch = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));

export const valuesMatch = (left: Value | undefined, right: Value | undefined): boolean => {
  if (typeof left === 'number' && typeof right === 'number') return numericMatch(left, right);
  if (left !== undefined && right !== undefined && isError(left) && isError(right)) return left.code === right.code;
  if ((left !== undefined && isUnverified(left)) || (right !== undefined && isUnverified(right))) return false;
  return Object.is(left, right);
};

const cellKey = (sheet: string, address: string): string => `${sheet}!${address}`;

const savedValue = (cell: Cell): Value | undefined => cell.cachedValue ?? cell.value;

const mismatchReason = (expected: Value | undefined, actual: Value): string => {
  if (isUnverified(actual)) return `unverified: ${actual.reason}`;
  if (isError(expected as Value) || isError(actual)) return 'error values differ';
  return `computed value ${JSON.stringify(actual)} does not match saved value ${JSON.stringify(expected)}`;
};

const savedContext = (workbook: Workbook): ReadonlyMap<string, Value> => {
  const values = new Map<string, Value>();
  for (const sheet of workbook.sheets) {
    for (const cell of sheet.cells) {
      const value = savedValue(cell);
      if (value !== undefined) values.set(cellKey(sheet.name, cell.address), value);
    }
  }
  return values;
};

export const checkSavedValues = (
  workbook: Workbook,
  excluded: ReadonlySet<string> = new Set(),
): FidelityResult => {
  const cells = savedContext(workbook);
  const mismatches: FidelityMismatch[] = [];
  let checked = 0;
  for (const sheet of workbook.sheets) {
    for (const cell of sheet.cells) {
      if (!cell.formula || excluded.has(cellKey(sheet.name, cell.address))) continue;
      checked += 1;
      const context: EvaluationContext = {
        cells,
        currentSheet: sheet.name,
        dateSystem: workbook.dateSystem,
      };
      const actual = evaluateFormula(cell.formula, context);
      const expected = savedValue(cell);
      if (!valuesMatch(expected, actual)) {
        mismatches.push({
          sheet: sheet.name,
          address: cell.address,
          expected,
          actual,
          reason: mismatchReason(expected, actual),
        });
      }
    }
  }
  return { checked, mismatches };
};

export const fixtureExcludedCells = (
  sheet: string,
  address: string,
  excludeFromFidelity: unknown,
): boolean => {
  if (!Array.isArray(excludeFromFidelity)) return false;
  return excludeFromFidelity.some((entry) => {
    if (typeof entry === 'string') return entry === address || entry === cellKey(sheet, address);
    if (entry && typeof entry === 'object') {
      const candidate = entry as { sheet?: unknown; address?: unknown; cell?: unknown };
      const candidateAddress = candidate.address ?? candidate.cell;
      return candidateAddress === address && (candidate.sheet === undefined || candidate.sheet === sheet);
    }
    return false;
  });
};

import type { FormulaExpression, FormulaNode } from '../formula/index.js';
import { Unverified } from '../model/index.js';
import type { ErrorValue, Value } from '../model/index.js';

export interface RangeValue {
  readonly kind: 'range';
  readonly rows: readonly (readonly Value[])[];
}

export type EvaluationValue = Value | RangeValue;

export type CellValueSource = Value | { readonly value: Value };

export interface EvaluationContext {
  readonly cells?: ReadonlyMap<string, CellValueSource> | Readonly<Record<string, CellValueSource>>;
  readonly names?: ReadonlyMap<string, CellValueSource> | Readonly<Record<string, CellValueSource>>;
  readonly currentSheet?: string;
  readonly currentCell?: string;
  readonly dateSystem?: '1900' | '1904';
}

export type EvaluationResult = Value;

export type FormulaInput = string | FormulaNode | FormulaExpression;

export const isUnverified = (value: EvaluationValue): value is Unverified => value instanceof Unverified;

export const isError = (value: EvaluationValue): value is ErrorValue =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'error';

export const errorValue = (code: string, message?: string): ErrorValue => ({
  kind: 'error',
  code,
  ...(message ? { message } : {}),
});

export type ScalarValue = string | number | boolean | null;

export interface ErrorValue {
  readonly kind: 'error';
  readonly code: string;
  readonly message?: string;
}

export class Unverified {
  readonly kind = 'unverified' as const;

  constructor(readonly reason: string) {}
}

export type Value = ScalarValue | ErrorValue | Unverified;

/** Backwards-compatible name for scalar and formula values. */
export type CellValue = Value;

export interface Cell {
  readonly address: string;
  readonly row: number;
  readonly column: number;
  value: Value;
  formula?: string;
  cachedValue?: Value;
  savedValue?: Value;
  unsupportedReason?: string;
}

export interface Sheet {
  readonly name: string;
  readonly cells: Cell[];
  hidden?: boolean;
  state?: 'visible' | 'hidden' | 'veryHidden';
}

export interface Workbook {
  readonly name: string;
  readonly sheets: Sheet[];
  definedNames?: Record<string, string>;
  dateSystem?: '1900' | '1904';
  calcMode?: 'auto' | 'automaticExceptTables' | 'manual';
}

export type Impact = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface Fix {
  readonly description: string;
  readonly sheet?: string;
  readonly cell?: string;
  readonly before?: Value;
  readonly after?: Value;
  readonly formula?: string;
}

export interface Finding {
  readonly code: string;
  readonly message: string;
  readonly impact?: Impact;
  readonly sheet?: string;
  readonly cell?: string;
  readonly evidence?: readonly string[];
  readonly fix?: Fix;
}

export type Verdict = 'pass' | 'fail' | 'unverified';

export const unverified = (reason: string): Unverified => new Unverified(reason);

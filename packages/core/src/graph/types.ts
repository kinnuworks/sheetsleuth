import type { Cell, Workbook } from '../model/index.js';

export type GraphCellId = string;

export interface GraphCell {
  readonly id: GraphCellId;
  readonly sheet: string;
  readonly address: string;
  readonly row: number;
  readonly column: number;
  readonly formula?: string;
}

export interface RangeBounds {
  readonly sheet: string;
  readonly startRow: number;
  readonly endRow: number;
  readonly startColumn: number;
  readonly endColumn: number;
}

export interface DependencyGraphInput {
  readonly workbook?: Workbook;
  readonly cells?: readonly GraphCell[];
}

export type GraphSource = DependencyGraphInput | Workbook | readonly GraphCell[] | readonly Cell[];

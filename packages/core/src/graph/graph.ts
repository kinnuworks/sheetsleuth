import { parseFormula } from '../formula/parser.js';
import type {
  FormulaExpression,
  FormulaNode,
  ReferenceExpression,
  CellReference,
  WholeColumnReference,
  WholeRowReference,
} from '../formula/types.js';
import type { Cell, Workbook } from '../model/index.js';
import type { GraphCell, GraphCellId, GraphSource, RangeBounds } from './types.js';

const key = (sheet: string, address: string): GraphCellId => `${sheet}!${address}`;

const columnToNumber = (letters: string): number => {
  let result = 0;
  for (const character of letters.toUpperCase()) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
};

const numberToColumn = (value: number): string => {
  let number = value;
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result || 'A';
};

const parseAddress = (address: string): { row: number; column: number } | undefined => {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(address);
  if (match === null) return undefined;
  return { row: Number(match[2]), column: columnToNumber(match[1]!) };
};

const address = (row: number, column: number): string => `${numberToColumn(column)}${row}`;

const normalizeBounds = (
  sheet: string,
  left: ReferenceExpression,
  right: ReferenceExpression,
): RangeBounds | undefined => {
  if (left.reference.kind !== 'cell' || right.reference.kind !== 'cell') return undefined;
  const first = left.reference as CellReference;
  const second = right.reference as CellReference;
  return {
    sheet: right.sheet ?? left.sheet ?? sheet,
    startRow: Math.min(first.row, second.row),
    endRow: Math.max(first.row, second.row),
    startColumn: Math.min(first.column, second.column),
    endColumn: Math.max(first.column, second.column),
  };
};

const referenceBounds = (sheet: string, expression: ReferenceExpression): RangeBounds | undefined => {
  const reference = expression.reference;
  if (reference.kind === 'cell') {
    return {
      sheet: expression.sheet ?? sheet,
      startRow: reference.row,
      endRow: reference.row,
      startColumn: reference.column,
      endColumn: reference.column,
    };
  }
  if (reference.kind === 'row') {
    return {
      sheet: expression.sheet ?? sheet,
      startRow: reference.startRow,
      endRow: reference.endRow,
      startColumn: 1,
      endColumn: Number.MAX_SAFE_INTEGER,
    };
  }
  const column = reference as WholeColumnReference;
  return {
    sheet: expression.sheet ?? sheet,
    startRow: 1,
    endRow: Number.MAX_SAFE_INTEGER,
    startColumn: column.startColumn,
    endColumn: column.endColumn,
  };
};

const collectRanges = (
  expression: FormulaExpression,
  sheet: string,
  ranges: RangeBounds[],
): void => {
  if (expression.type === 'reference') {
    const bounds = referenceBounds(sheet, expression);
    if (bounds) ranges.push(bounds);
    return;
  }
  if (expression.type === 'range') {
    if (expression.left.type === 'reference' && expression.right.type === 'reference') {
      const bounds = normalizeBounds(sheet, expression.left, expression.right);
      if (bounds) ranges.push(bounds);
    }
    collectRanges(expression.left, sheet, ranges);
    collectRanges(expression.right, sheet, ranges);
    return;
  }
  if (expression.type === 'union') {
    for (const item of expression.items) collectRanges(item, sheet, ranges);
    return;
  }
  if (expression.type === 'intersection' || expression.type === 'binary') {
    collectRanges(expression.left, sheet, ranges);
    collectRanges(expression.right, sheet, ranges);
    return;
  }
  if (expression.type === 'unary' || expression.type === 'percent' || expression.type === 'spill') {
    collectRanges(expression.operand, sheet, ranges);
    return;
  }
  if (expression.type === 'parenthesized') {
    collectRanges(expression.expression, sheet, ranges);
    return;
  }
  if (expression.type === 'call') {
    for (const argument of expression.args) collectRanges(argument, sheet, ranges);
    return;
  }
  if (expression.type === 'array') {
    for (const row of expression.rows) for (const item of row) collectRanges(item, sheet, ranges);
  }
};

/** A finite range is expanded only when iteration is requested. */
export class LazyRange {
  constructor(
    readonly bounds: RangeBounds,
    private readonly knownCells: readonly GraphCell[],
  ) {}

  *ids(): IterableIterator<GraphCellId> {
    const { bounds } = this;
    const isUnbounded = bounds.endRow === Number.MAX_SAFE_INTEGER || bounds.endColumn === Number.MAX_SAFE_INTEGER;
    if (isUnbounded) {
      for (const cell of this.knownCells) {
        if (
          cell.sheet === bounds.sheet &&
          cell.row >= bounds.startRow &&
          cell.row <= bounds.endRow &&
          cell.column >= bounds.startColumn &&
          cell.column <= bounds.endColumn
        ) yield cell.id;
      }
      return;
    }
    const known = new Set(this.knownCells.map((cell) => cell.id));
    for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
      for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
        const id = key(bounds.sheet, address(row, column));
        if (known.has(id)) yield id;
      }
    }
  }
}

const cellsFromSource = (source: GraphSource): GraphCell[] => {
  if (Array.isArray(source)) {
    return source.map((cell) => {
      const candidate = cell as GraphCell | Cell;
      if ('id' in candidate && 'sheet' in candidate) return candidate;
      return {
        id: key('', candidate.address),
        sheet: '',
        address: candidate.address,
        row: candidate.row,
        column: candidate.column,
        formula: candidate.formula,
      };
    });
  }
  const workbook: Workbook | undefined = 'sheets' in source ? source : 'workbook' in source ? source.workbook : undefined;
  if (!workbook) return 'workbook' in source && source.cells ? [...source.cells] : [];
  return workbook.sheets.flatMap((sheet) =>
    sheet.cells.map((cell) => ({
      id: key(sheet.name, cell.address),
      sheet: sheet.name,
      address: cell.address,
      row: cell.row,
      column: cell.column,
      formula: cell.formula,
    })),
  );
};

export class DependencyGraph {
  readonly cells: ReadonlyMap<GraphCellId, GraphCell>;
  private readonly directDependencies = new Map<GraphCellId, Set<GraphCellId>>();
  private readonly directDependents = new Map<GraphCellId, Set<GraphCellId>>();
  private readonly lazyDependencies = new Map<GraphCellId, (() => Iterable<GraphCellId>)[]>();
  private readonly materialized = new Set<GraphCellId>();

  constructor(cells: readonly GraphCell[] = []) {
    this.cells = new Map(cells.map((cell) => [cell.id, cell]));
    for (const cell of cells) {
      this.directDependencies.set(cell.id, new Set());
      this.directDependents.set(cell.id, new Set());
    }
  }

  addNode(cell: GraphCell): void {
    if (!this.cells.has(cell.id)) {
      (this.cells as Map<GraphCellId, GraphCell>).set(cell.id, cell);
      this.directDependencies.set(cell.id, new Set());
      this.directDependents.set(cell.id, new Set());
    }
  }

  addDependency(dependent: GraphCellId, precedent: GraphCellId): void {
    this.addEdge(dependent, precedent);
  }

  addLazyDependency(dependent: GraphCellId, range: LazyRange): void {
    const callbacks = this.lazyDependencies.get(dependent) ?? [];
    callbacks.push(() => range.ids());
    this.lazyDependencies.set(dependent, callbacks);
  }

  private addEdge(dependent: GraphCellId, precedent: GraphCellId): void {
    if (!this.directDependencies.has(dependent)) this.directDependencies.set(dependent, new Set());
    if (!this.directDependents.has(precedent)) this.directDependents.set(precedent, new Set());
    this.directDependencies.get(dependent)!.add(precedent);
    this.directDependents.get(precedent)!.add(dependent);
  }

  private materialize(id: GraphCellId): void {
    if (this.materialized.has(id)) return;
    this.materialized.add(id);
    for (const callback of this.lazyDependencies.get(id) ?? []) {
      for (const precedent of callback()) this.addEdge(id, precedent);
    }
  }

  dependenciesOf(id: GraphCellId): readonly GraphCellId[] {
    this.materialize(id);
    return [...(this.directDependencies.get(id) ?? [])];
  }

  dependentsOf(id: GraphCellId): readonly GraphCellId[] {
    this.materialize(id);
    return [...(this.directDependents.get(id) ?? [])];
  }

  nodes(): readonly GraphCellId[] {
    return [...this.cells.keys()];
  }

  stronglyConnectedComponents(): readonly (readonly GraphCellId[])[] {
    return tarjanScc(this);
  }

  topologicalOrder(): readonly GraphCellId[] {
    return topologicalOrder(this);
  }
}

export const buildDependencyGraph = (source: GraphSource): DependencyGraph => {
  const cells = cellsFromSource(source);
  const graph = new DependencyGraph(cells);
  for (const cell of cells) {
    if (!cell.formula) continue;
    const parsed = parseFormula(cell.formula);
    if (parsed.diagnostics && parsed.diagnostics.length > 0) continue;
    const ranges: RangeBounds[] = [];
    collectRanges(parsed.expression, cell.sheet, ranges);
    for (const bounds of ranges) graph.addLazyDependency(cell.id, new LazyRange(bounds, cells));
  }
  return graph;
};

export const tarjanScc = (graph: Pick<DependencyGraph, 'nodes' | 'dependenciesOf'>): readonly (readonly GraphCellId[])[] => {
  let index = 0;
  const indices = new Map<GraphCellId, number>();
  const lowLinks = new Map<GraphCellId, number>();
  const stack: GraphCellId[] = [];
  const onStack = new Set<GraphCellId>();
  const components: GraphCellId[][] = [];

  const visit = (node: GraphCellId): void => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const dependency of graph.dependenciesOf(node)) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(dependency)!));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: GraphCellId[] = [];
    let member: GraphCellId | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component);
  };

  for (const node of graph.nodes()) if (!indices.has(node)) visit(node);
  return components;
};

export const topologicalOrder = (
  graph: Pick<DependencyGraph, 'nodes' | 'dependenciesOf'>,
): readonly GraphCellId[] => {
  const components = tarjanScc(graph);
  const componentOf = new Map<GraphCellId, number>();
  components.forEach((component, index) => component.forEach((node) => componentOf.set(node, index)));
  const outgoing = components.map(() => new Set<number>());
  const indegree = components.map(() => 0);
  for (const node of graph.nodes()) {
    const from = componentOf.get(node)!;
    for (const dependency of graph.dependenciesOf(node)) {
      const to = componentOf.get(dependency);
      if (to === undefined || to === from || outgoing[to]!.has(from)) continue;
      outgoing[to]!.add(from);
      indegree[from] += 1;
    }
  }
  const ready = indegree.flatMap((degree, index) => (degree === 0 ? [index] : []));
  const result: GraphCellId[] = [];
  while (ready.length > 0) {
    const component = ready.shift()!;
    result.push(...components[component]!);
    for (const dependent of outgoing[component]!) {
      indegree[dependent] -= 1;
      if (indegree[dependent] === 0) ready.push(dependent);
    }
  }
  return result;
};

export const graphCell = (sheet: string, cell: Cell): GraphCell => ({
  id: key(sheet, cell.address),
  sheet,
  address: cell.address,
  row: cell.row,
  column: cell.column,
  formula: cell.formula,
});

export type { GraphCell, GraphCellId, GraphSource, RangeBounds } from './types.js';

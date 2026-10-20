export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface ParseDiagnostic {
  readonly message: string;
  readonly span: SourceSpan;
}

export interface CellReference {
  readonly kind: 'cell';
  readonly row: number;
  readonly column: number;
  readonly rowAbsolute: boolean;
  readonly columnAbsolute: boolean;
}

export interface WholeRowReference {
  readonly kind: 'row';
  readonly startRow: number;
  readonly endRow: number;
  readonly startAbsolute: boolean;
  readonly endAbsolute: boolean;
}

export interface WholeColumnReference {
  readonly kind: 'column';
  readonly startColumn: number;
  readonly endColumn: number;
  readonly startAbsolute: boolean;
  readonly endAbsolute: boolean;
}

export type A1Reference = CellReference | WholeRowReference | WholeColumnReference;

export interface BaseExpression {
  readonly span: SourceSpan;
}

export interface NumberLiteral extends BaseExpression {
  readonly type: 'number';
  readonly value: number;
  readonly raw: string;
}

export interface StringLiteral extends BaseExpression {
  readonly type: 'string';
  readonly value: string;
}

export interface BooleanLiteral extends BaseExpression {
  readonly type: 'boolean';
  readonly value: boolean;
}

export interface ErrorLiteral extends BaseExpression {
  readonly type: 'error';
  readonly code: string;
}

export interface NameExpression extends BaseExpression {
  readonly type: 'name';
  readonly name: string;
}

export interface ReferenceExpression extends BaseExpression {
  readonly type: 'reference';
  readonly sheet?: string;
  readonly reference: A1Reference;
}

export interface RangeExpression extends BaseExpression {
  readonly type: 'range';
  readonly left: FormulaExpression;
  readonly right: FormulaExpression;
}

export interface UnionExpression extends BaseExpression {
  readonly type: 'union';
  readonly items: readonly FormulaExpression[];
}

export interface IntersectionExpression extends BaseExpression {
  readonly type: 'intersection';
  readonly left: FormulaExpression;
  readonly right: FormulaExpression;
}

export type BinaryOperator = '=' | '<>' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '^' | '&';

export interface BinaryExpression extends BaseExpression {
  readonly type: 'binary';
  readonly operator: BinaryOperator;
  readonly left: FormulaExpression;
  readonly right: FormulaExpression;
}

export interface UnaryExpression extends BaseExpression {
  readonly type: 'unary';
  readonly operator: '+' | '-' | '@';
  readonly operand: FormulaExpression;
}

export interface PercentExpression extends BaseExpression {
  readonly type: 'percent';
  readonly operand: FormulaExpression;
}

export interface SpillExpression extends BaseExpression {
  readonly type: 'spill';
  readonly operand: FormulaExpression;
}

export interface FunctionCallExpression extends BaseExpression {
  readonly type: 'call';
  readonly name: string;
  readonly args: readonly FormulaExpression[];
}

export interface ParenthesizedExpression extends BaseExpression {
  readonly type: 'parenthesized';
  readonly expression: FormulaExpression;
}

export interface ArrayConstantExpression extends BaseExpression {
  readonly type: 'array';
  readonly rows: readonly (readonly FormulaExpression[])[];
}

export interface MissingExpression extends BaseExpression {
  readonly type: 'missing';
}

export interface InvalidExpression extends BaseExpression {
  readonly type: 'invalid';
  readonly raw: string;
}

export type FormulaExpression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | ErrorLiteral
  | NameExpression
  | ReferenceExpression
  | RangeExpression
  | UnionExpression
  | IntersectionExpression
  | BinaryExpression
  | UnaryExpression
  | PercentExpression
  | SpillExpression
  | FunctionCallExpression
  | ParenthesizedExpression
  | ArrayConstantExpression
  | MissingExpression
  | InvalidExpression;

export interface FormulaNode {
  readonly type: 'formula';
  readonly expression: FormulaExpression;
  readonly leadingEquals: boolean;
  readonly span: SourceSpan;
  readonly source?: string;
  readonly diagnostics?: readonly ParseDiagnostic[];
}

export interface CellPosition {
  readonly row: number;
  readonly column: number;
}

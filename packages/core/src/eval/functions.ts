export const SUPPORTED_FUNCTIONS = [
  'SUM',
  'AVERAGE',
  'COUNT',
  'COUNTA',
  'MIN',
  'MAX',
  'ROUND',
  'ABS',
  'IF',
  'IFERROR',
  'AND',
  'OR',
  'NOT',
  'SUMIF',
  'COUNTIF',
  'VLOOKUP',
  'HLOOKUP',
  'INDEX',
  'MATCH',
  'LEFT',
  'RIGHT',
  'LEN',
  'CONCATENATE',
  'DATE',
  'YEAR',
  'MONTH',
  'DAY',
  'PMT',
] as const;

export type SupportedFunction = (typeof SUPPORTED_FUNCTIONS)[number];

export const isSupportedFunction = (name: string): name is SupportedFunction =>
  (SUPPORTED_FUNCTIONS as readonly string[]).includes(name.toUpperCase());

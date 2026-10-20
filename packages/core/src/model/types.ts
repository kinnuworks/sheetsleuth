export type CellValue = string | number | boolean | null;

export interface Workbook {
  name: string;
  sheets: string[];
}

export interface Finding {
  code: string;
  message: string;
}

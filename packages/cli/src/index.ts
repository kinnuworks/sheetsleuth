import type { Workbook } from '@sheetsleuth/core';

export const commandName = 'sheetsleuth';

export function describeWorkbook(workbook: Workbook): string {
  return `${workbook.name}: ${workbook.sheets.length} sheet(s)`;
}

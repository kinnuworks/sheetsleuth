import { describe, expect, it } from 'vitest';

import { commandName, describeWorkbook } from './index.js';

describe('cli workspace', () => {
  it('has a stable command name', () => {
    expect(commandName).toBe('sheetsleuth');
    expect(
      describeWorkbook({
        name: 'demo.xlsx',
        sheets: [{ name: 'Sheet1', cells: [] }],
      }),
    ).toBe('demo.xlsx: 1 sheet(s)');
  });
});

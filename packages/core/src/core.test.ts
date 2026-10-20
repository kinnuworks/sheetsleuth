import { describe, expect, it } from 'vitest';

import type { Workbook } from './index.js';

describe('core workspace', () => {
  it('exports the workbook model', () => {
    const workbook: Workbook = {
      name: 'demo.xlsx',
      sheets: [{ name: 'Sheet1', cells: [] }],
    };

    expect(workbook.sheets[0]?.name).toBe('Sheet1');
  });
});

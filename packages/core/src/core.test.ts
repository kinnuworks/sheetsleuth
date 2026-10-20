import { describe, expect, it } from 'vitest';

import type { Workbook } from './index.js';

describe('core workspace', () => {
  it('exports the workbook model', () => {
    const workbook: Workbook = { name: 'demo.xlsx', sheets: ['Sheet1'] };

    expect(workbook.sheets).toEqual(['Sheet1']);
  });
});

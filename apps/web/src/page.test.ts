import { describe, expect, it } from 'vitest';

import { pageMessage, pagePath } from './page.js';

describe('web workspace', () => {
  it('describes the placeholder page', () => {
    expect(pageMessage).toBe(
      'Sheetsleuth: a spreadsheet check for AI agents. Coming together now.',
    );
    expect(pagePath).toBe('/sheetsleuth/');
  });
});

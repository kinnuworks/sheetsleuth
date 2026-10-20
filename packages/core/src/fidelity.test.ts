import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkSavedValues, fixtureExcludedCells } from './fidelity.js';
import { readXlsx } from './xlsx/index.js';

const root = join(process.cwd(), 'fixtures');

describe('saved-value fidelity', () => {
  it('matches every non-excluded formula cell in every committed fixture', () => {
    const specs = readdirSync(join(root, 'specs')).filter((file) => file.endsWith('.json')).sort();
    const lines: string[] = [];
    for (const specFile of specs) {
      const spec = JSON.parse(readFileSync(join(root, 'specs', specFile), 'utf8')) as { excludeFromFidelity?: unknown };
      const name = specFile.replace(/\.json$/, '');
      const bytes = new Uint8Array(readFileSync(join(root, 'xlsx', `${name}.xlsx`)));
      const result = readXlsx(bytes, `${name}.xlsx`);
      expect(result.ok, `${name} should be readable`).toBe(true);
      if (!result.ok) continue;
      const excluded = new Set<string>();
      for (const sheet of result.workbook.sheets) {
        for (const cell of sheet.cells) {
          if (fixtureExcludedCells(sheet.name, cell.address, spec.excludeFromFidelity)) {
            excluded.add(`${sheet.name}!${cell.address}`);
          }
        }
      }
      const fidelity = checkSavedValues(result.workbook, excluded);
      lines.push(`${name}: ${fidelity.mismatches.length === 0 ? '0 mismatches' : `${fidelity.mismatches.length} mismatches`}`);
      expect(fidelity.mismatches, `${name}: ${JSON.stringify(fidelity.mismatches)}`).toEqual([]);
    }
    expect(lines).toHaveLength(specs.length);
  });
});

import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFormulaCaches, readXlsxEntries } from './gen-fixtures.mjs';

const names = [
  'rr-reconstruction',
  'gene-list',
  'loan',
  'noise-budget',
  'agent-demo',
  'agent-edit-before',
  'agent-edit-broken',
  'agent-edit-intended',
  'agent-edit-unrelated',
];

async function readFixture(name) {
  return readFile(new URL(`../fixtures/xlsx/${name}.xlsx`, import.meta.url));
}

test('all fixture workbooks exist and every formula has a cached value', async () => {
  for (const name of names) {
    const buffer = await readFixture(name);
    assertFormulaCaches(buffer, name);
    const entries = readXlsxEntries(buffer);
    assert.ok(entries.has('xl/workbook.xml'), `${name} has a workbook part`);
    assert.ok(entries.has('xl/worksheets/sheet1.xml'), `${name} has a sheet part`);
  }
});

test('each spec records the recalculation tool and fidelity exclusions', async () => {
  for (const name of names) {
    const spec = JSON.parse(await readFile(new URL(`../fixtures/specs/${name}.json`, import.meta.url), 'utf8'));
    assert.equal(spec.name, name);
    assert.match(spec.sofficeVersion, /^LibreOffice \d+\.\d+\.\d+/);
    assert.ok(Array.isArray(spec.excludeFromFidelity));
  }
});

test('agent-demo preserves the required Model layout and formulas', async () => {
  const buffer = await readFixture('agent-demo');
  const entries = readXlsxEntries(buffer);
  const workbook = entries.get('xl/workbook.xml').toString('utf8');
  const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  const sharedStrings = entries.get('xl/sharedStrings.xml').toString('utf8');

  assert.match(workbook, /<sheet name="Model"/);
  assert.match(sheet, /<row r="4"[^>]*>.*?<c r="A4"[^>]*>.*?<\/c>.*?<c r="B4"[^>]*>.*?<\/c>.*?<c r="E4"[^>]*>.*?<\/c>/s);
  assert.match(sharedStrings, /<t[^>]*>Region<\/t>/);
  assert.match(sharedStrings, /<t[^>]*>Q1<\/t>/);
  assert.match(sharedStrings, /<t[^>]*>Q4<\/t>/);
  assert.doesNotMatch(sheet, /<row r="9">/);
  assert.match(sheet, /<c r="B10"[^>]*><f[^>]*>SUM\(B5:B8\)<\/f><v>340<\/v><\/c>/);
  assert.match(sheet, /<c r="E10"[^>]*><f[^>]*>SUM\(E5:E8\)<\/f><v>415<\/v><\/c>/);
  assert.match(sheet, /<c r="F10"[^>]*><f[^>]*>SUM\(B10:E10\)<\/f><v>1510<\/v><\/c>/);
});

test('loan approximate lookup has the pinned shared wrong row', async () => {
  const buffer = await readFixture('loan');
  const entries = readXlsxEntries(buffer);
  const sheet = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  assert.match(sheet, /<c r="B11"[^>]*><f[^>]*>VLOOKUP\(B3,A6:C9,3,TRUE\(\)\)<\/f><v>low<\/v><\/c>/);
  assert.match(sheet, /<c r="B12"[^>]*><f[^>]*>VLOOKUP\(B3,A6:C9,2,TRUE\(\)\)<\/f><v>1\.25<\/v><\/c>/);
});

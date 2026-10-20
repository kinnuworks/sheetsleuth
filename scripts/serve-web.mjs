import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 4173);
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const page = await readFile(resolve(repoRoot, 'apps/web/index.html'));

createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
}).listen(port, () => {
  console.log(`Sheetsleuth web preview: http://localhost:${port}/sheetsleuth/`);
});

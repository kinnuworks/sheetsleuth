import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.PORT ?? 4173);
const page = await readFile(resolve('apps/web/index.html'));

createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
}).listen(port, () => {
  console.log(`Sheetsleuth web preview: http://localhost:${port}/sheetsleuth/`);
});

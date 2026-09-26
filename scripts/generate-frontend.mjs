// React/Vite replacement for build-frontend.mjs, in progress across the
// migration's strangler phases (see the migration plan). Reads the Vite
// singlefile build output and wraps it in the same `getIndexHtml()` TS
// export shape as the existing frontend.generated.ts, so routes.ts's
// `c.html(getIndexHtml())` call needs no changes at the Phase 5 cutover.
//
// Writes to frontend.generated.next.ts, served behind the temporary `/next`
// route in routes.ts, so it never touches `/`'s frontend.generated.ts until
// Phase 5.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const distIndex = path.join(root, 'src', 'gateway', 'gui', 'frontend-web', 'dist', 'index.html');
const outFile = path.join(root, 'src', 'gateway', 'gui', 'frontend.generated.next.ts');

if (!fs.existsSync(distIndex)) {
  console.error(`No Vite build output found at ${distIndex}. Run 'npx vite build' in src/gateway/gui/frontend-web/ first.`);
  process.exit(1);
}

const html = fs.readFileSync(distIndex, 'utf8');

const generatedContent = `// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Produced by scripts/generate-frontend.mjs from
// src/gateway/gui/frontend-web/dist/index.html (Vite + vite-plugin-singlefile).
// Served behind the temporary GET /next route in routes.ts until the Phase 5
// cutover, when this replaces frontend.generated.ts as the default '/'.

export function getIndexHtml(): string {
  return ${JSON.stringify(html)};
}
`;

fs.writeFileSync(outFile, generatedContent);
console.log('Generated', outFile);

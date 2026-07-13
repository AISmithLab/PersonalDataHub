import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDir = path.join(__dirname, '..', 'src', 'gateway', 'gui', 'frontend');
const jsDir = path.join(frontendDir, 'js');
const generatedFile = path.join(__dirname, '..', 'src', 'gateway', 'gui', 'frontend.generated.ts');

if (!fs.existsSync(frontendDir)) {
    console.log("No frontend directory found, skipping.");
    process.exit(0);
}

const htmlSkeleton = fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(frontendDir, 'style.css'), 'utf8');
let mainJs = fs.readFileSync(path.join(jsDir, 'main.js'), 'utf8');

const jsFiles = fs.readdirSync(jsDir);
for (const file of jsFiles) {
    if (file === 'main.js') continue;
    if (file.endsWith('.js')) {
        const fnName = file.replace('.js', '');
        const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
        mainJs = mainJs.replace(`/* INJECT_${fnName} */`, content);
    }
}

let finalHtml = htmlSkeleton.replace('/* INJECT_CSS */', css);
finalHtml = finalHtml.replace('/* INJECT_JS */', mainJs);

const generatedContent = `// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Edit the files in src/gateway/gui/frontend/ instead.
// Run 'npm run build' or 'node scripts/build-frontend.mjs' to regenerate.

export function getIndexHtml(): string {
  return ${JSON.stringify(finalHtml)};
}
`;

fs.writeFileSync(generatedFile, generatedContent);
console.log("Generated frontend.generated.ts");

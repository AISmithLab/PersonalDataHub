import vm from 'node:vm';
import { createRequire } from 'node:module';
import util from 'node:util';

export interface RunResult {
  output: string;
  error?: string;
  duration: number;
  truncated: boolean;
}

const MAX_OUTPUT_BYTES = 10 * 1024; // 10 KB
const TIMEOUT_MS = 30_000;

export async function runCode(code: string, dataDir: string): Promise<RunResult> {
  // In the esbuild CJS bundle (Android), import.meta.url is undefined — __dirname is the
  // reliable anchor. Same pattern as android.ts. In ESM (desktop tsc), import.meta.url works.
  // typeof __dirname is safe on undeclared identifiers; no TypeScript error.
  const _reqBase: string = (typeof __dirname !== 'undefined')
    ? __dirname + '/runner.js'
    : import.meta.url;
  const _sandboxRequire = createRequire(_reqBase);

  const start = Date.now();
  const lines: string[] = [];

  const capturedConsole = {
    log: (...args: unknown[]) => { lines.push(util.format(...args)); },
    warn: (...args: unknown[]) => { lines.push('[warn] ' + util.format(...args)); },
    error: (...args: unknown[]) => { lines.push('[error] ' + util.format(...args)); },
    info: (...args: unknown[]) => { lines.push(util.format(...args)); },
    debug: (...args: unknown[]) => { lines.push('[debug] ' + util.format(...args)); },
  };

  const sandbox = vm.createContext({
    console: capturedConsole,
    fetch,
    require: _sandboxRequire,
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    AbortController,
    __dataDir: dataDir,
    // Read-only env snapshot + cwd; no process.exit, no process.kill
    process: { env: { ...process.env }, cwd: () => process.cwd() },
  });

  // Wrap in async IIFE so top-level await works in user code
  const wrapped = `(async () => {\n${code}\n})()`;

  let vmPromise: Promise<unknown>;
  try {
    // vm timeout kills synchronous infinite loops (while(true){}) before any await.
    // Without this, sync hangs block the event loop and Promise.race never fires.
    vmPromise = vm.runInContext(wrapped, sandbox, { timeout: TIMEOUT_MS }) as Promise<unknown>;
  } catch (err) {
    // Synchronous error: syntax error or sync timeout hit
    const duration = Date.now() - start;
    const { text, truncated } = buildOutput(lines);
    return { output: text, error: err instanceof Error ? err.message : String(err), duration, truncated };
  }

  // Promise.race kills async hangs (awaited fetch/Promise that never settles).
  // vm timeout alone doesn't help once the code has yielded.
  const timeoutPromise = new Promise<never>((_, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Execution timed out after ${TIMEOUT_MS / 1000}s`)),
      TIMEOUT_MS,
    );
    if (t && typeof (t as NodeJS.Timeout).unref === 'function') (t as NodeJS.Timeout).unref();
  });

  try {
    await Promise.race([vmPromise, timeoutPromise]);
  } catch (err) {
    const duration = Date.now() - start;
    const { text, truncated } = buildOutput(lines);
    return { output: text, error: err instanceof Error ? err.message : String(err), duration, truncated };
  }

  const duration = Date.now() - start;
  const { text, truncated } = buildOutput(lines);
  return { output: text, duration, truncated };
}

function buildOutput(lines: string[]): { text: string; truncated: boolean } {
  const text = lines.join('\n');
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) {
    return { text, truncated: false };
  }
  let result = '';
  let bytes = 0;
  for (const char of text) {
    const n = Buffer.byteLength(char, 'utf8');
    if (bytes + n > MAX_OUTPUT_BYTES) break;
    result += char;
    bytes += n;
  }
  return { text: result + '\n… (output truncated at 10 KB)', truncated: true };
}

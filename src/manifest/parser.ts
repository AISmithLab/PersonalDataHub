import type { Manifest, OperatorDecl } from './types.js';

/**
 * Parse a property value from the manifest DSL.
 * Supports: quoted strings, numbers, booleans, arrays.
 */
function parsePropertyValue(raw: string): unknown {
  const trimmed = raw.trim();

  // Quoted string
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;

  // Array (JSON-like)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Try to parse as a simple array of strings
      const inner = trimmed.slice(1, -1).trim();
      return inner.split(',').map((s) => {
        const v = s.trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          return v.slice(1, -1);
        }
        return v;
      });
    }
  }

  return trimmed;
}

/**
 * Parse the properties block: `{ key: value, key2: value2 }` or `{ key: value, ... }`
 * Handles nested quotes and arrays.
 */
function parseProperties(propsStr: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const content = propsStr.trim();

  if (!content) return props;

  // Split on commas that are not inside quotes or brackets
  const pairs: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inQuote) {
      current += ch;
      if (ch === quoteChar && content[i - 1] !== '\\') {
        inQuote = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
      continue;
    }

    if (ch === '[') depth++;
    if (ch === ']') depth--;

    if (ch === ',' && depth === 0) {
      pairs.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    pairs.push(current.trim());
  }

  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex === -1) continue;

    const key = pair.slice(0, colonIndex).trim();
    const value = pair.slice(colonIndex + 1).trim();
    props[key] = parsePropertyValue(value);
  }

  return props;
}

/**
 * Parse a manifest text into a Manifest object.
 */
export function parseManifest(text: string, id?: string): Manifest {
  const lines = text.split('\n');
  let purpose = '';
  let graph: string[] = [];
  const operators = new Map<string, OperatorDecl>();

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('//')) continue;

    // @purpose line
    if (line.startsWith('@purpose:')) {
      const raw = line.slice('@purpose:'.length).trim();
      purpose = raw.replace(/^["']|["']$/g, '');
      continue;
    }

    // @graph line
    if (line.startsWith('@graph:')) {
      const raw = line.slice('@graph:'.length).trim();
      graph = raw.split('->').map((s) => s.trim());
      continue;
    }

    // Operator declaration: name: type { props }
    // Strip inline comments first
    const commentIndex = findInlineCommentIndex(line);
    const cleanLine = commentIndex >= 0 ? line.slice(0, commentIndex).trim() : line;

    const match = cleanLine.match(/^(\w+)\s*:\s*(\w+)\s*\{(.*)\}\s*$/);
    if (match) {
      const [, opName, opType, propsRaw] = match;
      operators.set(opName, {
        name: opName,
        type: opType,
        properties: parseProperties(propsRaw),
      });
      continue;
    }

    // Operator without properties: name: type
    const simpleMatch = cleanLine.match(/^(\w+)\s*:\s*(\w+)\s*$/);
    if (simpleMatch) {
      const [, opName, opType] = simpleMatch;
      operators.set(opName, {
        name: opName,
        type: opType,
        properties: {},
      });
    }
  }

  if (!purpose) {
    throw new Error('Manifest is missing @purpose declaration');
  }

  return {
    id: id ?? 'unnamed',
    purpose,
    graph,
    operators,
  };
}

/**
 * Find the index of an inline comment (// not inside quotes).
 */
function findInlineCommentIndex(line: string): number {
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];

    if (inQuote) {
      if (ch === quoteChar && line[i - 1] !== '\\') {
        inQuote = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      continue;
    }

    if (ch === '/' && line[i + 1] === '/') {
      return i;
    }
  }

  return -1;
}

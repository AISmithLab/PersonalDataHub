import type { DataRow } from '../connectors/types.js';
import type { PipelineStep, OperatorFn } from './types.js';

/** Envelope fields that select_fields always preserves. */
const ENVELOPE_FIELDS = new Set(['source', 'source_item_id', 'type', 'timestamp']);

/** Built-in PII patterns: SSN, phone, email address, credit card. */
const DEFAULT_PII_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g,                          // SSN
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // US phone
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,      // email
  /\b(?:\d[ -]*?){13,16}\b/g,                         // credit card
];

function timeWindow(rows: DataRow[], step: PipelineStep): DataRow[] {
  if (step.op !== 'time_window') return rows;
  const after = step.after ? new Date(step.after).getTime() : -Infinity;
  const before = step.before ? new Date(step.before).getTime() : Infinity;
  return rows.filter((row) => {
    const t = new Date(row.timestamp).getTime();
    return t >= after && t <= before;
  });
}

function selectFields(rows: DataRow[], step: PipelineStep): DataRow[] {
  if (step.op !== 'select_fields') return rows;
  const allowed = new Set(step.fields.map((f) => f.toLowerCase()));
  return rows.map((row) => ({
    ...row,
    data: Object.fromEntries(
      Object.entries(row.data).filter(([key]) => allowed.has(key.toLowerCase())),
    ),
  }));
}

function excludeFields(rows: DataRow[], step: PipelineStep): DataRow[] {
  if (step.op !== 'exclude_fields') return rows;
  const blocked = new Set(step.fields.map((f) => f.toLowerCase()));
  return rows.map((row) => ({
    ...row,
    data: Object.fromEntries(
      Object.entries(row.data).filter(([key]) => !blocked.has(key.toLowerCase())),
    ),
  }));
}

function filterRows(rows: DataRow[], step: PipelineStep): DataRow[] {
  if (step.op !== 'filter_rows') return rows;
  const { field, contains, mode, or_field } = step;
  const needle = contains.toLowerCase();
  return rows.filter((row) => {
    const primary = String(row.data[field] ?? '').toLowerCase();
    const secondary = or_field ? String(row.data[or_field] ?? '').toLowerCase() : '';
    const matches = primary.includes(needle) || (or_field ? secondary.includes(needle) : false);
    return mode === 'include' ? matches : !matches;
  });
}

function hasAttachment(rows: DataRow[], step: PipelineStep): DataRow[] {
  if (step.op !== 'has_attachment') return rows;
  return rows.filter((row) => {
    const attachments = row.data.attachments as unknown[] | undefined;
    return Array.isArray(attachments) && attachments.length > 0;
  });
}

/** Counter object passed through redactPii to track total redactions. */
let _lastPiiRedactionCount = 0;
export function getLastPiiRedactionCount(): number { return _lastPiiRedactionCount; }

function redactPii(rows: DataRow[], step: PipelineStep): DataRow[] {
  if (step.op !== 'redact_pii') return rows;
  const patterns = step.patterns
    ? step.patterns.map((p) => new RegExp(p, 'g'))
    : DEFAULT_PII_PATTERNS;

  let count = 0;

  function redactValue(val: unknown): unknown {
    if (typeof val === 'string') {
      let result = val;
      for (const pat of patterns) {
        pat.lastIndex = 0;
        const replaced = result.replace(pat, () => { count++; return '[REDACTED]'; });
        result = replaced;
      }
      return result;
    }
    if (Array.isArray(val)) return val.map(redactValue);
    if (val && typeof val === 'object') {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, redactValue(v)]),
      );
    }
    return val;
  }

  const result = rows.map((row) => ({
    ...row,
    data: Object.fromEntries(
      Object.entries(row.data).map(([k, v]) => [k, redactValue(v)]),
    ),
  }));

  _lastPiiRedactionCount = count;
  return result;
}

function limitRows(rows: DataRow[], step: PipelineStep): DataRow[] {
  if (step.op !== 'limit') return rows;
  return rows.slice(0, step.max);
}

/** Registry of all operator implementations. */
export const operatorRegistry = new Map<string, OperatorFn>([
  ['time_window', timeWindow],
  ['select_fields', selectFields],
  ['exclude_fields', excludeFields],
  ['filter_rows', filterRows],
  ['has_attachment', hasAttachment],
  ['redact_pii', redactPii],
  ['limit', limitRows],
]);

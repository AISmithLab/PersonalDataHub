import { describe, it, expect } from 'vitest';
import type { DataRow } from '../connectors/types.js';
import type { QuickFilter } from '../filters.js';
import { applyFilters } from '../filters.js';
import { executePipeline } from './engine.js';
import { quickFiltersToSteps } from './compat.js';
import { validatePipeline } from './validate.js';
import type { PipelineStep, PipelineDefinition } from './types.js';

function makeTestRows(): DataRow[] {
  return [
    {
      source: 'gmail',
      source_item_id: 'msg_1',
      type: 'email',
      timestamp: '2026-02-20T10:00:00Z',
      data: {
        title: 'Q4 Report',
        body: 'Revenue details for alice@example.com, SSN 123-45-6789',
        author_email: 'alice@co.com',
        author_name: 'Alice Smith',
        attachments: [{ name: 'report.pdf' }],
      },
    },
    {
      source: 'gmail',
      source_item_id: 'msg_2',
      type: 'email',
      timestamp: '2026-02-19T08:00:00Z',
      data: {
        title: 'Deploy Notice',
        body: 'Deployment at 3pm. Call 555-123-4567.',
        author_email: 'bob@co.com',
        author_name: 'Bob Jones',
        attachments: [],
      },
    },
    {
      source: 'gmail',
      source_item_id: 'msg_3',
      type: 'email',
      timestamp: '2026-01-15T12:00:00Z',
      data: {
        title: 'Newsletter Weekly',
        body: 'This week in tech. CC: 4111-1111-1111-1111',
        author_email: 'noreply@news.com',
        author_name: 'Newsletter Bot',
      },
    },
  ];
}

// --- Individual operator tests ---

describe('time_window operator', () => {
  it('filters rows after a date', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'time_window', after: '2026-02-01T00:00:00Z' },
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.source_item_id)).toEqual(['msg_1', 'msg_2']);
  });

  it('filters rows before a date', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'time_window', before: '2026-02-01T00:00:00Z' },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source_item_id).toBe('msg_3');
  });

  it('filters rows within a range', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'time_window', after: '2026-02-19T00:00:00Z', before: '2026-02-19T23:59:59Z' },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source_item_id).toBe('msg_2');
  });
});

describe('select_fields operator', () => {
  it('keeps only specified fields in row.data', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'select_fields', fields: ['title'] },
    ]);
    for (const row of result.rows) {
      expect(Object.keys(row.data)).toEqual(['title']);
    }
  });

  it('preserves envelope fields (source, source_item_id, type, timestamp)', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'select_fields', fields: ['title'] },
    ]);
    for (const row of result.rows) {
      expect(row.source).toBe('gmail');
      expect(row.source_item_id).toBeDefined();
      expect(row.type).toBe('email');
      expect(row.timestamp).toBeDefined();
    }
  });

  it('is case-insensitive', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'select_fields', fields: ['Title'] },
    ]);
    expect(result.rows[0].data.title).toBe('Q4 Report');
  });
});

describe('exclude_fields operator', () => {
  it('removes specified fields from row.data', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'exclude_fields', fields: ['body'] },
    ]);
    for (const row of result.rows) {
      expect(row.data.body).toBeUndefined();
      expect(row.data.title).toBeDefined();
    }
  });
});

describe('filter_rows operator', () => {
  it('includes rows matching field value', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'filter_rows', field: 'author_email', contains: 'alice', mode: 'include' },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source_item_id).toBe('msg_1');
  });

  it('excludes rows matching field value', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'filter_rows', field: 'author_email', contains: 'noreply', mode: 'exclude' },
    ]);
    expect(result.rows).toHaveLength(2);
  });

  it('supports or_field for matching', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'filter_rows', field: 'author_email', or_field: 'author_name', contains: 'Bob', mode: 'include' },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source_item_id).toBe('msg_2');
  });

  it('is case-insensitive', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'filter_rows', field: 'title', contains: 'q4', mode: 'include' },
    ]);
    expect(result.rows).toHaveLength(1);
  });
});

describe('has_attachment operator', () => {
  it('keeps only rows with non-empty attachments', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'has_attachment' },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source_item_id).toBe('msg_1');
  });
});

describe('redact_pii operator', () => {
  it('redacts SSN patterns', () => {
    const result = executePipeline(makeTestRows(), [{ op: 'redact_pii' }]);
    const msg1 = result.rows.find((r) => r.source_item_id === 'msg_1')!;
    expect(msg1.data.body).toContain('[REDACTED]');
    expect(msg1.data.body).not.toContain('123-45-6789');
  });

  it('redacts phone number patterns', () => {
    const result = executePipeline(makeTestRows(), [{ op: 'redact_pii' }]);
    const msg2 = result.rows.find((r) => r.source_item_id === 'msg_2')!;
    expect(msg2.data.body).not.toContain('555-123-4567');
  });

  it('redacts email address patterns', () => {
    const result = executePipeline(makeTestRows(), [{ op: 'redact_pii' }]);
    const msg1 = result.rows.find((r) => r.source_item_id === 'msg_1')!;
    expect(msg1.data.body).not.toContain('alice@example.com');
  });

  it('redacts credit card patterns', () => {
    const result = executePipeline(makeTestRows(), [{ op: 'redact_pii' }]);
    const msg3 = result.rows.find((r) => r.source_item_id === 'msg_3')!;
    expect(msg3.data.body).not.toContain('4111-1111-1111-1111');
  });

  it('tracks redaction count in metadata', () => {
    const result = executePipeline(makeTestRows(), [{ op: 'redact_pii' }]);
    expect(result.meta.piiRedactions).toBeGreaterThan(0);
  });
});

describe('limit operator', () => {
  it('limits the number of rows returned', () => {
    const result = executePipeline(makeTestRows(), [{ op: 'limit', max: 1 }]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source_item_id).toBe('msg_1');
  });
});

// --- Multi-step pipeline ---

describe('executePipeline', () => {
  it('applies multiple steps in order', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'time_window', after: '2026-02-01T00:00:00Z' },
      { op: 'select_fields', fields: ['title'] },
      { op: 'limit', max: 1 },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(Object.keys(result.rows[0].data)).toEqual(['title']);
    expect(result.meta.stepsApplied).toEqual(['time_window', 'select_fields', 'limit']);
  });

  it('skips pull_source step', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'pull_source', source: 'gmail' },
      { op: 'limit', max: 2 },
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.meta.stepsApplied).toEqual(['limit']);
  });

  it('returns all rows when steps array is empty', () => {
    const result = executePipeline(makeTestRows(), []);
    expect(result.rows).toHaveLength(3);
    expect(result.meta.stepsApplied).toEqual([]);
  });

  it('handles empty rows input', () => {
    const result = executePipeline([], [
      { op: 'filter_rows', field: 'title', contains: 'test', mode: 'include' },
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.meta.inputCount).toBe(0);
  });

  it('throws on unknown operator', () => {
    expect(() =>
      executePipeline(makeTestRows(), [{ op: 'unknown_op' } as unknown as PipelineStep]),
    ).toThrow('Unknown pipeline operator');
  });

  it('tracks metadata correctly', () => {
    const result = executePipeline(makeTestRows(), [
      { op: 'time_window', after: '2026-02-01T00:00:00Z' },
      { op: 'limit', max: 1 },
    ]);
    expect(result.meta.inputCount).toBe(3);
    expect(result.meta.outputCount).toBe(1);
  });
});

// --- QuickFilter compatibility ---

describe('quickFiltersToSteps', () => {
  it('translates time_after filter', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'time_after', value: '2026-02-01', enabled: 1 },
    ]);
    expect(steps).toEqual([{ op: 'time_window', after: '2026-02-01' }]);
  });

  it('translates from_include filter with or_field', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'from_include', value: 'alice', enabled: 1 },
    ]);
    expect(steps).toEqual([{
      op: 'filter_rows', field: 'author_email', or_field: 'author_name', contains: 'alice', mode: 'include',
    }]);
  });

  it('translates subject_include filter', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'subject_include', value: 'report', enabled: 1 },
    ]);
    expect(steps).toEqual([{
      op: 'filter_rows', field: 'title', contains: 'report', mode: 'include',
    }]);
  });

  it('translates exclude_sender filter', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'exclude_sender', value: 'noreply', enabled: 1 },
    ]);
    expect(steps).toEqual([{
      op: 'filter_rows', field: 'author_email', or_field: 'author_name', contains: 'noreply', mode: 'exclude',
    }]);
  });

  it('translates exclude_keyword filter', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'exclude_keyword', value: 'newsletter', enabled: 1 },
    ]);
    expect(steps).toEqual([{
      op: 'filter_rows', field: 'title', contains: 'newsletter', mode: 'exclude',
    }]);
  });

  it('translates has_attachment filter', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'has_attachment', value: '', enabled: 1 },
    ]);
    expect(steps).toEqual([{ op: 'has_attachment' }]);
  });

  it('translates hide_field filter to exclude_fields', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'hide_field', value: 'body', enabled: 1 },
    ]);
    expect(steps).toEqual([{ op: 'exclude_fields', fields: ['body'] }]);
  });

  it('skips disabled filters', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'time_after', value: '2026-02-01', enabled: 0 },
    ]);
    expect(steps).toEqual([]);
  });

  it('orders row predicates before field transforms', () => {
    const steps = quickFiltersToSteps([
      { id: '1', source: 'gmail', type: 'hide_field', value: 'body', enabled: 1 },
      { id: '2', source: 'gmail', type: 'from_include', value: 'alice', enabled: 1 },
    ]);
    expect(steps[0].op).toBe('filter_rows');
    expect(steps[1].op).toBe('exclude_fields');
  });
});

// --- Round-trip backward compatibility ---

describe('backward compatibility: applyFilters vs pipeline engine', () => {
  const filterSets: { label: string; filters: QuickFilter[] }[] = [
    {
      label: 'time_after',
      filters: [{ id: '1', source: 'gmail', type: 'time_after', value: '2026-02-01T00:00:00Z', enabled: 1 }],
    },
    {
      label: 'from_include',
      filters: [{ id: '1', source: 'gmail', type: 'from_include', value: 'alice', enabled: 1 }],
    },
    {
      label: 'subject_include',
      filters: [{ id: '1', source: 'gmail', type: 'subject_include', value: 'Report', enabled: 1 }],
    },
    {
      label: 'exclude_sender',
      filters: [{ id: '1', source: 'gmail', type: 'exclude_sender', value: 'noreply', enabled: 1 }],
    },
    {
      label: 'exclude_keyword',
      filters: [{ id: '1', source: 'gmail', type: 'exclude_keyword', value: 'Newsletter', enabled: 1 }],
    },
    {
      label: 'has_attachment',
      filters: [{ id: '1', source: 'gmail', type: 'has_attachment', value: '', enabled: 1 }],
    },
    {
      label: 'hide_field (body)',
      filters: [{ id: '1', source: 'gmail', type: 'hide_field', value: 'body', enabled: 1 }],
    },
    {
      label: 'combined: exclude_sender + hide_field',
      filters: [
        { id: '1', source: 'gmail', type: 'exclude_sender', value: 'noreply', enabled: 1 },
        { id: '2', source: 'gmail', type: 'hide_field', value: 'body', enabled: 1 },
      ],
    },
    {
      label: 'no filters',
      filters: [],
    },
  ];

  for (const { label, filters } of filterSets) {
    it(`produces identical output for: ${label}`, () => {
      const rows = makeTestRows();
      const legacy = applyFilters(rows, filters);
      const steps = quickFiltersToSteps(filters);
      const pipeline = executePipeline(rows, steps);
      expect(pipeline.rows).toEqual(legacy);
    });
  }
});

// --- Validation ---

describe('validatePipeline', () => {
  it('accepts a valid pipeline definition', () => {
    const def: PipelineDefinition = {
      pipeline: 'test',
      steps: [
        { op: 'time_window', after: '2026-01-01T00:00:00Z' },
        { op: 'select_fields', fields: ['title'] },
        { op: 'limit', max: 10 },
      ],
    };
    expect(validatePipeline(def)).toEqual({ valid: true, errors: [] });
  });

  it('rejects empty pipeline name', () => {
    const result = validatePipeline({ pipeline: '', steps: [{ op: 'has_attachment' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects empty steps array', () => {
    const result = validatePipeline({ pipeline: 'test', steps: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects select_fields with empty fields array', () => {
    const result = validatePipeline({
      pipeline: 'test',
      steps: [{ op: 'select_fields', fields: [] }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects limit with non-positive max', () => {
    const result = validatePipeline({
      pipeline: 'test',
      steps: [{ op: 'limit', max: 0 }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects filter_rows with empty contains', () => {
    const result = validatePipeline({
      pipeline: 'test',
      steps: [{ op: 'filter_rows', field: 'title', contains: '', mode: 'include' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects unknown op', () => {
    const result = validatePipeline({
      pipeline: 'test',
      steps: [{ op: 'unknown' } as unknown as PipelineStep],
    });
    expect(result.valid).toBe(false);
  });
});

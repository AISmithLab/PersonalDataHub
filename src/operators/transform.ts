import type { Operator, OperatorResult } from './types.js';
import type { DataRow } from '../connectors/types.js';

export const transformOperator: Operator = {
  type: 'transform',

  async execute(
    input: DataRow[],
    _context,
    props: Record<string, unknown>,
  ): Promise<OperatorResult> {
    const kind = props.kind as string;

    if (!kind) {
      throw new Error('transform operator requires "kind" property');
    }

    switch (kind) {
      case 'redact':
        return applyRedact(input, props);
      case 'truncate':
        return applyTruncate(input, props);
      default:
        throw new Error(`Unknown transform kind: "${kind}"`);
    }
  },
};

function applyRedact(rows: DataRow[], props: Record<string, unknown>): DataRow[] {
  const field = props.field as string;
  const pattern = props.pattern as string;
  const replacement = (props.replacement as string) ?? '[REDACTED]';

  if (!field || !pattern) {
    throw new Error('transform redact requires "field" and "pattern" properties');
  }

  const regex = new RegExp(pattern, 'g');

  return rows.map((row) => {
    const value = row.data[field];
    if (typeof value !== 'string') return row;

    return {
      ...row,
      data: {
        ...row.data,
        [field]: value.replace(regex, replacement),
      },
    };
  });
}

function applyTruncate(rows: DataRow[], props: Record<string, unknown>): DataRow[] {
  const field = props.field as string;
  const maxLength = props.max_length as number;

  if (!field || typeof maxLength !== 'number') {
    throw new Error('transform truncate requires "field" and "max_length" properties');
  }

  return rows.map((row) => {
    const value = row.data[field];
    if (typeof value !== 'string') return row;

    if (value.length <= maxLength) return row;

    return {
      ...row,
      data: {
        ...row.data,
        [field]: value.slice(0, maxLength) + '...',
      },
    };
  });
}

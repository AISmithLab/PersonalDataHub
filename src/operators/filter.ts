import type { Operator, OperatorResult } from './types.js';
import type { DataRow } from '../connectors/types.js';

export const filterOperator: Operator = {
  type: 'filter',

  async execute(
    input: DataRow[],
    _context,
    props: Record<string, unknown>,
  ): Promise<OperatorResult> {
    const field = props.field as string;
    const op = props.op as string;
    const value = props.value;

    if (!field || !op) {
      throw new Error('filter operator requires "field" and "op" properties');
    }

    return input.filter((row) => {
      const fieldValue = row.data[field];
      return matchesCondition(fieldValue, op, value);
    });
  },
};

function matchesCondition(fieldValue: unknown, op: string, value: unknown): boolean {
  switch (op) {
    case 'eq':
      return fieldValue === value;

    case 'neq':
      return fieldValue !== value;

    case 'contains':
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(value);
      }
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return fieldValue.includes(value);
      }
      return false;

    case 'gt':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;

    case 'lt':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;

    case 'matches':
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        const regex = new RegExp(value);
        return regex.test(fieldValue);
      }
      return false;

    default:
      throw new Error(`Unknown filter op: "${op}"`);
  }
}

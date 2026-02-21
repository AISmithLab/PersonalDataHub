import type { Operator, OperatorResult } from './types.js';
import type { DataRow } from '../connectors/types.js';

export const selectOperator: Operator = {
  type: 'select',

  async execute(
    input: DataRow[],
    _context,
    props: Record<string, unknown>,
  ): Promise<OperatorResult> {
    const fields = props.fields as string[];

    if (!fields || !Array.isArray(fields)) {
      throw new Error('select operator requires "fields" property (array of field names)');
    }

    return input.map((row) => {
      const filteredData: Record<string, unknown> = {};
      for (const field of fields) {
        if (field in row.data) {
          filteredData[field] = row.data[field];
        }
      }
      return {
        ...row,
        data: filteredData,
      };
    });
  },
};

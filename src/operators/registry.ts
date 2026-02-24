import type { Operator } from './types.js';
import { pullOperator } from './pull.js';
import { selectOperator } from './select.js';
import { filterOperator } from './filter.js';
import { transformOperator } from './transform.js';
import { stageOperator } from './stage.js';
import { storeOperator } from './store.js';

const operators = new Map<string, Operator>([
  ['pull', pullOperator],
  ['select', selectOperator],
  ['filter', filterOperator],
  ['transform', transformOperator],
  ['stage', stageOperator],
  ['store', storeOperator],
]);

export const KNOWN_OPERATOR_TYPES = new Set(operators.keys());

export function getOperator(type: string): Operator {
  const op = operators.get(type);
  if (!op) {
    throw new Error(`Unknown operator type: "${type}"`);
  }
  return op;
}

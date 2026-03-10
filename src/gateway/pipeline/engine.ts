import type { DataRow } from '../connectors/types.js';
import type { PipelineStep, PipelineResult } from './types.js';
import { operatorRegistry, getLastPiiRedactionCount } from './operators.js';

/**
 * Execute a pipeline of operators against a set of data rows.
 * Pure function (aside from PII redaction counter tracking).
 */
export function executePipeline(rows: DataRow[], steps: PipelineStep[]): PipelineResult {
  const inputCount = rows.length;
  const stepsApplied: string[] = [];
  let piiRedactions = 0;
  let current = rows;

  for (const step of steps) {
    // skip pull_source — data is already fetched
    if (step.op === 'pull_source') continue;

    const operator = operatorRegistry.get(step.op);
    if (!operator) {
      throw new Error(`Unknown pipeline operator: ${step.op}`);
    }

    current = operator(current, step);
    stepsApplied.push(step.op);

    if (step.op === 'redact_pii') {
      piiRedactions += getLastPiiRedactionCount();
    }
  }

  return {
    rows: current,
    meta: {
      inputCount,
      outputCount: current.length,
      stepsApplied,
      piiRedactions,
    },
  };
}

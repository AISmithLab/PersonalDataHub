import type { DataRow } from '../connectors/types.js';

export type PipelineStep =
  | { op: 'pull_source'; source: string; query?: string }
  | { op: 'time_window'; after?: string; before?: string }
  | { op: 'select_fields'; fields: string[] }
  | { op: 'exclude_fields'; fields: string[] }
  | { op: 'filter_rows'; field: string; contains: string; mode: 'include' | 'exclude'; or_field?: string }
  | { op: 'has_attachment' }
  | { op: 'redact_pii'; patterns?: string[] }
  | { op: 'limit'; max: number };

export interface PipelineDefinition {
  pipeline: string;
  steps: PipelineStep[];
  allowed_actions?: string[];
  rate_limit?: { max_pulls_per_hour?: number; max_results_per_pull?: number };
}

export interface PipelineResult {
  rows: DataRow[];
  meta: {
    inputCount: number;
    outputCount: number;
    stepsApplied: string[];
    piiRedactions: number;
  };
}

export type OperatorFn = (rows: DataRow[], step: PipelineStep) => DataRow[];

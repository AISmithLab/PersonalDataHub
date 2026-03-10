import { z } from 'zod';
import type { PipelineDefinition } from './types.js';

const pullSourceSchema = z.object({ op: z.literal('pull_source'), source: z.string().min(1), query: z.string().optional() });
const timeWindowSchema = z.object({ op: z.literal('time_window'), after: z.string().datetime().optional(), before: z.string().datetime().optional() });
const selectFieldsSchema = z.object({ op: z.literal('select_fields'), fields: z.array(z.string().min(1)).min(1) });
const excludeFieldsSchema = z.object({ op: z.literal('exclude_fields'), fields: z.array(z.string().min(1)).min(1) });
const filterRowsSchema = z.object({
  op: z.literal('filter_rows'),
  field: z.string().min(1),
  contains: z.string().min(1),
  mode: z.enum(['include', 'exclude']),
  or_field: z.string().min(1).optional(),
});
const hasAttachmentSchema = z.object({ op: z.literal('has_attachment') });
const redactPiiSchema = z.object({ op: z.literal('redact_pii'), patterns: z.array(z.string()).optional() });
const limitSchema = z.object({ op: z.literal('limit'), max: z.number().int().positive() });

const stepSchema = z.discriminatedUnion('op', [
  pullSourceSchema,
  timeWindowSchema,
  selectFieldsSchema,
  excludeFieldsSchema,
  filterRowsSchema,
  hasAttachmentSchema,
  redactPiiSchema,
  limitSchema,
]);

const pipelineDefinitionSchema = z.object({
  pipeline: z.string().min(1),
  steps: z.array(stepSchema).min(1),
  allowed_actions: z.array(z.string()).optional(),
  rate_limit: z.object({
    max_pulls_per_hour: z.number().int().positive().optional(),
    max_results_per_pull: z.number().int().positive().optional(),
  }).optional(),
});

export function validatePipeline(def: PipelineDefinition): { valid: boolean; errors: string[] } {
  const result = pipelineDefinitionSchema.safeParse(def);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  };
}

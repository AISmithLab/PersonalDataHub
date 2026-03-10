import type { PipelineDefinition } from './types.js';

export interface ActionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether a proposed action is allowed by the pipeline's allowed_actions list.
 * - undefined allowed_actions → allow all (backward compat)
 * - empty array → deny all actions
 * - non-empty array → only listed actions are permitted
 */
export function checkActionAllowed(
  pipelineDef: PipelineDefinition,
  actionType: string,
): ActionCheckResult {
  if (pipelineDef.allowed_actions === undefined) {
    return { allowed: true };
  }

  if (pipelineDef.allowed_actions.length === 0) {
    return { allowed: false, reason: `Pipeline "${pipelineDef.pipeline}" does not allow any actions` };
  }

  if (pipelineDef.allowed_actions.includes(actionType)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Pipeline "${pipelineDef.pipeline}" does not allow action "${actionType}". Allowed: ${pipelineDef.allowed_actions.join(', ')}`,
  };
}

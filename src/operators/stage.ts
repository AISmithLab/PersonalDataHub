import { randomUUID } from 'node:crypto';
import type { Operator, PipelineContext, OperatorResult } from './types.js';
import type { DataRow, ActionResult } from '../connectors/types.js';

export const stageOperator: Operator = {
  type: 'stage',

  async execute(
    _input: DataRow[],
    context: PipelineContext,
    props: Record<string, unknown>,
  ): Promise<OperatorResult> {
    const actionType = props.action_type as string;

    if (!actionType) {
      throw new Error('stage operator requires "action_type" property');
    }

    const actionId = `act_${randomUUID().slice(0, 12)}`;
    const actionData = props.action_data ?? {};

    context.db
      .prepare(
        `INSERT INTO staging (action_id, manifest_id, source, action_type, action_data, purpose, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(
        actionId,
        context.manifestId,
        props.source ?? '',
        actionType,
        JSON.stringify(actionData),
        props.purpose ?? '',
      );

    return {
      success: true,
      message: `Action staged for review: ${actionId}`,
      resultData: { actionId, status: 'pending' },
    } satisfies ActionResult;
  },
};

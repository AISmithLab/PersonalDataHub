export interface DataRow {
  source: string;
  source_item_id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface SourceBoundary {
  after?: string;
  labels?: string[];
  exclude_labels?: string[];
  repos?: string[];
  types?: string[];
}

export interface ActionResult {
  success: boolean;
  message: string;
  resultData?: Record<string, unknown>;
}

export interface SourceConnector {
  name: string;
  fetch(boundary: SourceBoundary, params?: Record<string, unknown>): Promise<DataRow[]>;
  executeAction(actionType: string, actionData: Record<string, unknown>): Promise<ActionResult>;
}

export type ConnectorRegistry = Map<string, SourceConnector>;

export function serializeDataRow(row: DataRow): string {
  return JSON.stringify(row);
}

export function deserializeDataRow(json: string): DataRow {
  const parsed = JSON.parse(json);
  return {
    source: parsed.source,
    source_item_id: parsed.source_item_id,
    type: parsed.type,
    timestamp: parsed.timestamp,
    data: parsed.data,
  };
}

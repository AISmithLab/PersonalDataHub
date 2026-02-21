export interface OperatorDecl {
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface Manifest {
  id: string;
  purpose: string;
  graph: string[];
  operators: Map<string, OperatorDecl>;
}

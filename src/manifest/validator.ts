import type { Manifest } from './types.js';

const KNOWN_OPERATOR_TYPES = new Set(['pull', 'select', 'filter', 'transform', 'stage', 'store']);

const REQUIRED_PROPERTIES: Record<string, string[]> = {
  pull: ['source'],
};

export interface ValidationError {
  message: string;
}

/**
 * Validate a parsed manifest.
 * Returns an array of validation errors (empty if valid).
 */
export function validateManifest(manifest: Manifest): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check that every node in @graph has a corresponding operator declaration
  for (const nodeName of manifest.graph) {
    if (!manifest.operators.has(nodeName)) {
      errors.push({ message: `Graph references undeclared operator: "${nodeName}"` });
    }
  }

  // Check that operator types are in the known set
  for (const [name, op] of manifest.operators) {
    if (!KNOWN_OPERATOR_TYPES.has(op.type)) {
      errors.push({ message: `Operator "${name}" has unknown type: "${op.type}"` });
    }
  }

  // Check required properties per operator type
  for (const [name, op] of manifest.operators) {
    const required = REQUIRED_PROPERTIES[op.type];
    if (required) {
      for (const prop of required) {
        if (!(prop in op.properties)) {
          errors.push({ message: `Operator "${name}" (type "${op.type}") is missing required property: "${prop}"` });
        }
      }
    }
  }

  // Check that @graph forms a linear chain (no cycles) — for V1
  // Since it's just a linear chain declared as a -> b -> c, we only
  // need to verify no duplicate node names
  const seen = new Set<string>();
  for (const nodeName of manifest.graph) {
    if (seen.has(nodeName)) {
      errors.push({ message: `Graph contains duplicate node: "${nodeName}"` });
    }
    seen.add(nodeName);
  }

  return errors;
}

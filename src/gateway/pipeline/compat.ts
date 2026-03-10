import type { QuickFilter } from '../filters.js';
import type { PipelineStep } from './types.js';

/**
 * Translate legacy QuickFilter[] into pipeline steps.
 * Ordering: row predicates first, then field transforms (matches applyFilters behavior).
 */
export function quickFiltersToSteps(filters: QuickFilter[]): PipelineStep[] {
  const enabled = filters.filter((f) => f.enabled);
  if (!enabled.length) return [];

  const rowSteps: PipelineStep[] = [];
  const fieldSteps: PipelineStep[] = [];

  for (const f of enabled) {
    switch (f.type) {
      case 'time_after':
        rowSteps.push({ op: 'time_window', after: f.value });
        break;
      case 'from_include':
        rowSteps.push({
          op: 'filter_rows',
          field: 'author_email',
          or_field: 'author_name',
          contains: f.value,
          mode: 'include',
        });
        break;
      case 'subject_include':
        rowSteps.push({
          op: 'filter_rows',
          field: 'title',
          contains: f.value,
          mode: 'include',
        });
        break;
      case 'exclude_sender':
        rowSteps.push({
          op: 'filter_rows',
          field: 'author_email',
          or_field: 'author_name',
          contains: f.value,
          mode: 'exclude',
        });
        break;
      case 'exclude_keyword':
        rowSteps.push({
          op: 'filter_rows',
          field: 'title',
          contains: f.value,
          mode: 'exclude',
        });
        break;
      case 'has_attachment':
        rowSteps.push({ op: 'has_attachment' });
        break;
      case 'hide_field':
        fieldSteps.push({ op: 'exclude_fields', fields: [f.value] });
        break;
    }
  }

  return [...rowSteps, ...fieldSteps];
}

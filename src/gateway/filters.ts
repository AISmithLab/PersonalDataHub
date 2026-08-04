import type { DataRow } from './connectors/types.js';

export interface QuickFilter {
  id: string;
  source: string;
  type: string;
  value: string;
  enabled: number;
}

export interface SourceFilterDefinition {
  id: string;
  source: 'gmail' | 'sms' | 'photo' | 'contacts' | 'calendar' | 'github' | 'all';
  filterType: string;
  label: string;
  placeholder: string;
  needsValue: boolean;
  applicableFields?: string[];
}

export interface FilterTypeMeta {
  label: string;
  placeholder: string;
  needsValue: boolean;
  source?: 'gmail' | 'sms' | 'photo' | 'contacts' | 'calendar' | 'github' | 'all';
}

export const FILTER_TYPES: Record<string, FilterTypeMeta> = {
  // Gmail / Email filters
  time_after: { label: 'Only emails after', placeholder: 'YYYY-MM-DD', needsValue: true, source: 'gmail' },
  from_include: { label: 'Only from sender', placeholder: 'e.g. alice@co.com', needsValue: true, source: 'gmail' },
  subject_include: { label: 'Subject contains', placeholder: 'e.g. meeting', needsValue: true, source: 'gmail' },
  exclude_sender: { label: 'Exclude sender', placeholder: 'e.g. noreply@', needsValue: true, source: 'gmail' },
  exclude_keyword: { label: 'Exclude subject containing', placeholder: 'e.g. newsletter', needsValue: true, source: 'gmail' },
  has_attachment: { label: 'Only with attachments', placeholder: '', needsValue: false, source: 'gmail' },
  email_label: { label: 'Only with email label', placeholder: 'e.g. INBOX, UNREAD', needsValue: true, source: 'gmail' },

  // Photo / Media filters
  photo_after: { label: 'Only photos after', placeholder: 'YYYY-MM-DD', needsValue: true, source: 'photo' },
  photo_album: { label: 'Album / folder matches', placeholder: 'e.g. Receipts, Screenshots', needsValue: true, source: 'photo' },
  photo_keep_exif: { label: 'Preserve EXIF GPS / metadata', placeholder: '', needsValue: false, source: 'photo' },

  // SMS filters
  sms_after: { label: 'Only SMS after', placeholder: 'YYYY-MM-DD', needsValue: true, source: 'sms' },
  sms_sender: { label: 'Only from phone number', placeholder: 'e.g. +15550000000', needsValue: true, source: 'sms' },

  // Calendar filters
  cal_calendar_id: { label: 'Only from calendar', placeholder: 'e.g. Personal, Work', needsValue: true, source: 'calendar' },

  // Global / All sources filters
  hide_field: { label: 'Hide field from agents', placeholder: 'e.g. body', needsValue: true, source: 'all' },
};

/**
 * Automatically strip EXIF GPS coordinates, camera serial numbers, device model,
 * and author metadata from photo rows by default.
 */
export function stripExifMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const EXIF_STRIP_KEYS = [
    'latitude',
    'longitude',
    'gps',
    'exif',
    'serialnumber',
    'serial_number',
    'cameramodel',
    'camera_model',
    'cameramake',
    'camera_make',
    'author',
    'location',
    'devicemodel',
    'device_model',
    'altitude',
    'gpslatitude',
    'gpslongitude',
  ];
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!EXIF_STRIP_KEYS.includes(key.toLowerCase())) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

/**
 * Apply enabled quick filters to a set of data rows.
 * Each filter is either a predicate (keeps/drops rows) or a field-remover.
 * Also enforces automatic EXIF GPS / identifiable metadata stripping on photo rows by default.
 */
export function applyFilters(rows: DataRow[], filters: QuickFilter[]): DataRow[] {
  const enabledFilters = filters.filter((f) => f.enabled);

  // Check if photo_keep_exif is explicitly enabled
  const keepExif = enabledFilters.some((f) => f.type === 'photo_keep_exif' && f.enabled);

  // Separate field-hiding filters from row filters
  const hideFields: string[] = [];
  const rowFilters: QuickFilter[] = [];

  for (const f of enabledFilters) {
    if (f.type === 'hide_field') {
      hideFields.push(f.value.toLowerCase());
    } else {
      rowFilters.push(f);
    }
  }

  // Apply row predicates
  let result = rows;
  for (const f of rowFilters) {
    result = result.filter((row) => matchesFilter(row, f));
  }

  // Apply field hiding
  if (hideFields.length) {
    result = result.map((row) => ({
      ...row,
      data: Object.fromEntries(
        Object.entries(row.data).filter(
          ([key]) => !hideFields.includes(key.toLowerCase()),
        ),
      ),
    }));
  }

  // Apply automatic EXIF GPS / identifiable metadata stripping for photo rows by default
  result = result.map((row) => {
    if (row.source === 'photo' || row.source === 'device_photos' || row.source === 'photos') {
      if (!keepExif) {
        return {
          ...row,
          data: stripExifMetadata(row.data),
        };
      }
    }
    return row;
  });

  return result;
}

function matchesFilter(row: DataRow, filter: QuickFilter): boolean {
  const d = row.data;
  const val = filter.value;

  switch (filter.type) {
    case 'time_after':
    case 'photo_after':
    case 'sms_after':
      return new Date(row.timestamp) >= new Date(val);

    case 'from_include': {
      const sender = String(d.author_email || d.author_name || '').toLowerCase();
      return sender.includes(val.toLowerCase());
    }

    case 'subject_include': {
      const title = String(d.title || '').toLowerCase();
      return title.includes(val.toLowerCase());
    }

    case 'exclude_sender': {
      const sender = String(d.author_email || d.author_name || '').toLowerCase();
      return !sender.includes(val.toLowerCase());
    }

    case 'exclude_keyword': {
      const title = String(d.title || '').toLowerCase();
      return !title.includes(val.toLowerCase());
    }

    case 'has_attachment': {
      const attachments = d.attachments as unknown[] | undefined;
      return Array.isArray(attachments) && attachments.length > 0;
    }

    case 'email_label': {
      const labels = Array.isArray(d.labels) ? d.labels : [d.label ?? d.folder ?? d.tag];
      return labels.some((l) => String(l ?? '').toLowerCase().includes(val.toLowerCase()));
    }

    case 'photo_album': {
      const album = String(d.album || d.folder || d.bucket || '').toLowerCase();
      return album.includes(val.toLowerCase());
    }

    case 'photo_keep_exif':
      return true;

    case 'sms_sender': {
      const sender = String(d.sender || d.from || d.address || '').toLowerCase();
      return sender.includes(val.toLowerCase());
    }

    case 'cal_calendar_id': {
      const calId = String(d.calendar_id || d.calendar || '').toLowerCase();
      return calId.includes(val.toLowerCase());
    }

    default:
      return true;
  }
}

import { API_BASE_URL } from './baseUrl';
import type { ContactInfo, PhotoMsg, SmsMsg } from '../device/deviceBridge.types';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  return res.json() as Promise<T>;
}

export interface Source {
  name: string;
  connected: boolean;
  enabled?: boolean;
  accountInfo?: { email?: string; login?: string };
}

export interface Filter {
  id: string;
  source: string;
  type: string;
  value: string;
  enabled: number | boolean;
}

export interface FilterType {
  label: string;
  needsValue: boolean;
  placeholder?: string;
  source?: string;
}

export interface StagingAction {
  action_id: string;
  action_type: string;
  source: string;
  status: 'pending' | 'approved' | 'rejected';
  purpose?: string;
  proposed_at?: string;
  createdAt?: string;
  action_data: string | Record<string, unknown>;
}

export interface GmailEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  snippet?: string;
  body: string;
  date: string;
  labels?: string[];
  hasAttachment?: boolean;
  attachments?: string[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  location?: string;
  body?: string;
}

export interface GithubRepo {
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  description?: string;
  is_org: boolean;
  enabled: number | boolean;
  permissions: string | string[];
}

export function getSources() {
  return json<{ sources: Source[] }>('/api/sources');
}

export function getFilters() {
  return json<{ filters: Filter[]; filterTypes: Record<string, FilterType> }>('/api/filters');
}

export function getStaging() {
  return json<{ actions: StagingAction[] }>('/api/staging');
}

export function getGmailPreview(limit = 20) {
  return json<{ ok: boolean; emails?: GmailEmail[]; error?: string }>(
    `/api/gmail/preview?limit=${limit}&t=${Date.now()}`
  );
}

export function getCalendarPreview(limit = 20) {
  return json<{ ok: boolean; events?: CalendarEvent[]; error?: string }>(
    `/api/calendar/preview?limit=${limit}&t=${Date.now()}`
  );
}

export function getGithubRepos() {
  return json<{ ok: boolean; repos?: GithubRepo[] }>('/api/github/repos');
}

export function saveGithubRepos(repos: Record<string, { enabled: boolean; permissions: string[] }>) {
  return json('/api/github/repos', {
    method: 'POST',
    body: JSON.stringify({ repos }),
  });
}

export function setFilter(input: { id?: string; source: string; type: string; value: string; enabled: boolean }) {
  return json('/api/filters', {
    method: 'POST',
    body: JSON.stringify({ ...input, enabled: input.enabled ? 1 : 0 }),
  });
}

export function editStagingAction(actionId: string, actionData: Record<string, unknown>) {
  return json(`/api/staging/${actionId}/edit`, {
    method: 'POST',
    body: JSON.stringify({ action_data: actionData }),
  });
}

export function resolveStagingAction(actionId: string, decision: 'approve' | 'reject') {
  return json(`/api/staging/${actionId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

export function disconnectSource(source: string) {
  return fetch(`${API_BASE_URL}/oauth/${source}/disconnect`, { method: 'POST' });
}

export function oauthStartUrl(source: string) {
  return `${API_BASE_URL}/oauth/${source}/start`;
}

export function manualSmsReply(from: string, body: string) {
  return json<{ ok: boolean; reply?: string; error?: string }>('/api/sms/manual-reply', {
    method: 'POST',
    body: JSON.stringify({ from, body }),
  });
}

export function getPendingSmsReplies() {
  return json<{ ok: boolean; replies?: { id: string; to: string; body: string }[] }>('/api/sms/pending-replies');
}

export function deletePendingSmsReply(id: string) {
  return fetch(`${API_BASE_URL}/api/sms/pending-replies/${id}`, { method: 'DELETE' });
}

export function autoReplySms(from: string, body: string, history: SmsMsg[]) {
  return json<{ ok: boolean; enabled?: boolean; reply?: string }>('/sms/auto-reply', {
    method: 'POST',
    body: JSON.stringify({ from, body, history }),
  });
}

export function syncPhotos(photos: PhotoMsg[]) {
  return fetch(`${API_BASE_URL}/api/photos/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos }),
  });
}

export function syncContacts(contacts: ContactInfo[]) {
  return fetch(`${API_BASE_URL}/device/contacts-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts }),
  });
}

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

export function getAuthStatus() {
  return json<{ authenticated: boolean; hasUsers: boolean }>('/api/auth/status');
}

// Single-device auto-login (no credentials — server only binds to 127.0.0.1).
// The legacy WebView frontend called this on every load before fetching any
// data; the native app must do the same or every /api/* call 401s silently.
export function deviceLogin() {
  return json<{ ok: boolean }>('/auth/device-login', { method: 'POST' });
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

// --- Memories ---

export interface MemoryRow {
  id: string;
  content: string;
  created_at: string;
}

export function getMemories() {
  return json<{ ok: boolean; memories: MemoryRow[] }>('/api/memories');
}

export function createMemory(content: string) {
  return json<{ ok: boolean; id?: string; error?: string }>('/api/memories', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function updateMemory(id: string, content: string) {
  return json<{ ok: boolean; error?: string }>(`/api/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export function deleteMemory(id: string) {
  return json<{ ok: boolean }>(`/api/memories/${id}`, { method: 'DELETE' });
}

// --- AI / chat settings ---

export function getChatStatus() {
  return json<{ ok: boolean; configured: boolean; provider: string | null; model: string | null }>('/api/chat/status');
}

export function saveAiSettings(input: { api_key: string; provider?: string; model?: string; base_url?: string }) {
  return json<{ ok: boolean; error?: string }>('/api/settings/ai-key', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getAutoReplySettings() {
  return json<{ ok: boolean; enabled: boolean; maxToolRounds: number }>('/api/settings/auto-reply');
}

export function saveAutoReplySettings(input: { enabled?: boolean; maxToolRounds?: number }) {
  return json<{ ok: boolean; enabled: boolean; maxToolRounds: number }>('/api/settings/auto-reply', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function testAutoReply(from: string, body: string) {
  return json<{ ok: boolean; enabled?: boolean; reply?: string; skipped?: boolean; reason?: string; error?: string }>(
    '/sms/auto-reply',
    { method: 'POST', body: JSON.stringify({ from, body }) }
  );
}

// --- Onboarding ---

export function getOnboardingStatus() {
  return json<{ ok: boolean; completed: boolean }>('/api/settings/onboarding');
}

export function setOnboardingCompleted(completed: boolean) {
  return json<{ ok: boolean; completed: boolean }>('/api/settings/onboarding', {
    method: 'POST',
    body: JSON.stringify({ completed }),
  });
}

// --- Audit log ---

export interface AuditEntry {
  timestamp: string;
  event: string;
  source: string | null;
  details: string;
}

export function getAuditLog(limit = 50) {
  return json<{ ok: boolean; entries: AuditEntry[] }>(`/api/audit?limit=${limit}`);
}

// --- Skills ---
// Note: skills also have a logic_tree/current_view (LOGICAL vs SUMMARIZED natural-language
// view) field pair with backend translate endpoints, but no UI in the legacy app ever
// exposed a way to reach that view — it's dead code there. Not ported; only the reachable
// name/triggers/allowed_sources/instructions editor is.

export interface SkillRow {
  id: string;
  name: string;
  instructions: string;
  trigger_event: string;
  enabled: number;
  current_view: string;
  logic_tree: string;
  summary: string;
  primitive_type: string;
  label_tag: string | null;
  allowed_sources: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SkillInput {
  name?: string;
  instructions?: string;
  trigger_events?: string[];
  current_view?: string;
  logic_tree?: string;
  summary?: string;
  primitive_type?: string;
  label_tag?: string | null;
  allowed_sources?: string | null;
}

export function getSkills() {
  return json<{ ok: boolean; skills: SkillRow[] }>('/api/skills');
}

export function createSkill(input: SkillInput) {
  return json<{ ok: boolean; id?: string; error?: string }>('/api/skills', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateSkill(id: string, input: SkillInput & { enabled?: boolean }) {
  return json<{ ok: boolean }>(`/api/skills/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteSkill(id: string) {
  return json<{ ok: boolean }>(`/api/skills/${id}`, { method: 'DELETE' });
}

// --- Chat ---

export interface ToolOutput {
  name: string;
  input: Record<string, unknown>;
  output: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolOutputs?: ToolOutput[];
}

export function sendChatMessage(messages: ChatMessage[], sms: SmsMsg[] | null) {
  return json<{ ok: boolean; reply?: string; toolOutputs?: ToolOutput[]; stagedActionIds?: string[]; error?: string }>(
    '/api/chat',
    { method: 'POST', body: JSON.stringify({ messages, sms }) }
  );
}

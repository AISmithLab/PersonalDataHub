import { API_BASE_URL } from './baseUrl';
import type { ContactInfo, PhotoMsg, SmsMsg } from '../device/deviceBridge.types';

// On the phone the app has no sign-in screen. The native shell gets a secret from
// its own bundled server and passes it here; every request then carries it and the
// server treats the caller as the owner. On the web this stays unset and the
// session cookie from signing in is used instead.
let deviceSecret: string | null = null;

export function setDeviceSecret(secret: string | null) {
  deviceSecret = secret;
}

/** fetch against the hub, with the owner credential attached. Use this for every hub call. */
export function hubFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers as Record<string, string> | undefined),
    ...(deviceSecret ? { 'X-PDH-Device-Secret': deviceSecret } : {}),
  };
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

// Called when the hub says we are no longer the owner (session expired or ended
// elsewhere), so the app can return to the sign-in screen instead of showing an
// empty hub.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await hubFetch(path, init);
  if (res.status === 401 && !path.startsWith('/web/auth/')) onUnauthorized?.();
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
  return json<{ authenticated: boolean; hasUsers: boolean }>('/web/auth/status');
}

export function signIn(email: string, password: string, createAccount: boolean) {
  return json<{ ok: boolean; error?: string }>(createAccount ? '/web/auth/signup' : '/web/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function signOut() {
  return json<{ ok: boolean }>('/web/auth/logout', { method: 'POST' });
}

export function getSources() {
  return json<{ sources: Source[] }>('/web/sources');
}

export function getFilters() {
  return json<{ filters: Filter[]; filterTypes: Record<string, FilterType> }>('/web/filters');
}

export function getStaging() {
  return json<{ actions: StagingAction[] }>('/web/staging');
}

export function getGmailPreview(limit = 20) {
  return json<{ ok: boolean; emails?: GmailEmail[]; error?: string }>(
    `/web/gmail/preview?limit=${limit}&t=${Date.now()}`
  );
}

export function getCalendarPreview(limit = 20) {
  return json<{ ok: boolean; events?: CalendarEvent[]; error?: string }>(
    `/web/calendar/preview?limit=${limit}&t=${Date.now()}`
  );
}

export function getGithubRepos() {
  return json<{ ok: boolean; repos?: GithubRepo[] }>('/web/github/repos');
}

export function saveGithubRepos(repos: Record<string, { enabled: boolean; permissions: string[] }>) {
  return json('/web/github/repos', {
    method: 'POST',
    body: JSON.stringify({ repos }),
  });
}

export function setFilter(input: { id?: string; source: string; type: string; value: string; enabled: boolean }) {
  return json('/web/filters', {
    method: 'POST',
    body: JSON.stringify({ ...input, enabled: input.enabled ? 1 : 0 }),
  });
}

export function editStagingAction(actionId: string, actionData: Record<string, unknown>) {
  return json(`/web/staging/${actionId}/edit`, {
    method: 'POST',
    body: JSON.stringify({ action_data: actionData }),
  });
}

export function resolveStagingAction(actionId: string, decision: 'approve' | 'reject') {
  return json(`/web/staging/${actionId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

export function disconnectSource(source: string) {
  return hubFetch(`/web/oauth/${source}/disconnect`, { method: 'POST' });
}

/** Asks the hub for the provider's sign-in URL. The caller opens it (see startOAuth). */
export function getOAuthStartUrl(source: string) {
  return json<{ ok: boolean; url?: string; error?: string }>(`/web/oauth/${source}/start`, { method: 'POST' });
}

export function manualSmsReply(from: string, body: string) {
  return json<{ ok: boolean; reply?: string; error?: string }>('/web/device/sms/manual-reply', {
    method: 'POST',
    body: JSON.stringify({ from, body }),
  });
}

export function getPendingSmsReplies() {
  return json<{ ok: boolean; replies?: { id: string; to: string; body: string }[] }>('/web/device/sms/pending-replies');
}

export function deletePendingSmsReply(id: string) {
  return hubFetch(`/web/device/sms/pending-replies/${id}`, { method: 'DELETE' });
}

export function autoReplySms(from: string, body: string, history: SmsMsg[]) {
  return json<{ ok: boolean; enabled?: boolean; reply?: string }>('/web/device/sms/auto-reply', {
    method: 'POST',
    body: JSON.stringify({ from, body, history }),
  });
}

export function syncPhotos(photos: PhotoMsg[]) {
  return hubFetch('/web/device/photos', {
    method: 'POST',
    body: JSON.stringify({ photos }),
  });
}

export function syncContacts(contacts: ContactInfo[]) {
  return hubFetch('/web/device/contacts', {
    method: 'POST',
    body: JSON.stringify({ contacts }),
  });
}

// --- Agents ---
// Agents register with a one-time join link the owner makes here. The owner never
// sees a token: the hub hands it to the agent when the agent redeems the link.

export interface Agent {
  id: string;
  name: string;
  /** e.g. ["pull:gmail", "propose:gmail"] */
  permissions: string[];
  created_at: string;
  last_used_at: string | null;
}

export function getAgents() {
  return json<{ ok: boolean; agents: Agent[]; sources: string[] }>('/web/agents');
}

export function createAgentJoinLink(permissions: string[]) {
  return json<{ ok: boolean; url?: string; expires_at?: string; error?: string }>('/web/agents/join-links', {
    method: 'POST',
    body: JSON.stringify({ permissions }),
  });
}

export function setAgentPermissions(id: string, permissions: string[]) {
  return json<{ ok: boolean; error?: string }>(`/web/agents/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ permissions }),
  });
}

export function revokeAgent(id: string) {
  return json<{ ok: boolean; error?: string }>(`/web/agents/${id}`, { method: 'DELETE' });
}

// --- Memories ---

export interface MemoryRow {
  id: string;
  content: string;
  created_at: string;
}

export function getMemories() {
  return json<{ ok: boolean; memories: MemoryRow[] }>('/web/memories');
}

export function createMemory(content: string) {
  return json<{ ok: boolean; id?: string; error?: string }>('/web/memories', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function updateMemory(id: string, content: string) {
  return json<{ ok: boolean; error?: string }>(`/web/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export function deleteMemory(id: string) {
  return json<{ ok: boolean }>(`/web/memories/${id}`, { method: 'DELETE' });
}

// --- AI / chat settings ---

export function getChatStatus() {
  return json<{ ok: boolean; configured: boolean; provider: string | null; model: string | null }>('/web/chat/status');
}

export function saveAiSettings(input: { api_key: string; provider?: string; model?: string }) {
  return json<{ ok: boolean; error?: string }>('/web/settings/ai-key', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** The provider's chat models for the dropdown: with the key being typed, or the saved key. */
export function getAiModels(provider: string, apiKey?: string) {
  return json<{ ok: boolean; models?: string[]; error?: string }>('/web/settings/ai-models', {
    method: 'POST',
    body: JSON.stringify({ provider, api_key: apiKey || undefined }),
  });
}

export function getAutoReplySettings() {
  return json<{ ok: boolean; enabled: boolean; maxToolRounds: number }>('/web/settings/auto-reply');
}

export function saveAutoReplySettings(input: { enabled?: boolean; maxToolRounds?: number }) {
  return json<{ ok: boolean; enabled: boolean; maxToolRounds: number }>('/web/settings/auto-reply', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function testAutoReply(from: string, body: string) {
  return json<{ ok: boolean; enabled?: boolean; reply?: string; skipped?: boolean; reason?: string; error?: string }>(
    '/web/device/sms/auto-reply',
    { method: 'POST', body: JSON.stringify({ from, body }) }
  );
}

// --- Onboarding ---

export function getOnboardingStatus() {
  return json<{ ok: boolean; completed: boolean }>('/web/settings/onboarding');
}

export function setOnboardingCompleted(completed: boolean) {
  return json<{ ok: boolean; completed: boolean }>('/web/settings/onboarding', {
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
  return json<{ ok: boolean; entries: AuditEntry[] }>(`/web/audit?limit=${limit}`);
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
  return json<{ ok: boolean; skills: SkillRow[] }>('/web/skills');
}

export function createSkill(input: SkillInput) {
  return json<{ ok: boolean; id?: string; error?: string }>('/web/skills', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateSkill(id: string, input: SkillInput & { enabled?: boolean }) {
  return json<{ ok: boolean }>(`/web/skills/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteSkill(id: string) {
  return json<{ ok: boolean }>(`/web/skills/${id}`, { method: 'DELETE' });
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
    '/web/chat',
    { method: 'POST', body: JSON.stringify({ messages, sms }) }
  );
}

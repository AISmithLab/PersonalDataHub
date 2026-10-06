import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client';
import type {
  CalendarEvent,
  ChatMessage,
  Filter,
  FilterType,
  GithubRepo,
  GmailEmail,
  MemoryRow,
  SkillInput,
  SkillRow,
  Source,
  StagingAction,
} from '../api/client';
import { deviceBridge } from '../device/deviceBridge';
import type { PhotoMsg, SmsMsg } from '../device/deviceBridge.types';

const ONBOARDING_STEPS = ['intro', 'apikey', 'sms', 'chat', 'memory'] as const;
type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

interface SmsContextMenu {
  address: string;
  body: string;
  status: 'thinking' | 'sending' | 'sent' | 'error' | null;
  reply?: string;
  error?: string;
}

export function useAppState() {
  const [sources, setSources] = useState<Source[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [filterTypes, setFilterTypes] = useState<Record<string, FilterType>>({});
  const [staging, setStaging] = useState<StagingAction[]>([]);

  const [emails, setEmails] = useState<GmailEmail[] | null>(null);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);

  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>({});

  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [editingAction, setEditingAction] = useState<string | null>(null);

  const [sms, setSms] = useState<SmsMsg[] | null>(null);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsBox, setSmsBox] = useState<'inbox' | 'sent' | 'all'>('inbox');
  const [smsAutoReplying, setSmsAutoReplying] = useState(false);
  const [smsContextMenu, setSmsContextMenu] = useState<SmsContextMenu | null>(null);

  const [photos, setPhotos] = useState<PhotoMsg[] | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [contactsLoading, setContactsLoading] = useState(false);

  const [memories, setMemories] = useState<MemoryRow[] | null>(null);
  const [memoriesLoading, setMemoriesLoading] = useState(false);

  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);

  const [aiProvider, setAiProvider] = useState('anthropic');
  const [aiAvailable, setAiAvailable] = useState(false);
  const [configuredModel, setConfiguredModel] = useState<string | null>(null);

  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplyMaxToolRounds, setAutoReplyMaxToolRounds] = useState(3);
  const [autoReplyTestResult, setAutoReplyTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [autoReplyTestLoading, setAutoReplyTestLoading] = useState(false);

  const [auditLog, setAuditLog] = useState<api.AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [onboardingActive, setOnboardingActive] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('intro');

  const gmailSource = sources.find((s) => s.name === 'gmail');
  const gmailConnected = !!gmailSource?.connected;
  const calendarSource = sources.find((s) => s.name === 'google_calendar');
  const calendarConnected = !!calendarSource?.connected;
  const githubSource = sources.find((s) => s.name === 'github');
  const githubConnected = !!githubSource?.connected;

  const refreshCore = useCallback(async () => {
    try {
      const [sourcesRes, filtersRes, stagingRes] = await Promise.all([
        api.getSources(),
        api.getFilters(),
        api.getStaging(),
      ]);
      setSources(sourcesRes.sources || []);
      setFilters(filtersRes.filters || []);
      setFilterTypes(filtersRes.filterTypes || {});
      setStaging(stagingRes.actions || []);
    } catch (err) {
      console.warn('[useAppState] Failed to fetch backend data:', err);
    }
  }, []);

  const loadEmails = useCallback(async () => {
    setEmailsLoading(true);
    setEmailsError(null);
    try {
      const data = await api.getGmailPreview(20);
      if (!data.ok) {
        setEmailsError(data.error || 'Failed to load emails');
        setEmails(null);
      } else {
        setEmails(data.emails || []);
      }
    } catch (err) {
      setEmailsError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const data = await api.getCalendarPreview(20);
      if (!data.ok) {
        setEventsError(data.error || 'Failed to load events');
        setEvents(null);
      } else {
        setEvents(data.events || []);
      }
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const loadRepos = useCallback(async () => {
    setReposLoading(true);
    try {
      const data = await api.getGithubRepos();
      if (data.ok) setRepos(data.repos || []);
    } catch (err) {
      console.warn('[useAppState] Failed to fetch GitHub repos:', err);
    } finally {
      setReposLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshCore();
  }, [refreshCore]);

  useEffect(() => {
    if (gmailConnected && emails === null && !emailsLoading) {
      loadEmails();
    }
  }, [gmailConnected, emails, emailsLoading, loadEmails]);

  useEffect(() => {
    if (calendarConnected && events === null && !eventsLoading) {
      loadEvents();
    }
  }, [calendarConnected, events, eventsLoading, loadEvents]);

  useEffect(() => {
    if (githubConnected && repos === null && !reposLoading) {
      loadRepos();
    }
  }, [githubConnected, repos, reposLoading, loadRepos]);

  const refreshEmails = useCallback(() => {
    setEmails(null);
    setEmailsError(null);
    setEmailsLoading(false);
  }, []);

  const refreshEvents = useCallback(() => {
    setEvents(null);
    setEventsError(null);
    setEventsLoading(false);
  }, []);

  const toggleExpandedRepo = useCallback((fullName: string) => {
    setExpandedRepos((cur) => ({ ...cur, [fullName]: !cur[fullName] }));
  }, []);

  const saveRepos = useCallback((updated: GithubRepo[]) => {
    setRepos(updated);
    const payload: Record<string, { enabled: boolean; permissions: string[] }> = {};
    updated.forEach((r) => {
      payload[r.full_name] = {
        enabled: !!r.enabled,
        permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions,
      };
    });
    api.saveGithubRepos(payload).catch((err) => console.warn('[useAppState] Failed to save repos:', err));
  }, []);

  const toggleRepoEnabled = useCallback(
    (fullName: string, checked: boolean) => {
      if (!repos) return;
      saveRepos(
        repos.map((r) =>
          r.full_name === fullName
            ? {
                ...r,
                enabled: checked ? 1 : 0,
                permissions: checked ? ['contents:read', 'issues:read', 'pull_requests:read'] : [],
              }
            : r
        )
      );
    },
    [repos, saveRepos]
  );

  const toggleRepoPerm = useCallback(
    (fullName: string, perm: string, checked: boolean) => {
      if (!repos) return;
      saveRepos(
        repos.map((r) => {
          if (r.full_name !== fullName) return r;
          const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : [...r.permissions];
          const next = checked ? [...new Set([...perms, perm])] : perms.filter((p: string) => p !== perm);
          return { ...r, permissions: next };
        })
      );
    },
    [repos, saveRepos]
  );

  const selectAllOwner = useCallback(
    (owner: string, val: boolean) => {
      if (!repos) return;
      saveRepos(
        repos.map((r) =>
          r.owner === owner
            ? {
                ...r,
                enabled: val ? 1 : 0,
                permissions: val ? ['contents:read', 'issues:read', 'pull_requests:read'] : [],
              }
            : r
        )
      );
    },
    [repos, saveRepos]
  );

  const applyBulkPerms = useCallback(
    (perms: string[]) => {
      if (!repos) return;
      saveRepos(repos.map((r) => (r.enabled ? { ...r, permissions: perms } : r)));
    },
    [repos, saveRepos]
  );

  const toggleEmailExpand = useCallback((emailId: string) => {
    setExpandedEmail((cur) => (cur === emailId ? null : emailId));
  }, []);

  const toggleEditAction = useCallback((actionId: string) => {
    setEditingAction((cur) => (cur === actionId ? null : actionId));
  }, []);

  const toggleFilter = useCallback(
    async (source: string, type: string, enabled: boolean, existingId: string, value: string) => {
      await api.setFilter({ id: existingId || undefined, source, type, value, enabled });
      if (source === 'gmail') setEmails(null);
      if (source === 'google_calendar') setEvents(null);
      await refreshCore();
    },
    [refreshCore]
  );

  const updateFilterValue = useCallback(
    async (source: string, type: string, value: string, existingId: string) => {
      const existing = filters.find((f) => f.type === type && f.source === source);
      const enabled = !!existing?.enabled;
      await api.setFilter({ id: existingId || undefined, source, type, value, enabled });
      if (enabled && source === 'gmail') setEmails(null);
      if (enabled && source === 'google_calendar') setEvents(null);
      await refreshCore();
    },
    [filters, refreshCore]
  );

  const resolveAction = useCallback(
    async (actionId: string, decision: 'approve' | 'reject') => {
      await api.resolveStagingAction(actionId, decision);
      await refreshCore();
    },
    [refreshCore]
  );

  const approveAction = useCallback(
    async (actionId: string, edits?: Record<string, unknown>) => {
      if (edits) await api.editStagingAction(actionId, edits);
      await resolveAction(actionId, 'approve');
    },
    [resolveAction]
  );

  const sendAction = useCallback(
    async (actionId: string, edits: Record<string, unknown>) => {
      await api.editStagingAction(actionId, { ...edits, send: true });
      await resolveAction(actionId, 'approve');
    },
    [resolveAction]
  );

  const loadContacts = useCallback(
    async (force = false) => {
      if (!force && Object.keys(contacts).length > 0) return;
      if (contactsLoading) return;
      setContactsLoading(true);
      try {
        const list = await deviceBridge.getContacts();
        if (list.length) {
          setContacts((cur) => {
            const next = { ...cur };
            list.forEach((c) => {
              next[c.number] = c.name;
              const stripped = c.number.replace(/\D/g, '');
              if (stripped.length >= 7) next[stripped] = c.name;
            });
            return next;
          });
        }
      } catch {
        // non-fatal — SMS list still renders with raw phone numbers
      } finally {
        setContactsLoading(false);
      }
    },
    [contacts, contactsLoading]
  );

  const formatContact = useCallback(
    (addr: string | undefined | null) => {
      if (!addr) return addr ?? '';
      let name = contacts[addr];
      if (!name) {
        const stripped = addr.replace(/\D/g, '');
        if (stripped.length >= 7) name = contacts[stripped];
      }
      return name ? `${name} (${addr})` : addr;
    },
    [contacts]
  );

  const loadSmsMessages = useCallback(
    async (force = false) => {
      if (!force && sms !== null) return;
      if (!force && smsError) return;
      if (smsLoading) return;
      setSmsLoading(true);
      setSmsError(null);
      try {
        const messages = await deviceBridge.getSmsMessages(smsBox, 100);
        setSms(messages);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const lower = msg.toLowerCase();
        setSmsError(lower.includes('denied') || lower.includes('permission') || lower === 'not_android' ? msg : msg);
      } finally {
        setSmsLoading(false);
      }
    },
    [sms, smsError, smsLoading, smsBox]
  );

  const changeSmsBox = useCallback((box: 'inbox' | 'sent' | 'all') => {
    setSmsBox(box);
    setSms(null);
    setSmsError(null);
  }, []);

  const showSmsContextMenu = useCallback((address: string, body: string) => {
    setSmsContextMenu({ address, body, status: null });
  }, []);

  const hideSmsContextMenu = useCallback(() => {
    setSmsContextMenu(null);
    setSmsAutoReplying(false);
  }, []);

  const manualAutoReply = useCallback(async () => {
    const cm = smsContextMenu;
    if (!cm || smsAutoReplying) return;
    setSmsAutoReplying(true);
    setSmsContextMenu({ ...cm, status: 'thinking' });
    try {
      const d = await api.manualSmsReply(cm.address, cm.body);
      if (!d.ok || !d.reply) {
        setSmsContextMenu({ ...cm, status: 'error', error: d.error || 'No reply generated' });
        setSmsAutoReplying(false);
        return;
      }
      setSmsContextMenu({ ...cm, status: 'sending', reply: d.reply });
      try {
        await deviceBridge.sendSms(cm.address, d.reply);
        setSmsContextMenu((cur) => (cur ? { ...cur, status: 'sent' } : cur));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSmsContextMenu((cur) => (cur ? { ...cur, status: 'error', error: `Send failed: ${msg}` } : cur));
      } finally {
        setSmsAutoReplying(false);
      }
    } catch (err) {
      setSmsContextMenu({ ...cm, status: 'error', error: err instanceof Error ? err.message : 'Network error' });
      setSmsAutoReplying(false);
    }
  }, [smsContextMenu, smsAutoReplying]);

  const loadPhotos = useCallback(
    async (force = false) => {
      const hasRealPhotos = !!photos && photos.length > 0 && photos[0].id !== 'img-1';
      if (!force && hasRealPhotos) return;
      try {
        const list = await deviceBridge.getPhotos(20);
        setPhotosError(null);
        setPhotos(list);
        if (list.length) api.syncPhotos(list).catch(() => {});
      } catch (err) {
        setPhotosError(err instanceof Error ? err.message : String(err));
      }
    },
    [photos]
  );

  const loadMemories = useCallback(
    async (force = false) => {
      if (!force && memories !== null) return;
      if (memoriesLoading) return;
      setMemoriesLoading(true);
      try {
        const d = await api.getMemories();
        if (d.ok) setMemories(d.memories);
      } catch (err) {
        console.warn('[useAppState] Failed to load memories:', err);
      } finally {
        setMemoriesLoading(false);
      }
    },
    [memories, memoriesLoading]
  );

  const addMemory = useCallback(async (content: string) => {
    const d = await api.createMemory(content);
    if (d.ok) {
      const refreshed = await api.getMemories();
      if (refreshed.ok) setMemories(refreshed.memories);
    }
    return d;
  }, []);

  const editMemory = useCallback(async (id: string, content: string) => {
    const d = await api.updateMemory(id, content);
    if (d.ok) {
      setMemories((cur) => (cur ? cur.map((m) => (m.id === id ? { ...m, content } : m)) : cur));
    }
    return d;
  }, []);

  const deleteMemory = useCallback(async (id: string) => {
    await api.deleteMemory(id);
    setMemories((cur) => (cur ? cur.filter((m) => m.id !== id) : cur));
  }, []);

  const loadSkills = useCallback(
    async (force = false) => {
      if (!force && skills !== null) return;
      if (skillsLoading) return;
      setSkillsLoading(true);
      try {
        const d = await api.getSkills();
        if (d.ok) setSkills(d.skills);
      } catch (err) {
        console.warn('[useAppState] Failed to load skills:', err);
      } finally {
        setSkillsLoading(false);
      }
    },
    [skills, skillsLoading]
  );

  const refreshSkills = useCallback(async () => {
    const d = await api.getSkills();
    if (d.ok) setSkills(d.skills);
  }, []);

  const createSkill = useCallback(
    async (input: SkillInput) => {
      const d = await api.createSkill(input);
      if (d.ok) await refreshSkills();
      return d;
    },
    [refreshSkills]
  );

  const saveSkill = useCallback(
    async (id: string, input: SkillInput) => {
      const d = await api.updateSkill(id, input);
      if (d.ok) await refreshSkills();
      return d;
    },
    [refreshSkills]
  );

  const toggleSkillEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setSkills((cur) => (cur ? cur.map((s) => (s.id === id ? { ...s, enabled: enabled ? 1 : 0 } : s)) : cur));
      await api.updateSkill(id, { enabled });
    },
    []
  );

  const deleteSkillById = useCallback(
    async (id: string) => {
      await api.deleteSkill(id);
      setSkills((cur) => (cur ? cur.filter((s) => s.id !== id) : cur));
    },
    []
  );

  const loadAiStatus = useCallback(async () => {
    try {
      const d = await api.getChatStatus();
      if (d.ok) {
        setAiAvailable(d.configured);
        if (d.provider) setAiProvider(d.provider);
        if (d.model) setConfiguredModel(d.model);
      }
    } catch {
      // non-fatal
    }
  }, []);

  const saveAiSettings = useCallback(
    async (input: { api_key: string; provider?: string; model?: string; base_url?: string }) => {
      const d = await api.saveAiSettings(input);
      if (d.ok) {
        if (input.provider) setAiProvider(input.provider);
        await loadAiStatus();
      }
      return d;
    },
    [loadAiStatus]
  );

  const loadAutoReplySettings = useCallback(async () => {
    try {
      const d = await api.getAutoReplySettings();
      if (d.ok) {
        setAutoReplyEnabled(d.enabled);
        setAutoReplyMaxToolRounds(d.maxToolRounds);
      }
    } catch {
      // non-fatal
    }
  }, []);

  const saveAutoReplyEnabled = useCallback(async (enabled: boolean) => {
    const d = await api.saveAutoReplySettings({ enabled });
    if (d.ok) setAutoReplyEnabled(d.enabled);
    return d;
  }, []);

  const saveMaxToolRounds = useCallback(async (maxToolRounds: number) => {
    const d = await api.saveAutoReplySettings({ maxToolRounds });
    if (d.ok) setAutoReplyMaxToolRounds(d.maxToolRounds);
    return d;
  }, []);

  const runAutoReplyTest = useCallback(async () => {
    setAutoReplyTestLoading(true);
    setAutoReplyTestResult(null);
    try {
      const d = await api.testAutoReply('+15555550100', 'Hey, are we still on for lunch tomorrow?');
      if (!autoReplyEnabled) {
        setAutoReplyTestResult({ ok: false, msg: 'Toggle is OFF — enable it above first' });
      } else if (!d.ok) {
        setAutoReplyTestResult({ ok: false, msg: d.error || 'Server error' });
      } else if (d.skipped) {
        setAutoReplyTestResult({ ok: false, msg: `Skipped: ${d.reason || 'unknown reason'}` });
      } else if (d.reply) {
        setAutoReplyTestResult({ ok: true, msg: `AI replied: "${d.reply}"` });
      } else {
        setAutoReplyTestResult({ ok: false, msg: 'No reply generated' });
      }
    } catch (err) {
      setAutoReplyTestResult({ ok: false, msg: `Network error: ${err instanceof Error ? err.message : err}` });
    } finally {
      setAutoReplyTestLoading(false);
    }
  }, [autoReplyEnabled]);

  const loadAuditLog = useCallback(async (force = false) => {
    if (!force && auditLog.length > 0) return;
    if (auditLoading) return;
    setAuditLoading(true);
    try {
      const d = await api.getAuditLog();
      if (d.ok) setAuditLog(d.entries);
    } catch (err) {
      console.warn('[useAppState] Failed to load audit log:', err);
    } finally {
      setAuditLoading(false);
    }
  }, [auditLog.length, auditLoading]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || chatLoading) return;
      const nextMessages = [...chatMessages, { role: 'user' as const, content: trimmed }];
      setChatMessages(nextMessages);
      setChatLoading(true);
      setChatError(null);
      const smsPayload = sms
        ? sms.map((m) => ({ ...m, address: formatContact(m.address) }))
        : null;
      try {
        const d = await api.sendChatMessage(nextMessages.slice(-50), smsPayload);
        if (d.ok) {
          setChatMessages((cur) => [...cur, { role: 'assistant', content: d.reply ?? '', toolOutputs: d.toolOutputs ?? [] }]);
          if (d.stagedActionIds && d.stagedActionIds.length) await refreshCore();
        } else {
          setChatError(d.error || 'Unknown error');
        }
      } catch (err) {
        setChatError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setChatLoading(false);
      }
    },
    [chatMessages, chatLoading, sms, formatContact, refreshCore]
  );

  const clearChat = useCallback(() => {
    setChatMessages([]);
    setChatError(null);
  }, []);

  const sendStagedSms = useCallback(
    async (actionId: string, to: string, body: string) => {
      try {
        await deviceBridge.sendSms(to, body);
        await resolveAction(actionId, 'approve');
      } catch (err) {
        console.warn('[useAppState] Failed to send staged SMS:', err);
      }
    },
    [resolveAction]
  );

  const checkOnboarding = useCallback(async () => {
    try {
      const d = await api.getOnboardingStatus();
      if (d.ok && !d.completed) {
        setOnboardingStep('intro');
        setOnboardingActive(true);
      }
    } catch {
      // non-fatal
    }
  }, []);

  const replayOnboarding = useCallback(() => {
    setOnboardingStep('intro');
    setOnboardingActive(true);
  }, []);

  const onboardingNext = useCallback(() => {
    setOnboardingStep((cur) => {
      const idx = ONBOARDING_STEPS.indexOf(cur);
      return ONBOARDING_STEPS[Math.min(idx + 1, ONBOARDING_STEPS.length - 1)];
    });
  }, []);

  const onboardingBack = useCallback(() => {
    setOnboardingStep((cur) => {
      const idx = ONBOARDING_STEPS.indexOf(cur);
      return ONBOARDING_STEPS[Math.max(idx - 1, 0)];
    });
  }, []);

  const completeOnboarding = useCallback(async () => {
    setOnboardingActive(false);
    api.setOnboardingCompleted(true).catch(() => {});
  }, []);

  useEffect(() => {
    // The native app has no login screen — mirrors main.js's legacy
    // "check auth on load, auto-create a device session if needed" sequence.
    // Every /api/* route is gated by a session cookie middleware, so skipping
    // this means every data fetch below 401s silently (empty-looking state,
    // easy to miss — e.g. default-seeded skills just never show up).
    async function bootstrap() {
      try {
        const status = await api.getAuthStatus();
        if (!status.authenticated) {
          await api.deviceLogin();
        }
      } catch (err) {
        console.warn('[useAppState] Auth bootstrap failed:', err);
      }
      refreshAll();
      loadAiStatus();
      loadAutoReplySettings();
      checkOnboarding();
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnectSource = useCallback(
    async (source: string) => {
      await api.disconnectSource(source);
      if (source === 'gmail') {
        setEmails(null);
        setEmailsLoading(false);
      }
      if (source === 'google_calendar') {
        setEvents(null);
        setEventsLoading(false);
      }
      if (source === 'github') {
        setRepos(null);
        setReposLoading(false);
      }
      await refreshCore();
    },
    [refreshCore]
  );

  return {
    sources,
    filters,
    filterTypes,
    staging,
    emails,
    emailsLoading,
    emailsError,
    events,
    eventsLoading,
    eventsError,
    repos,
    reposLoading,
    expandedRepos,
    expandedEmail,
    editingAction,
    refreshAll,
    refreshEmails,
    refreshEvents,
    refreshRepos: loadRepos,
    toggleEmailExpand,
    toggleEditAction,
    toggleExpandedRepo,
    toggleFilter,
    updateFilterValue,
    resolveAction,
    approveAction,
    sendAction,
    disconnectSource,
    toggleRepoEnabled,
    toggleRepoPerm,
    selectAllOwner,
    applyBulkPerms,
    sms,
    smsLoading,
    smsError,
    smsBox,
    smsAutoReplying,
    smsContextMenu,
    loadSmsMessages,
    changeSmsBox,
    showSmsContextMenu,
    hideSmsContextMenu,
    manualAutoReply,
    photos,
    photosError,
    loadPhotos,
    contacts,
    loadContacts,
    formatContact,
    memories,
    memoriesLoading,
    loadMemories,
    addMemory,
    editMemory,
    deleteMemory,
    skills,
    skillsLoading,
    loadSkills,
    createSkill,
    saveSkill,
    toggleSkillEnabled,
    deleteSkill: deleteSkillById,
    aiProvider,
    aiAvailable,
    configuredModel,
    saveAiSettings,
    autoReplyEnabled,
    autoReplyMaxToolRounds,
    autoReplyTestResult,
    autoReplyTestLoading,
    saveAutoReplyEnabled,
    saveMaxToolRounds,
    runAutoReplyTest,
    auditLog,
    auditLoading,
    loadAuditLog,
    chatMessages,
    chatLoading,
    chatError,
    sendMessage,
    clearChat,
    sendStagedSms,
    onboardingActive,
    onboardingStep,
    replayOnboarding,
    onboardingNext,
    onboardingBack,
    completeOnboarding,
  };
}

export type AppState = ReturnType<typeof useAppState>;

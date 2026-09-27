import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client';
import type { CalendarEvent, Filter, FilterType, GithubRepo, GmailEmail, Source, StagingAction } from '../api/client';
import { deviceBridge } from '../device/deviceBridge';
import type { PhotoMsg, SmsMsg } from '../device/deviceBridge.types';

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
    refreshAll();
  }, [refreshAll]);

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
  };
}

export type AppState = ReturnType<typeof useAppState>;

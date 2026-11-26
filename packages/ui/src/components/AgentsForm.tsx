import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import * as api from '../api/client';
import type { AppState } from '../hooks/useAppState';

const SOURCE_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  google_calendar: 'Calendar',
  github: 'GitHub',
  photo: 'Photos',
};
const FALLBACK_SOURCES = ['gmail', 'google_calendar', 'github', 'photo'];

// wordBreak is a web-only style; React Native ignores it.
const BREAK_ANYWHERE = { fontFamily: 'monospace', wordBreak: 'break-all' } as object;

type Panel = { kind: 'closed' } | { kind: 'add' } | { kind: 'link'; url: string; expiresAt: string } | { kind: 'edit'; agent: api.Agent };

/**
 * Settings → Agents. An agent registers with a one-time join link made here and
 * can then read data, and act through outgoing pipes, within what was ticked for it. No
 * secret is ever shown: the hub gives the token to the agent when it joins.
 */
export function AgentsForm({ state }: { state: AppState }) {
  const [agents, setAgents] = useState<api.Agent[] | null>(null);
  const [sources, setSources] = useState<string[]>(FALLBACK_SOURCES);
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });
  const [ticked, setTicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const [justJoined, setJustJoined] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.getAgents();
      if (!d.ok) return;
      // Notice an agent that appears while a join link is on screen.
      if (known.current) {
        const fresh = d.agents.find((a) => !known.current!.has(a.id));
        if (fresh) setJustJoined(fresh.name);
      }
      known.current = new Set(d.agents.map((a) => a.id));
      setAgents(d.agents);
      if (d.sources?.length) setSources(d.sources);
    } catch {
      setError('Could not load agents.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a join link is showing, watch for the agent to arrive.
  const waiting = panel.kind === 'link';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [waiting, load]);

  useEffect(() => {
    if (justJoined && panel.kind === 'link') setPanel({ kind: 'closed' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justJoined]);

  const openAdd = () => {
    // Start with everything ticked for the sources that are connected.
    // A new agent starts with no access; pipes are bound to it afterwards.
    setTicked([]);
    setError(null);
    setJustJoined(null);
    setPanel({ kind: 'add' });
  };

  const openEdit = (agent: api.Agent) => {
    setTicked(agent.permissions);
    setError(null);
    setPanel({ kind: 'edit', agent });
  };

  const toggle = (permission: string) =>
    setTicked((cur) => (cur.includes(permission) ? cur.filter((p) => p !== permission) : [...cur, permission]));

  const createLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.createAgentJoinLink(ticked);
      if (d.ok && d.url && d.expires_at) {
        setCopied(false);
        setPanel({ kind: 'link', url: d.url, expiresAt: d.expires_at });
      } else setError(d.error ?? 'Could not create the join link.');
    } catch {
      setError('Could not reach the hub.');
    } finally {
      setBusy(false);
    }
  };

  const savePermissions = async (agent: api.Agent) => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.setAgentPermissions(agent.id, ticked);
      if (d.ok) {
        setPanel({ kind: 'closed' });
        await load();
      } else setError(d.error ?? 'Could not save.');
    } catch {
      setError('Could not reach the hub.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (agent: api.Agent) => {
    setError(null);
    try {
      const d = await api.revokeAgent(agent.id);
      if (!d.ok) setError(d.error ?? 'Could not revoke.');
    } catch {
      setError('Could not reach the hub.');
    }
    if (panel.kind === 'edit' && panel.agent.id === agent.id) setPanel({ kind: 'closed' });
    if (justJoined === agent.name) setJustJoined(null);
    await load();
  };

  const copy = async (text: string) => {
    try {
      const clipboard = (globalThis as unknown as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
      if (!clipboard) return;
      await clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* the link is selectable, so copying by hand still works */
    }
  };

  return (
    <View className="gap-4" style={{ maxWidth: 620 }}>
      <Text className="text-body-sm text-on-surface-variant">
        Agents read your data and act through this hub. Each one registers with a join link and can be revoked on
        its own. Pipes, and which agent may use each, are set on the desktop page.
      </Text>

      {error ? (
        <View className="bg-error/10 border border-error/30 rounded-lg p-3">
          <Text className="text-error text-body-sm">{error}</Text>
        </View>
      ) : null}

      {justJoined ? (
        <View className="bg-primary/10 border border-primary/40 rounded-lg p-3 flex-row items-center justify-between gap-3">
          <Text className="text-body-sm text-on-surface flex-1">
            <Text className="font-semibold">{justJoined}</Text> joined.
          </Text>
          <Pressable onPress={() => setJustJoined(null)} className="px-2 py-1">
            <Text className="text-label-sm text-on-surface-variant">Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {panel.kind === 'closed' ? (
        <Pressable onPress={openAdd} className="self-start bg-primary rounded-lg px-4 py-2">
          <Text className="text-on-primary text-label-caps">Add agent</Text>
        </Pressable>
      ) : null}

      {panel.kind === 'add' || panel.kind === 'edit' ? (
        <View className="bg-surface border border-primary/40 rounded-lg p-4 gap-3">
          <Text className="text-body-md font-semibold text-on-surface">
            {panel.kind === 'add' ? 'What may this agent do?' : `What may ${panel.agent.name} do?`}
          </Text>
          <PermissionGrid sources={sources} ticked={ticked} onToggle={toggle} />
          <View className="flex-row gap-2">
            {panel.kind === 'add' ? (
              <Pressable onPress={createLink} disabled={busy} className="bg-primary rounded-lg px-4 py-2">
                <Text className="text-on-primary text-label-caps">{busy ? 'Creating…' : 'Create join link'}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => void savePermissions(panel.agent)} disabled={busy} className="bg-primary rounded-lg px-4 py-2">
                <Text className="text-on-primary text-label-caps">{busy ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setPanel({ kind: 'closed' })} className="border border-outline-variant rounded-lg px-4 py-2">
              <Text className="text-on-surface-variant text-label-caps">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {panel.kind === 'link' ? (
        <View className="bg-surface border border-primary/40 rounded-lg p-4 gap-2.5">
          <Text className="text-body-md font-semibold text-on-surface">
            Join link, valid once, until {formatClock(panel.expiresAt)}
          </Text>
          {/* The link is one long unbroken string; let it wrap inside the card. */}
          <Text selectable className="text-body-sm text-on-surface bg-surface-container rounded-lg p-3" style={BREAK_ANYWHERE}>
            {panel.url}
          </Text>
          <Pressable onPress={() => void copy(panel.url)} className="self-start border border-outline-variant rounded-lg px-3 py-1.5">
            <Text className="text-label-sm text-on-surface-variant">{copied ? 'Copied' : 'Copy link'}</Text>
          </Pressable>
          <Text className="text-body-sm text-on-surface-variant">On the machine where the agent runs:</Text>
          <Text selectable className="text-body-sm text-on-surface bg-surface-container rounded-lg p-3" style={BREAK_ANYWHERE}>
            smithagent joinhub {'<agent>'} {panel.url}
          </Text>
          <Text className="text-body-sm text-on-surface-variant">Waiting for the agent to join…</Text>
          <Pressable onPress={() => setPanel({ kind: 'closed' })} className="self-start border border-outline-variant rounded-lg px-4 py-2">
            <Text className="text-on-surface-variant text-label-caps">Close</Text>
          </Pressable>
        </View>
      ) : null}

      {agents === null ? (
        <Text className="text-on-surface-variant text-body-sm">Loading…</Text>
      ) : agents.length === 0 ? (
        <View className="bg-surface border border-outline-variant rounded-lg p-6 items-center">
          <Text className="text-body-md font-bold text-on-surface mb-1">No agents yet</Text>
          <Text className="text-body-sm text-on-surface-variant text-center">
            Add one to let an agent use this hub.
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {agents.map((a) => (
            <View key={a.id} className="bg-surface border border-outline-variant rounded-lg p-3 gap-2">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-body-md font-semibold text-on-surface flex-1">{a.name}</Text>
                <Text className="text-label-sm text-on-surface-variant">
                  {a.last_used_at ? `last used ${formatTime(a.last_used_at)}` : 'never used'}
                </Text>
              </View>
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-body-sm text-on-surface-variant flex-1">{summarize(a.permissions, sources)}</Text>
                <Pressable onPress={() => openEdit(a)} className="border border-outline-variant rounded-lg px-3 py-1.5">
                  <Text className="text-label-sm text-on-surface-variant">Edit</Text>
                </Pressable>
                <Pressable onPress={() => void revoke(a)} className="border border-error/40 rounded-lg px-3 py-1.5">
                  <Text className="text-label-sm text-error">Revoke</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function PermissionGrid({ sources, ticked, onToggle }: { sources: string[]; ticked: string[]; onToggle: (p: string) => void }) {
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center">
        <Text className="flex-1 text-label-sm text-on-surface-variant" />
        <Text className="text-label-sm text-on-surface-variant text-center" style={{ width: 70 }}>Read</Text>
      </View>
      {sources.map((s) => (
        <View key={s} className="flex-row items-center">
          <Text className="flex-1 text-body-md text-on-surface">{SOURCE_LABELS[s] ?? s}</Text>
          <View style={{ width: 70 }} className="items-center">
            <Check checked={ticked.includes(`pull:${s}`)} onPress={() => onToggle(`pull:${s}`)} label={`Read ${SOURCE_LABELS[s] ?? s}`} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Check({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      className={`w-6 h-6 rounded border items-center justify-center ${checked ? 'bg-primary border-primary' : 'border-outline-variant bg-surface'}`}
    >
      {checked ? <Text className="text-on-primary text-label-sm font-bold">✓</Text> : null}
    </Pressable>
  );
}

// "Gmail (read) · GitHub (read) · 2 pipes"
function summarize(permissions: string[], sources: string[]): string {
  const parts: string[] = [];
  for (const s of sources) {
    if (permissions.includes(`pull:${s}`)) parts.push(`${SOURCE_LABELS[s] ?? s} (read)`);
  }
  const pipes = permissions.filter((p) => p.startsWith('pipe:')).length;
  if (pipes) parts.push(`${pipes} pipe${pipes === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'No permissions';
}

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" with no zone marker.
function parseTime(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
}

function formatTime(value: string): string {
  const d = parseTime(value);
  return isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatClock(value: string): string {
  const d = parseTime(value);
  return isNaN(d.getTime()) ? value : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import * as api from '../api/client';

/**
 * Settings → Agent keys. An agent sends its key as `Authorization: Bearer pk_...`
 * on every /agent/* call. The hub stores only a hash, so a new key is shown once.
 */
export function AgentKeysForm() {
  const [keys, setKeys] = useState<api.AgentKey[] | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const d = await api.getAgentKeys();
      if (d.ok) setKeys(d.keys);
    } catch {
      setError('Could not load keys.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setError(null);
    const d = await api.createAgentKey(n);
    if (!d.ok || !d.key) {
      setError(d.error ?? 'Could not create the key.');
      return;
    }
    setCreated({ name: n, key: d.key });
    setName('');
    await load();
  };

  const remove = async (id: string) => {
    await api.deleteAgentKey(id);
    await load();
  };

  return (
    <View className="gap-4" style={{ maxWidth: 560 }}>
      <Text className="text-body-sm text-on-surface-variant">
        Each agent needs a key to read your data or propose actions. Give every agent its own key so the Activity Log
        shows who did what, and so you can cut one off without affecting the others.
      </Text>

      {error ? (
        <View className="bg-error/10 border border-error/30 rounded-lg p-3">
          <Text className="text-error text-body-sm">{error}</Text>
        </View>
      ) : null}

      {created ? (
        <View className="bg-primary/10 border border-primary/40 rounded-lg p-4 gap-2">
          <Text className="text-body-md font-semibold text-on-surface">Key for “{created.name}”</Text>
          <Text className="text-body-sm text-on-surface-variant">
            Copy it now. It will not be shown again.
          </Text>
          <Text selectable className="text-body-sm text-on-surface" style={{ fontFamily: 'monospace' }}>
            {created.key}
          </Text>
          <Pressable onPress={() => setCreated(null)} className="self-start border border-outline-variant rounded-lg px-3 py-1.5">
            <Text className="text-label-sm text-on-surface-variant">I have copied it</Text>
          </Pressable>
        </View>
      ) : null}

      <View className="flex-row gap-2">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Agent name, e.g. claude-code"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={create}
          className="flex-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
        />
        <Pressable onPress={create} className="bg-primary rounded-lg px-4 py-2 justify-center">
          <Text className="text-on-primary text-label-caps">Create key</Text>
        </Pressable>
      </View>

      {keys === null ? (
        <Text className="text-on-surface-variant text-body-sm">Loading…</Text>
      ) : keys.length === 0 ? (
        <View className="bg-surface border border-outline-variant rounded-lg p-6 items-center">
          <Text className="text-body-md font-bold text-on-surface mb-1">No agent keys yet</Text>
          <Text className="text-body-sm text-on-surface-variant text-center">
            Until you create one, no agent can call this hub.
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {keys.map((k) => (
            <View key={k.id} className="bg-surface border border-outline-variant rounded-lg p-3 flex-row items-center justify-between gap-3">
              <View className="flex-1 gap-0.5">
                <Text className="text-body-md font-semibold text-on-surface">{k.name}</Text>
                <Text className="text-label-sm text-on-surface-variant">
                  {k.last_used_at ? `Last used ${formatTime(k.last_used_at)}` : 'Never used'}
                </Text>
              </View>
              <Pressable onPress={() => void remove(k.id)} className="border border-error/40 rounded-lg px-3 py-1.5">
                <Text className="text-label-sm text-error">Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" with no zone marker.
function formatTime(value: string): string {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? value : d.toLocaleString();
}

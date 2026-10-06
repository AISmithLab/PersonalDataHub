import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import type { MemoryRow } from '../api/client';

const MEMORY_LIMIT = 50;

export function MemoryTab({ state }: { state: AppState }) {
  const [adding, setAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    state.loadMemories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = state.memories ?? [];
  const total = items.length;
  const percent = Math.min(100, Math.round((total / MEMORY_LIMIT) * 100));

  const submitNew = async () => {
    const content = newContent.trim();
    if (!content) return;
    const d = await state.addMemory(content);
    if (!d.ok) {
      setError(d.error || 'Failed to save memory');
      return;
    }
    setNewContent('');
    setAdding(false);
    setError(null);
  };

  const startEdit = (m: MemoryRow) => {
    setEditingId(m.id);
    setEditContent(m.content);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const d = await state.editMemory(editingId, editContent.trim());
    if (d.ok) {
      setEditingId(null);
      setEditContent('');
    } else {
      setError(d.error || 'Failed to update memory');
    }
  };

  return (
    <View>
      <View className="flex-row items-end justify-between mb-4 pb-2 border-b border-outline-variant">
        <View className="gap-1.5">
          <Text className="text-headline-md text-on-surface font-bold">AI Memory</Text>
          <View className="flex-row items-center gap-2">
            <View className="w-32 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
              <View className="h-full bg-primary" style={{ width: `${percent}%` }} />
            </View>
            <Text className="text-label-sm text-on-surface-variant">{total} / {MEMORY_LIMIT} memories saved</Text>
          </View>
        </View>
        <Pressable
          onPress={() => {
            setAdding((v) => !v);
            setError(null);
          }}
          className="bg-primary rounded-lg px-4 py-2 flex-row items-center"
        >
          <Text className="text-on-primary font-label-caps text-label-caps">{adding ? 'Cancel' : 'Add memory'}</Text>
        </Pressable>
      </View>

      {error ? (
        <View className="bg-error/10 border border-error/30 rounded-lg p-3 mb-3">
          <Text className="text-error text-body-sm">{error}</Text>
        </View>
      ) : null}

      {adding ? (
        <View className="bg-surface border border-primary/40 rounded-lg p-4 mb-4 gap-2.5">
          <Text className="text-label-sm text-on-surface-variant">What should the AI remember?</Text>
          <TextInput
            value={newContent}
            onChangeText={setNewContent}
            placeholder="e.g. Prefers concise replies. Works in timezone UTC+5:30."
            multiline
            className="border border-outline-variant rounded-lg p-3 text-body-md"
            style={{ minHeight: 80 }}
          />
          <View className="flex-row gap-2">
            <Pressable onPress={submitNew} className="bg-primary rounded-lg px-4 py-2">
              <Text className="text-on-primary text-label-caps">Save</Text>
            </Pressable>
            <Pressable onPress={() => setAdding(false)} className="border border-outline-variant rounded-lg px-4 py-2">
              <Text className="text-on-surface-variant text-label-caps">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {state.memoriesLoading && total === 0 ? (
        <View className="p-10 items-center">
          <Text className="text-on-surface-variant text-body-sm">Loading…</Text>
        </View>
      ) : total === 0 && !adding ? (
        <View className="bg-surface border border-outline-variant rounded-lg p-8 items-center">
          <Text className="text-body-md font-bold text-on-surface mb-2">No memories yet</Text>
          <Text className="text-body-sm text-on-surface-variant text-center">
            Chat with the AI and it will save facts about you automatically, or add one manually above.
          </Text>
        </View>
      ) : (
        <View className="gap-2.5">
          {items.map((m) => (
            <View
              key={m.id}
              className={`border rounded-lg p-4 gap-2 bg-surface ${editingId === m.id ? 'border-primary' : 'border-outline-variant'}`}
            >
              {editingId === m.id ? (
                <>
                  <TextInput
                    value={editContent}
                    onChangeText={setEditContent}
                    multiline
                    className="border border-outline-variant rounded-lg p-3 text-body-md"
                    style={{ minHeight: 80 }}
                  />
                  <View className="flex-row gap-2">
                    <Pressable onPress={saveEdit} className="bg-primary rounded-lg px-3.5 py-1.5">
                      <Text className="text-on-primary text-label-caps">Save</Text>
                    </Pressable>
                    <Pressable onPress={() => setEditingId(null)} className="border border-outline-variant rounded-lg px-3.5 py-1.5">
                      <Text className="text-on-surface-variant text-label-caps">Cancel</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <View className="flex-row items-start justify-between gap-2">
                    <Text className="text-body-md text-on-surface flex-1">{m.content}</Text>
                    <View className="flex-row gap-1">
                      <Pressable onPress={() => startEdit(m)} className="px-2 py-1">
                        <Text className="text-label-sm text-on-surface-variant">Edit</Text>
                      </Pressable>
                      <Pressable onPress={() => state.deleteMemory(m.id)} className="px-2 py-1">
                        <Text className="text-label-sm text-error">Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                  <Text className="text-label-sm text-on-surface-variant">
                    {new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

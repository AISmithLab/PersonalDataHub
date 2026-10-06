import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import { SkillCard, SKILL_TRIGGERS } from '../components/SkillCard';

export function SkillTab({ state }: { state: AppState }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [triggers, setTriggers] = useState<string[]>(['sms_received']);
  const [allowedSources, setAllowedSources] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'' | 'label' | 'action'>('');

  useEffect(() => {
    state.loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = state.skills ?? [];
  const filtered = filterType ? items.filter((s) => s.primitive_type === filterType) : items;

  const toggleTrigger = (key: string) => {
    setTriggers((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  const submit = async () => {
    if (!name.trim()) return;
    const d = await state.createSkill({
      name: name.trim(),
      instructions,
      trigger_events: triggers.length ? triggers : ['sms_received'],
      allowed_sources: allowedSources.trim() || null,
    });
    if (!d.ok) {
      setError(d.error || 'Failed to save skill');
      return;
    }
    setName('');
    setInstructions('');
    setTriggers(['sms_received']);
    setAllowedSources('');
    setAdding(false);
    setError(null);
  };

  return (
    <View>
      <View className="flex-row items-end justify-between mb-4 pb-2 border-b border-outline-variant">
        <View className="gap-1">
          <Text className="text-headline-md text-on-surface font-bold">Skills</Text>
          <Text className="text-body-sm text-on-surface-variant">
            Rules injected dynamically when trigger events fire.
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setAdding((v) => !v);
            setError(null);
          }}
          className="bg-primary rounded-lg px-4 py-2"
        >
          <Text className="text-on-primary font-label-caps text-label-caps">{adding ? 'Cancel' : 'New skill'}</Text>
        </Pressable>
      </View>

      {error ? (
        <View className="bg-error/10 border border-error/30 rounded-lg p-3 mb-3">
          <Text className="text-error text-body-sm">{error}</Text>
        </View>
      ) : null}

      {adding ? (
        <View className="bg-surface border border-primary/40 rounded-lg p-4 mb-4 gap-2.5">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Skill name"
            className="border border-outline-variant rounded-lg px-3 py-2 text-body-md"
          />
          <Text className="text-label-sm font-semibold text-on-surface-variant">Triggers when:</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {SKILL_TRIGGERS.map((t) => {
              const checked = triggers.includes(t.key);
              return (
                <Pressable
                  key={t.key}
                  onPress={() => toggleTrigger(t.key)}
                  className={`px-2 py-1 rounded-lg border ${checked ? 'bg-primary/10 border-primary' : 'border-outline-variant'}`}
                >
                  <Text className={`text-label-sm ${checked ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-label-sm font-semibold text-on-surface-variant">Allowed Sources</Text>
          <TextInput
            value={allowedSources}
            onChangeText={setAllowedSources}
            placeholder='e.g. ["photo", "emails"] (blank = all)'
            className="border border-outline-variant rounded-lg px-2 py-1 text-label-sm"
          />
          <TextInput
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Describe what the AI should do when this trigger fires — context to check, reply style, behavioral rules, anything."
            multiline
            className="border border-outline-variant rounded-lg p-3 text-body-md"
            style={{ minHeight: 120 }}
          />
          <View className="flex-row gap-2">
            <Pressable onPress={submit} className="bg-primary rounded-lg px-5 py-2">
              <Text className="text-on-primary text-label-caps">Save</Text>
            </Pressable>
            <Pressable onPress={() => setAdding(false)} className="border border-outline-variant rounded-lg px-5 py-2">
              <Text className="text-on-surface-variant text-label-caps">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {state.skillsLoading && items.length === 0 ? (
        <View className="p-10 items-center">
          <Text className="text-on-surface-variant text-body-sm">Loading…</Text>
        </View>
      ) : items.length === 0 && !adding ? (
        <View className="bg-surface border border-outline-variant rounded-lg p-8 items-center">
          <Text className="text-body-md font-bold text-on-surface mb-2">No skills yet</Text>
          <Text className="text-body-sm text-on-surface-variant text-center">
            Create a skill to guide the AI's behavior when a trigger fires.
          </Text>
        </View>
      ) : (
        <>
          <View className="flex-row gap-2 mb-3">
            {(['', 'label', 'action'] as const).map((t) => (
              <Pressable
                key={t || 'all'}
                onPress={() => setFilterType(t)}
                className={`px-3 py-1 rounded-lg border ${filterType === t ? 'bg-primary border-primary' : 'border-outline-variant'}`}
              >
                <Text className={`text-label-sm ${filterType === t ? 'text-on-primary' : 'text-on-surface-variant'}`}>
                  {t === '' ? 'All Types' : t === 'label' ? 'Labels' : 'Actions'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="gap-2.5">
            {filtered.map((s) => (
              <SkillCard key={s.id} skill={s} state={state} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, Switch } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import type { SkillRow } from '../api/client';

export const SKILL_TRIGGERS = [
  { key: 'sms_received', label: 'SMS Received' },
  { key: 'photo_added', label: 'New Photo Added' },
  { key: 'email_received', label: 'Email Received' },
  { key: 'calendar_event_starting', label: 'Event Starting Soon' },
] as const;

function parseTriggerEvents(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

function sourceIcon(src: string): string {
  if (src === 'photo') return '🖼️ Photos';
  if (src === 'emails' || src === 'gmail') return '✉️ Emails';
  if (src === 'sms') return '💬 SMS';
  if (src === 'calendar') return '📅 Calendar';
  return src;
}

export function SkillCard({ skill, state }: { skill: SkillRow; state: AppState }) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(skill.name);
  const [instructions, setInstructions] = useState(skill.instructions);
  const [triggers, setTriggers] = useState<string[]>(parseTriggerEvents(skill.trigger_event));
  const [allowedSources, setAllowedSources] = useState(skill.allowed_sources ?? '');

  const toggleTrigger = (key: string) => {
    setTriggers((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  const save = async () => {
    await state.saveSkill(skill.id, {
      name,
      instructions,
      trigger_events: triggers.length ? triggers : ['sms_received'],
      allowed_sources: allowedSources.trim() || null,
    });
    setEditing(false);
  };

  const triggerLabels = parseTriggerEvents(skill.trigger_event).map(
    (key) => SKILL_TRIGGERS.find((t) => t.key === key)?.label ?? key
  );
  let sourceIcons: string[] = [];
  if (skill.allowed_sources && skill.allowed_sources !== 'null') {
    try {
      const list = JSON.parse(skill.allowed_sources);
      if (Array.isArray(list)) sourceIcons = list.map(sourceIcon);
    } catch {
      // ignore malformed allowed_sources
    }
  }

  if (editing) {
    return (
      <View className="border border-primary rounded-lg p-3 bg-surface gap-2.5">
        <Text className="text-label-caps text-on-surface-variant">Editing Skill</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Skill name" className="border border-outline-variant rounded-lg px-3 py-2 text-body-md" />
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
          placeholder="Describe what the AI should do when this trigger fires…"
          multiline
          className="border border-outline-variant rounded-lg p-3 text-body-md"
          style={{ minHeight: 100 }}
        />
        <View className="flex-row gap-2">
          <Pressable onPress={save} className="bg-primary rounded-lg px-5 py-2">
            <Text className="text-on-primary text-label-caps">Save</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(false)} className="border border-outline-variant rounded-lg px-5 py-2">
            <Text className="text-on-surface-variant text-label-caps">Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className={`border rounded-lg p-3 bg-surface ${skill.enabled ? 'border-primary/50' : 'border-outline-variant'}`}>
      <Pressable onPress={() => setExpanded((v) => !v)} className="flex-row items-start justify-between gap-2">
        <View className="flex-row items-start gap-2 flex-1">
          <Text className="text-on-surface-variant">{expanded ? '▾' : '▸'}</Text>
          <Text className="text-body-md font-bold text-on-surface flex-1">{skill.name}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Switch value={!!skill.enabled} onValueChange={(v) => void state.toggleSkillEnabled(skill.id, v)} />
          <Pressable onPress={() => setEditing(true)} className="px-1.5 py-1">
            <Text className="text-label-sm text-on-surface-variant">Edit</Text>
          </Pressable>
          <Pressable onPress={() => state.deleteSkill(skill.id)} className="px-1.5 py-1">
            <Text className="text-label-sm text-error">Delete</Text>
          </Pressable>
        </View>
      </Pressable>

      {expanded ? (
        <View className="pl-6 mt-2 gap-2.5">
          <View className="flex-row flex-wrap gap-1.5">
            {triggerLabels.map((label) => (
              <View key={label} className="bg-surface-container rounded px-1.5 py-0.5">
                <Text className="text-label-sm text-on-surface-variant uppercase">{label}</Text>
              </View>
            ))}
            {skill.enabled ? (
              <View className="bg-primary/15 rounded px-1.5 py-0.5">
                <Text className="text-label-sm text-primary font-semibold uppercase">active</Text>
              </View>
            ) : null}
            {sourceIcons.map((icon) => (
              <View key={icon} className="bg-tertiary-container rounded px-1.5 py-0.5">
                <Text className="text-label-sm text-on-tertiary-container font-semibold">{icon}</Text>
              </View>
            ))}
          </View>
          <Text className="text-body-sm text-on-surface">{skill.summary || skill.instructions || 'No summary available.'}</Text>
        </View>
      ) : null}
    </View>
  );
}

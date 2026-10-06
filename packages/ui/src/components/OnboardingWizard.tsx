import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, Switch, Modal } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import { ProviderPills } from './ProviderPills';

const STEPS = ['intro', 'apikey', 'sms', 'chat', 'memory'] as const;

export function OnboardingWizard({ state }: { state: AppState }) {
  return (
    <Modal visible={state.onboardingActive} transparent animationType="fade" onRequestClose={() => {}}>
      <View className="flex-1 bg-black/50 items-center justify-center p-6">
        <View className="bg-surface border border-outline-variant rounded-2xl p-6 w-full gap-6" style={{ maxWidth: 480 }}>
          <View className="flex-row items-center justify-center gap-2">
            {STEPS.map((s, i) => {
              const idx = STEPS.indexOf(state.onboardingStep);
              const active = i === idx;
              const past = i < idx;
              return (
                <View
                  key={s}
                  className={`h-1.5 rounded-full ${active ? 'bg-primary' : past ? 'bg-primary/50' : 'bg-outline-variant'}`}
                  style={{ width: active ? 32 : 16 }}
                />
              );
            })}
          </View>

          <StepContent state={state} />

          <View className="flex-row items-center justify-between pt-2 border-t border-outline-variant">
            {STEPS.indexOf(state.onboardingStep) > 0 ? (
              <Pressable onPress={state.onboardingBack} className="px-3 py-2">
                <Text className="text-on-surface-variant text-label-caps">Back</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <View className="flex-row items-center gap-3">
              <Pressable onPress={state.completeOnboarding} className="px-2 py-2">
                <Text className="text-on-surface-variant text-body-sm">Skip</Text>
              </Pressable>
              <Pressable
                onPress={STEPS.indexOf(state.onboardingStep) === STEPS.length - 1 ? state.completeOnboarding : state.onboardingNext}
                className="bg-primary rounded-xl px-5 py-2.5"
              >
                <Text className="text-on-primary text-label-caps">
                  {STEPS.indexOf(state.onboardingStep) === STEPS.length - 1 ? 'Get Started' : 'Continue'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function StepContent({ state }: { state: AppState }) {
  switch (state.onboardingStep) {
    case 'intro':
      return (
        <View className="items-center gap-3">
          <Text className="text-headline-lg text-on-surface font-bold text-center">Welcome to PersonalDataHub</Text>
          <Text className="text-body-sm text-on-surface-variant text-center">
            Your AI assistant runs on this device and only acts with your permission. Let's set up the essentials — it
            takes about a minute.
          </Text>
        </View>
      );
    case 'apikey':
      return <ApiKeyStep state={state} />;
    case 'sms':
      return <SmsStep state={state} />;
    case 'chat':
      return (
        <View className="gap-4">
          <View className="gap-1">
            <Text className="text-headline-md text-on-surface font-bold">Chat with your AI</Text>
            <Text className="text-body-sm text-on-surface-variant">
              The Chat tab is a normal conversation with your assistant. It can read your messages, photos, and
              connected accounts, draft replies, and take actions you approve.
            </Text>
          </View>
          <View className="bg-surface-container-low border border-outline-variant rounded-lg p-4 gap-2">
            {['Ask questions about your messages, emails, or calendar', 'Have it draft a text or summarize a conversation', 'Approve or reject any action before it happens'].map(
              (t) => (
                <Text key={t} className="text-body-sm text-on-surface-variant">✓ {t}</Text>
              )
            )}
          </View>
        </View>
      );
    case 'memory':
      return (
        <View className="gap-4">
          <View className="gap-1">
            <Text className="text-headline-md text-on-surface font-bold">Memories & Skills</Text>
            <Text className="text-body-sm text-on-surface-variant">Two tabs help the AI act more like you over time. You can edit either anytime.</Text>
          </View>
          <View className="gap-2.5">
            <View className="bg-surface border border-outline-variant rounded-lg p-4">
              <Text className="text-body-md font-bold text-on-surface">Memory</Text>
              <Text className="text-body-sm text-on-surface-variant">
                Facts the AI remembers about you — preferences, people, ongoing context. Add, edit, or delete them anytime.
              </Text>
            </View>
            <View className="bg-surface border border-outline-variant rounded-lg p-4">
              <Text className="text-body-md font-bold text-on-surface">Skills</Text>
              <Text className="text-body-sm text-on-surface-variant">
                Reusable instructions that trigger automatically, like a house rule (e.g. "if a text mentions dinner
                plans, add it to my calendar").
              </Text>
            </View>
          </View>
        </View>
      );
    default:
      return null;
  }
}

function ApiKeyStep({ state }: { state: AppState }) {
  const [provider, setProvider] = useState(state.aiProvider);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!apiKey.trim()) return;
    const d = await state.saveAiSettings({ api_key: apiKey.trim(), provider });
    if (d.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text className="text-headline-md text-on-surface font-bold">Connect an AI provider</Text>
        <Text className="text-body-sm text-on-surface-variant">
          The assistant needs an API key to chat, auto-reply to texts, and use memories & skills. You can change this
          anytime in Settings.
        </Text>
      </View>
      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">Provider</Text>
        <ProviderPills value={provider} onChange={setProvider} />
      </View>
      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">API Key</Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry
          placeholder={state.aiAvailable ? '•••••••••••• (Configured)' : 'sk-ant-...'}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-md"
        />
      </View>
      <View className="flex-row items-center gap-3">
        <Pressable onPress={save} className="bg-primary rounded-xl px-5 py-2">
          <Text className="text-on-primary text-label-caps">Save Key</Text>
        </Pressable>
        {saved ? <Text className="text-primary text-label-sm">Saved</Text> : null}
        <View className="flex-row items-center gap-1.5">
          <View className={`w-2 h-2 rounded-full ${state.aiAvailable ? 'bg-primary' : 'bg-outline-variant'}`} />
          <Text className={`text-label-sm ${state.aiAvailable ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
            {state.aiAvailable ? 'Connected' : 'Not configured'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function SmsStep({ state }: { state: AppState }) {
  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text className="text-headline-md text-on-surface font-bold">SMS auto-reply</Text>
        <Text className="text-body-sm text-on-surface-variant">
          Let the AI draft and send replies to incoming texts automatically while the app is running. You're always
          in control — toggle it off anytime in Settings.
        </Text>
      </View>
      <View className="flex-row items-center gap-3 bg-surface border border-outline-variant rounded-xl p-4">
        <Switch value={state.autoReplyEnabled} onValueChange={(v) => void state.saveAutoReplyEnabled(v)} />
        <Text className="text-body-md font-semibold text-on-surface">{state.autoReplyEnabled ? 'Enabled' : 'Disabled'}</Text>
      </View>
      {!state.aiAvailable && state.autoReplyEnabled ? (
        <View className="p-3 bg-error/10 border border-error/30 rounded-lg">
          <Text className="text-error text-body-sm">Add an API key on the previous step first.</Text>
        </View>
      ) : null}
      <Pressable
        onPress={state.runAutoReplyTest}
        disabled={state.autoReplyTestLoading}
        className="self-start border border-outline-variant rounded-xl px-4 py-2"
      >
        <Text className="text-on-surface-variant text-label-caps">{state.autoReplyTestLoading ? 'Testing…' : 'Test auto-reply'}</Text>
      </Pressable>
      {state.autoReplyTestResult ? (
        <Text className={`text-body-sm font-semibold ${state.autoReplyTestResult.ok ? 'text-primary' : 'text-error'}`}>
          {state.autoReplyTestResult.msg}
        </Text>
      ) : null}
    </View>
  );
}

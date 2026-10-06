import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import { MessageContent } from '../components/MessageContent';

interface Chip {
  title: string;
  subtitle: string;
  query: string;
}

function buildChips(state: AppState): Chip[] {
  const chips: Chip[] = [];
  const connected = (name: string) => state.sources.some((s) => s.name === name && s.connected);
  const present = (name: string) => state.sources.some((s) => s.name === name);

  if (present('photo')) {
    chips.push({ title: 'Find photos', subtitle: 'This week', query: 'Find my recent photos from this week and summarize them' });
    chips.push({ title: 'Find receipts', subtitle: 'Screenshots', query: 'Find photo screenshots of receipts and catalog them' });
  }
  if (connected('gmail')) {
    chips.push({ title: 'Summarize emails', subtitle: 'Unread 24h', query: 'Summarize my unread emails from the last 24 hours' });
    chips.push({ title: 'Draft reply', subtitle: 'Latest email', query: 'Draft a quick reply to the latest email I received' });
  }
  if (present('sms')) {
    chips.push({ title: 'Find SMS codes', subtitle: 'Recent 2FA', query: 'Find my recent 2FA SMS verification codes' });
  }
  if (connected('google_calendar')) {
    chips.push({ title: 'Check schedule', subtitle: 'Today & tomorrow', query: 'What is on my schedule for today and tomorrow?' });
  }
  if (connected('github')) {
    chips.push({ title: 'GitHub PRs', subtitle: 'Review status', query: 'List open pull requests in my repositories' });
  }
  if (!chips.length) {
    chips.push({ title: 'Summarize emails', subtitle: 'Unread 24h', query: 'Summarize my unread emails from the last 24 hours' });
    chips.push({ title: 'Check schedule', subtitle: 'Upcoming events', query: 'What is my schedule for today and tomorrow?' });
  }
  return chips;
}

export function ChatTab({ state, onGoToSettings }: { state: AppState; onGoToSettings: () => void }) {
  const [input, setInput] = useState('');

  if (!state.aiAvailable) {
    return (
      <View className="items-center mt-16 px-6">
        <Text className="text-headline-md text-on-surface font-bold mb-2 text-center">AI Assistant not configured</Text>
        <Text className="text-body-sm text-on-surface-variant mb-4 text-center">Add an API key in Settings to get started.</Text>
        <Pressable onPress={onGoToSettings} className="bg-primary rounded-lg px-5 py-2.5">
          <Text className="text-on-primary text-label-caps">Go to Settings</Text>
        </Pressable>
      </View>
    );
  }

  const smsPending = state.staging.filter((a) => a.source === 'sms' && a.status === 'pending');

  const send = () => {
    const text = input;
    setInput('');
    state.sendMessage(text);
  };

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3 pb-2 border-b border-outline-variant">
        <Text className="text-headline-md text-on-surface font-bold">AI Studio</Text>
        <Pressable onPress={state.clearChat} className="px-2 py-1">
          <Text className="text-label-sm text-on-surface-variant">Clear</Text>
        </Pressable>
      </View>

      {state.chatMessages.length === 0 ? (
        <View className="items-center py-10 px-4">
          <Text className="text-headline-md text-on-surface mb-1 text-center">How can I help with your data?</Text>
          <Text className="text-body-sm text-on-surface-variant text-center mb-6">
            Ask me anything about your data — emails, calendar, GitHub, or SMS.
          </Text>
          <View className="flex-row flex-wrap gap-2.5 justify-center">
            {buildChips(state).map((c) => (
              <Pressable
                key={c.title}
                onPress={() => state.sendMessage(c.query)}
                className="border border-outline-variant rounded-lg p-3 bg-surface"
                style={{ minWidth: 130 }}
              >
                <Text className="text-label-sm font-semibold text-on-surface">{c.title}</Text>
                <Text className="text-label-sm text-on-surface-variant">{c.subtitle}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 480 }} className="mb-3">
          <View className="gap-3">
            {state.chatMessages.map((msg, i) => (
              <View key={i} className={`flex-row ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <View
                  className={`rounded-2xl px-4 py-2.5 ${msg.role === 'user' ? 'bg-primary' : 'bg-surface border border-outline-variant'}`}
                  style={{ maxWidth: '85%' }}
                >
                  {msg.role === 'user' ? (
                    <Text className="text-on-primary text-body-sm">{msg.content}</Text>
                  ) : (
                    <MessageContent message={msg} />
                  )}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {smsPending.length ? (
        <View className="gap-2.5 mb-3">
          {smsPending.map((a) => {
            const data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
            return (
              <View key={a.action_id} className="border border-outline-variant rounded-lg p-3 bg-surface gap-1.5" style={{ maxWidth: '85%' }}>
                <Text className="text-label-sm text-on-surface-variant uppercase">Staged SMS</Text>
                <Text className="text-body-sm text-on-surface"><Text className="font-bold">To: </Text>{data.to || ''}</Text>
                <Text className="text-body-sm text-on-surface-variant">{data.body || ''}</Text>
                <View className="flex-row gap-2 mt-1">
                  <Pressable onPress={() => state.resolveAction(a.action_id, 'reject')} className="border border-error/30 rounded-lg px-3.5 py-1.5">
                    <Text className="text-error text-label-caps">Deny</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => state.sendStagedSms(a.action_id, data.to || '', data.body || '')}
                    className="bg-primary rounded-lg px-3.5 py-1.5"
                  >
                    <Text className="text-on-primary text-label-caps">Send SMS</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {state.chatLoading ? <Text className="text-on-surface-variant text-body-sm mb-2">Thinking…</Text> : null}
      {state.chatError ? (
        <View className="bg-error/10 border border-error/30 rounded-lg p-3 mb-3">
          <Text className="text-error text-body-sm">{state.chatError}</Text>
        </View>
      ) : null}

      <View className="flex-row items-center gap-2 bg-surface border border-outline-variant rounded-xl p-2">
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your data..."
          editable={!state.chatLoading}
          onSubmitEditing={send}
          className="flex-1 px-2 text-body-md"
        />
        <Pressable onPress={send} disabled={state.chatLoading} className="bg-primary rounded-lg px-4 py-2">
          <Text className="text-on-primary text-label-caps">Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

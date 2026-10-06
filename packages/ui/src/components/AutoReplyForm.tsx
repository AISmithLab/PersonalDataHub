import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Switch } from 'react-native';
import type { AppState } from '../hooks/useAppState';

export function AutoReplyForm({ state }: { state: AppState }) {
  const [rounds, setRounds] = useState(String(state.autoReplyMaxToolRounds));

  return (
    <View className="gap-4" style={{ maxWidth: 480 }}>
      <View className="flex-row items-center gap-3 bg-surface border border-outline-variant rounded-lg p-4">
        <Switch value={state.autoReplyEnabled} onValueChange={(v) => void state.saveAutoReplyEnabled(v)} />
        <View className="gap-0.5">
          <Text className="text-body-md font-semibold text-on-surface">{state.autoReplyEnabled ? 'Enabled' : 'Disabled'}</Text>
          <Text className="text-body-sm text-on-surface-variant">Automatically handle incoming SMS notifications</Text>
        </View>
      </View>

      {state.autoReplyEnabled ? (
        <View className="p-4 bg-surface-container rounded-lg border border-outline-variant gap-1">
          <Text className="text-label-sm font-semibold text-primary">Behavior Note</Text>
          <Text className="text-body-sm text-on-surface-variant">
            Replies within ~5 seconds while the app is running. Checks SMS history, Calendar, and Gmail before
            replying. Short codes (e.g. 2FA codes) are automatically skipped. Check the Activity Log for history.
          </Text>
        </View>
      ) : null}

      {!state.aiAvailable && state.autoReplyEnabled ? (
        <View className="p-4 bg-error/10 border border-error/30 rounded-lg">
          <Text className="text-error text-body-sm">AI key required — configure a provider and key first.</Text>
        </View>
      ) : null}

      <View className="bg-surface border border-outline-variant rounded-lg p-4 gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">Context Depth (Tool Rounds)</Text>
        <View className="flex-row items-center gap-3">
          <TextInput
            value={rounds}
            onChangeText={setRounds}
            onBlur={() => {
              const n = Math.max(1, Math.min(10, Math.round(Number(rounds) || 3)));
              setRounds(String(n));
              state.saveMaxToolRounds(n);
            }}
            keyboardType="number-pad"
            className="w-16 border border-outline-variant rounded-lg px-2 py-1.5 text-body-md"
          />
          <Text className="text-body-sm text-on-surface-variant">(1 = fast, 3 = balanced, 5+ = thorough)</Text>
        </View>
      </View>

      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={state.runAutoReplyTest}
          disabled={state.autoReplyTestLoading}
          className="border border-outline-variant rounded-lg px-4 py-2.5"
        >
          <Text className="text-on-surface-variant text-label-caps">
            {state.autoReplyTestLoading ? 'Testing…' : 'Test auto-reply'}
          </Text>
        </Pressable>
        {state.autoReplyTestResult ? (
          <Text className={`text-body-sm font-semibold flex-1 ${state.autoReplyTestResult.ok ? 'text-primary' : 'text-error'}`}>
            {state.autoReplyTestResult.msg}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

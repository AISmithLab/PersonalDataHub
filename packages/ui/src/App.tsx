import React, { useState } from 'react';
import { View, ScrollView, Pressable, Text } from 'react-native';
import { useAppState } from './hooks/useAppState';
import { GmailTab } from './tabs/GmailTab';
import { CalendarTab } from './tabs/CalendarTab';
import { GitHubTab } from './tabs/GitHubTab';

// Phase 2 of the vanilla-JS -> React migration: the data-only tabs (Gmail,
// Calendar, GitHub) are ported behind a minimal tab switcher. Other tabs land
// in later phases (see the migration plan).
const TABS = [
  { key: 'gmail', label: 'Gmail' },
  { key: 'google_calendar', label: 'Calendar' },
  { key: 'github', label: 'GitHub' },
] as const;

export function App() {
  const state = useAppState();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('gmail');

  return (
    <View className="flex-1 bg-background">
      {/* Fixed top padding as a rough stand-in for a status-bar clearance —
          arbitrary-value classes using calc()/env() are NOT safe here even
          though this only renders inside the mobile WebView today: Tailwind's
          content scan picks up the literal class text from this file for the
          *native* mobile build too (its config globs packages/ui/src), and
          NativeWind's native-side CSS parser (lightningcss) can't parse
          calc(env(...)) and crashes the whole Metro bundle. Phase 3's native
          cutover should replace this with real SafeAreaView/useSafeAreaInsets. */}
      <View className="flex-row gap-2 p-4 pb-0 pt-8">
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 border ${tab === t.key ? 'bg-primary border-primary' : 'border-outline-variant'}`}
          >
            <Text className={`text-label-sm ${tab === t.key ? 'text-on-primary' : 'text-on-surface-variant'}`}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView className="flex-1 p-4">
        {tab === 'gmail' && <GmailTab state={state} />}
        {tab === 'google_calendar' && <CalendarTab state={state} />}
        {tab === 'github' && <GitHubTab state={state} />}
      </ScrollView>
    </View>
  );
}

import React, { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, Text, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppState } from './hooks/useAppState';
import { useSmsAutoReply } from './hooks/useSmsAutoReply';
import { useOAuthDeepLink, alertOAuthError } from './hooks/useOAuthDeepLink';
import { oauthStartUrl } from './api/client';
import { GmailTab } from './tabs/GmailTab';
import { CalendarTab } from './tabs/CalendarTab';
import { GitHubTab } from './tabs/GitHubTab';
import { SmsTab } from './tabs/SmsTab';
import { PhotoTab } from './tabs/PhotoTab';

type BottomTab = 'ai' | 'skill' | 'memory' | 'settings';
type ManageSource = 'gmail' | 'google_calendar' | 'github' | 'sms' | 'photo';
type SettingsView = 'root' | 'integrations' | { manage: ManageSource };

const BOTTOM_TABS: { key: BottomTab; label: string }[] = [
  { key: 'ai', label: 'Chat' },
  { key: 'skill', label: 'Skill' },
  { key: 'memory', label: 'Memory' },
  { key: 'settings', label: 'Settings' },
];

const INTEGRATIONS: { name: ManageSource; label: string; subtitle: string; isNative: boolean }[] = [
  { name: 'sms', label: 'SMS (Android)', subtitle: 'Messages via Android bridge', isNative: true },
  { name: 'photo', label: 'Photos & Gallery', subtitle: 'EXIF stripping ON by default', isNative: true },
  { name: 'gmail', label: 'Gmail', subtitle: '', isNative: false },
  { name: 'google_calendar', label: 'Google Calendar', subtitle: '', isNative: false },
  { name: 'github', label: 'GitHub', subtitle: '', isNative: false },
];

export function App() {
  const state = useAppState();
  const [activeTab, setActiveTab] = useState<BottomTab>('ai');
  const [settingsView, setSettingsView] = useState<SettingsView>('root');
  const insets = useSafeAreaInsets();

  useSmsAutoReply();

  const handleOAuthResult = useCallback(
    (success: string | null, error: string | null) => {
      if (success) {
        state.refreshAll();
        setActiveTab('settings');
        setSettingsView({ manage: success as ManageSource });
      }
      if (error) alertOAuthError(error);
    },
    [state]
  );
  useOAuthDeepLink(handleOAuthResult);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScrollView className="flex-1 p-4">
        {activeTab === 'ai' && <StubTab label="Chat" />}
        {activeTab === 'skill' && <StubTab label="Skill" />}
        {activeTab === 'memory' && <StubTab label="Memory" />}
        {activeTab === 'settings' && (
          <SettingsTab state={state} view={settingsView} setView={setSettingsView} />
        )}
      </ScrollView>

      <View
        className="flex-row justify-around items-center py-2 bg-surface border-t border-outline-variant"
        style={{ paddingBottom: insets.bottom }}
      >
        {BOTTOM_TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => {
              setActiveTab(t.key);
              if (t.key === 'settings') setSettingsView('root');
            }}
            className="px-3 py-1 items-center"
          >
            <Text className={`text-label-sm ${activeTab === t.key ? 'text-primary font-bold' : 'text-on-surface-variant'}`}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function StubTab({ label }: { label: string }) {
  return (
    <View className="items-center mt-16">
      <Text className="text-headline-md text-on-surface font-bold mb-2">{label}</Text>
      <Text className="text-body-sm text-on-surface-variant">Coming in Phase 4.</Text>
    </View>
  );
}

function SettingsTab({
  state,
  view,
  setView,
}: {
  state: ReturnType<typeof useAppState>;
  view: SettingsView;
  setView: (v: SettingsView) => void;
}) {
  if (typeof view === 'object') {
    return <ManageScreen source={view.manage} state={state} onBack={() => setView('integrations')} />;
  }

  if (view === 'integrations') {
    return (
      <View>
        <BackHeader title="Integrations" onBack={() => setView('root')} />
        <Text className="text-body-sm text-on-surface-variant mb-4">
          Connect services to give the AI access to your data.
        </Text>
        <View className="gap-3">
          {INTEGRATIONS.map((item) => {
            const source = state.sources.find((s) => s.name === item.name);
            const connected = item.isNative || !!source?.connected;
            const subtitle = item.isNative
              ? item.subtitle
              : source?.accountInfo?.email ?? (source?.accountInfo?.login ? `@${source.accountInfo.login}` : source?.connected ? 'Connected' : 'Not connected');

            return (
              <View key={item.name} className="bg-surface border border-outline-variant rounded-lg p-4 gap-3">
                <View>
                  <Text className="text-body-md font-bold text-on-surface">{item.label}</Text>
                  <Text className="text-body-sm text-on-surface-variant mt-0.5">{subtitle}</Text>
                </View>
                <View className="flex-row items-center justify-between border-t border-outline-variant pt-2.5">
                  <Text className={`text-label-sm ${connected ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
                    {connected ? 'Connected' : 'Disconnected'}
                  </Text>
                  {connected ? (
                    <Pressable
                      onPress={() => setView({ manage: item.name })}
                      className="border border-outline-variant rounded-lg px-3.5 py-1.5"
                    >
                      <Text className="text-label-sm text-on-surface-variant">Manage →</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => Linking.openURL(oauthStartUrl(item.name))}
                      className="bg-primary rounded-lg px-3.5 py-1.5"
                    >
                      <Text className="text-label-sm text-on-primary">Connect</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text className="text-headline-md text-on-surface font-bold mb-4">Settings</Text>
      <Pressable
        onPress={() => setView('integrations')}
        className="bg-surface border border-outline-variant rounded-lg px-4 py-3.5 flex-row items-center justify-between"
      >
        <Text className="text-body-md text-on-surface">Integrations</Text>
        <Text className="text-on-surface-variant">→</Text>
      </Pressable>
      <Text className="text-body-sm text-on-surface-variant mt-4">More settings coming in Phase 4.</Text>
    </View>
  );
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View className="flex-row items-center gap-2 mb-3">
      <Pressable onPress={onBack} className="px-1 py-1">
        <Text className="text-primary text-body-md">← Back</Text>
      </Pressable>
      <Text className="text-headline-md text-on-surface font-bold">{title}</Text>
    </View>
  );
}

function ManageScreen({
  source,
  state,
  onBack,
}: {
  source: ManageSource;
  state: ReturnType<typeof useAppState>;
  onBack: () => void;
}) {
  const label = INTEGRATIONS.find((i) => i.name === source)?.label ?? source;
  return (
    <View>
      <BackHeader title={label} onBack={onBack} />
      {source === 'gmail' && <GmailTab state={state} />}
      {source === 'google_calendar' && <CalendarTab state={state} />}
      {source === 'github' && <GitHubTab state={state} />}
      {source === 'sms' && <SmsTab state={state} />}
      {source === 'photo' && <PhotoTab state={state} />}
    </View>
  );
}

import React, { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, Text, Linking, TextInput } from 'react-native';
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
import { MemoryTab } from './tabs/MemoryTab';
import { SkillTab } from './tabs/SkillTab';
import { ChatTab } from './tabs/ChatTab';
import { AiSettingsForm } from './components/AiSettingsForm';
import { AutoReplyForm } from './components/AutoReplyForm';
import { OnboardingWizard } from './components/OnboardingWizard';
import { TabIcon } from './components/TabIcon';
import type { TabIconName } from './components/TabIcon';

type BottomTab = 'ai' | 'skill' | 'memory' | 'settings';
type ManageSource = 'gmail' | 'google_calendar' | 'github' | 'sms' | 'photo';
type SettingsSection = 'ai' | 'autoreply' | 'activity' | 'support';
type SettingsView = 'root' | 'integrations' | { manage: ManageSource } | { section: SettingsSection };

const PRIMARY_COLOR = '#006b5a';
const ON_SURFACE_VARIANT_COLOR = '#3d4945';

const BOTTOM_TABS: { key: BottomTab; label: string; icon: TabIconName }[] = [
  { key: 'ai', label: 'Chat', icon: 'chat' },
  { key: 'skill', label: 'Skill', icon: 'bolt' },
  { key: 'memory', label: 'Memory', icon: 'database' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

const INTEGRATIONS: { name: ManageSource; label: string; subtitle: string; isNative: boolean }[] = [
  { name: 'sms', label: 'SMS (Android)', subtitle: 'Messages via Android bridge', isNative: true },
  { name: 'photo', label: 'Photos & Gallery', subtitle: 'EXIF stripping ON by default', isNative: true },
  { name: 'gmail', label: 'Gmail', subtitle: '', isNative: false },
  { name: 'google_calendar', label: 'Google Calendar', subtitle: '', isNative: false },
  { name: 'github', label: 'GitHub', subtitle: '', isNative: false },
];

const SETTINGS_SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: 'ai', label: 'AI Settings' },
  { key: 'autoreply', label: 'SMS Auto-Reply' },
  { key: 'activity', label: 'Activity Log' },
  { key: 'support', label: 'Support' },
];

export function App() {
  const state = useAppState();
  const [activeTab, setActiveTab] = useState<BottomTab>('ai');
  const [settingsView, setSettingsView] = useState<SettingsView>('root');
  const insets = useSafeAreaInsets();

  useSmsAutoReply(state.autoReplyEnabled, state.aiAvailable);

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

  const goToSettings = useCallback(() => {
    setActiveTab('settings');
    setSettingsView('root');
  }, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScrollView className="flex-1 p-4">
        {activeTab === 'ai' && <ChatTab state={state} onGoToSettings={goToSettings} />}
        {activeTab === 'skill' && <SkillTab state={state} />}
        {activeTab === 'memory' && <MemoryTab state={state} />}
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
            className="px-3 py-1 items-center gap-0.5"
          >
            <TabIcon name={t.icon} color={activeTab === t.key ? PRIMARY_COLOR : ON_SURFACE_VARIANT_COLOR} />
            <Text className={`text-label-sm ${activeTab === t.key ? 'text-primary font-bold' : 'text-on-surface-variant'}`}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <OnboardingWizard state={state} />
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
  if (typeof view === 'object' && 'manage' in view) {
    return <ManageScreen source={view.manage} state={state} onBack={() => setView('integrations')} />;
  }

  if (typeof view === 'object' && 'section' in view) {
    return <SettingsSectionScreen section={view.section} state={state} onBack={() => setView('root')} />;
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
      <View className="gap-2.5">
        {SETTINGS_SECTIONS.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => setView({ section: s.key })}
            className="bg-surface border border-outline-variant rounded-lg px-4 py-3.5 flex-row items-center justify-between"
          >
            <Text className="text-body-md text-on-surface">{s.label}</Text>
            <Text className="text-on-surface-variant">→</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setView('integrations')}
          className="bg-surface border border-outline-variant rounded-lg px-4 py-3.5 flex-row items-center justify-between"
        >
          <Text className="text-body-md text-on-surface">Integrations</Text>
          <Text className="text-on-surface-variant">→</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SettingsSectionScreen({
  section,
  state,
  onBack,
}: {
  section: SettingsSection;
  state: ReturnType<typeof useAppState>;
  onBack: () => void;
}) {
  const label = SETTINGS_SECTIONS.find((s) => s.key === section)?.label ?? section;
  return (
    <View>
      <BackHeader title={label} onBack={onBack} />
      {section === 'ai' && <AiSettingsForm state={state} />}
      {section === 'autoreply' && <AutoReplyForm state={state} />}
      {section === 'activity' && <ActivityLog state={state} />}
      {section === 'support' && <SupportSection state={state} />}
    </View>
  );
}

function ActivityLog({ state }: { state: ReturnType<typeof useAppState> }) {
  React.useEffect(() => {
    state.loadAuditLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.auditLoading && state.auditLog.length === 0) {
    return <Text className="text-on-surface-variant text-body-sm">Loading…</Text>;
  }
  if (state.auditLog.length === 0) {
    return <Text className="text-on-surface-variant text-body-sm">No activity has been logged yet.</Text>;
  }
  return (
    <View className="gap-2">
      {state.auditLog.map((e, i) => (
        <View key={i} className="border border-outline-variant rounded-lg p-3 bg-surface gap-0.5">
          <View className="flex-row justify-between">
            <Text className="text-label-sm font-semibold text-on-surface">{e.event}</Text>
            <Text className="text-label-sm text-on-surface-variant">{new Date(e.timestamp).toLocaleString()}</Text>
          </View>
          {e.source ? <Text className="text-label-sm text-on-surface-variant">source: {e.source}</Text> : null}
          <Text className="text-label-sm text-on-surface-variant" numberOfLines={3}>{e.details}</Text>
        </View>
      ))}
    </View>
  );
}

const BUG_REPORT_REPO = 'AISmithLab/PersonalDataHub';

function SupportSection({ state }: { state: ReturnType<typeof useAppState> }) {
  const [bugReport, setBugReport] = useState('');

  const reportBug = () => {
    const url =
      `https://github.com/${BUG_REPORT_REPO}/issues/new` +
      `?title=${encodeURIComponent('Bug report')}&body=${encodeURIComponent(bugReport)}`;
    Linking.openURL(url);
  };

  return (
    <View className="gap-4" style={{ maxWidth: 480 }}>
      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">What went wrong?</Text>
        <TextInput
          value={bugReport}
          onChangeText={setBugReport}
          placeholder="Describe the issue…"
          multiline
          className="border border-outline-variant rounded-lg p-3 text-body-sm"
          style={{ minHeight: 80 }}
        />
      </View>
      <Pressable onPress={reportBug} className="self-start border border-outline-variant rounded-lg px-4 py-2">
        <Text className="text-on-surface-variant text-label-caps">Report a Bug on GitHub</Text>
      </Pressable>
      <Pressable onPress={state.replayOnboarding} className="self-start border border-outline-variant rounded-lg px-4 py-2">
        <Text className="text-on-surface-variant text-label-caps">Replay Onboarding</Text>
      </Pressable>
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

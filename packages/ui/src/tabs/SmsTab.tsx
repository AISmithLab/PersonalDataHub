import React, { useEffect } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppState } from '../hooks/useAppState';
import type { SmsMsg } from '../device/deviceBridge.types';

function formatRelativeDate(dateMs: number): string {
  const date = new Date(dateMs);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.round(diffMs / 60000)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 48) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const BOXES: Array<'inbox' | 'sent' | 'all'> = ['inbox', 'sent', 'all'];

export function SmsTab({ state }: { state: AppState }) {
  useEffect(() => {
    state.loadContacts();
    state.loadSmsMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View className="bg-surface rounded-lg border border-outline-variant overflow-hidden">
      <View className="flex-row items-center justify-between px-5 py-4 border-b border-outline-variant">
        <View className="flex-row items-center gap-2.5">
          <Text className="text-headline-md text-on-surface font-bold">SMS Messages</Text>
          {state.sms ? (
            <Text className="text-body-sm text-on-surface-variant">({state.sms.length})</Text>
          ) : null}
        </View>
        <Pressable onPress={() => state.loadSmsMessages(true)} className="border border-outline-variant rounded-lg px-3 py-1.5">
          <Text className="text-label-sm text-on-surface-variant">Refresh</Text>
        </Pressable>
      </View>

      <View className="flex-row gap-1.5 px-5 py-3 border-b border-outline-variant">
        {BOXES.map((b) => (
          <Pressable
            key={b}
            onPress={() => state.changeSmsBox(b)}
            className={`rounded-lg px-3.5 py-1.5 border ${
              state.smsBox === b ? 'bg-primary border-primary' : 'border-outline-variant'
            }`}
          >
            <Text className={`text-label-sm capitalize ${state.smsBox === b ? 'text-on-primary' : 'text-on-surface-variant'}`}>
              {b}
            </Text>
          </Pressable>
        ))}
      </View>

      <SmsList state={state} />
      <SmsContextMenuModal state={state} />
    </View>
  );
}

function SmsList({ state }: { state: AppState }) {
  if (state.smsLoading) {
    return (
      <View className="p-10 items-center">
        <Text className="text-on-surface-variant text-body-sm">Loading messages…</Text>
      </View>
    );
  }

  if (state.smsError) {
    if (state.smsError === 'PERMISSION_DENIED') {
      return (
        <View className="p-8 items-center">
          <Text className="text-body-md text-on-surface font-semibold mb-1.5">SMS Permission Required</Text>
          <Text className="text-body-sm text-on-surface-variant mb-4 text-center">
            Grant SMS permission in Android Settings to read messages.
          </Text>
          <Pressable onPress={() => state.loadSmsMessages(true)} className="bg-primary rounded-lg px-4 py-2">
            <Text className="text-on-primary text-label-sm">Request Permission</Text>
          </Pressable>
        </View>
      );
    }
    if (state.smsError === 'NOT_ANDROID') {
      return (
        <View className="p-8 items-center">
          <Text className="text-on-surface-variant text-body-sm">SMS reading is only available on Android.</Text>
        </View>
      );
    }
    return (
      <View className="p-6">
        <Text className="text-error text-body-sm">Error: {state.smsError}</Text>
        <Pressable onPress={() => state.loadSmsMessages(true)} className="border border-outline-variant rounded-lg px-3 py-1.5 mt-3 self-start">
          <Text className="text-label-sm text-on-surface-variant">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!state.sms) {
    return (
      <View className="p-10 items-center">
        <Text className="text-on-surface-variant text-body-sm">Loading…</Text>
      </View>
    );
  }

  if (state.sms.length === 0) {
    return (
      <View className="p-8 items-center">
        <Text className="text-on-surface-variant text-body-sm">No messages in {state.smsBox}.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ maxHeight: 480 }}>
      {state.sms.map((msg: SmsMsg) => (
        <SmsRow key={msg.id} msg={msg} state={state} />
      ))}
    </ScrollView>
  );
}

function SmsRow({ msg, state }: { msg: SmsMsg; state: AppState }) {
  const unread = !msg.read;
  const body = msg.body || '';
  const snippet = body.length > 80 ? `${body.substring(0, 80)}…` : body;

  return (
    <Pressable
      onLongPress={() => state.showSmsContextMenu(msg.address, body)}
      delayLongPress={500}
      className="flex-row items-start gap-2.5 px-5 py-3 border-b border-outline-variant"
    >
      {unread ? <View className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" /> : <View className="w-1.5" />}
      <View className="flex-1">
        <View className="flex-row justify-between items-baseline">
          <Text className="text-body-sm font-semibold text-on-surface">{state.formatContact(msg.address) || 'Unknown'}</Text>
          <Text className="text-label-sm text-on-surface-variant">{formatRelativeDate(msg.date)}</Text>
        </View>
        <Text className="text-body-sm text-on-surface-variant mt-0.5">{snippet}</Text>
      </View>
    </Pressable>
  );
}

function SmsContextMenuModal({ state }: { state: AppState }) {
  const insets = useSafeAreaInsets();
  const cm = state.smsContextMenu;

  return (
    <Modal visible={!!cm} transparent animationType="slide" onRequestClose={state.hideSmsContextMenu}>
      <Pressable className="flex-1 bg-black/45 justify-end" onPress={state.hideSmsContextMenu}>
        {cm ? (
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="bg-surface rounded-t-2xl p-5"
            style={{ paddingBottom: 20 + insets.bottom }}
          >
            <View className="w-9 h-1 bg-outline-variant rounded self-center mb-4" />
            <Text className="text-body-md font-semibold text-on-surface mb-0.5">{cm.address}</Text>
            <Text className="text-body-sm text-on-surface-variant mb-3" numberOfLines={1}>
              {(cm.body || '').slice(0, 60)}
            </Text>

            {cm.status === 'thinking' && (
              <Text className="text-on-surface-variant text-body-sm py-3.5">Generating reply…</Text>
            )}
            {cm.status === 'sending' && (
              <View className="py-3.5">
                <Text className="text-label-sm text-on-surface-variant mb-1.5">Sending:</Text>
                <Text className="text-body-sm italic text-on-surface">"{cm.reply}"</Text>
              </View>
            )}
            {cm.status === 'sent' && <Text className="text-body-sm text-primary py-3.5">✓ Reply sent</Text>}
            {cm.status === 'error' && (
              <Text className="text-body-sm text-error py-3.5">{cm.error || 'Error'}</Text>
            )}

            {(!cm.status || cm.status === 'error') && (
              <Pressable onPress={state.manualAutoReply} className="bg-primary rounded-lg py-2.5 items-center mb-2.5">
                <Text className="text-on-primary text-label-sm">Reply automatically</Text>
              </Pressable>
            )}
            <Pressable onPress={state.hideSmsContextMenu} className="border border-outline-variant rounded-lg py-2.5 items-center">
              <Text className="text-on-surface-variant text-label-sm">
                {cm.status === 'sent' || cm.status === 'error' ? 'Close' : 'Cancel'}
              </Text>
            </Pressable>
          </Pressable>
        ) : (
          <View />
        )}
      </Pressable>
    </Modal>
  );
}

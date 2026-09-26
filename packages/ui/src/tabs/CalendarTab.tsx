import React from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import { oauthStartUrl } from '../api/client';
import { FilterCards } from '../components/FilterCards';

export function CalendarTab({ state }: { state: AppState }) {
  const cal = state.sources.find((s) => s.name === 'google_calendar');
  const calConnected = !!cal?.connected;
  const accountEmail = cal?.accountInfo?.email ?? '';

  const calFilters = state.filters.filter((f) => f.source === 'google_calendar');
  const calStaging = state.staging.filter((a) => a.source === 'google_calendar');
  const pendingCount = calStaging.filter((a) => a.status === 'pending').length;
  const events = (state.events ?? []).slice().sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

  if (!calConnected) {
    return (
      <View className="max-w-[480px] mt-16 mx-auto items-center">
        <Text className="text-headline-md text-on-surface font-bold mb-2">Calendar</Text>
        <Text className="text-body-sm text-on-surface-variant mb-1 text-center">
          Connect your Google Calendar account to control agent access to your events.
        </Text>
        <Text className="text-body-sm text-on-surface-variant mb-6 text-center opacity-70">
          Powered by OAuth — we never store your password.
        </Text>
        <Pressable
          onPress={() => Linking.openURL(oauthStartUrl('google_calendar'))}
          className="bg-primary rounded-lg px-4 py-2.5"
        >
          <Text className="text-on-primary font-label-caps text-label-caps">Connect Calendar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <View className="flex-row items-start justify-between mb-6">
        <View>
          <Text className="text-headline-md text-on-surface font-bold">Calendar</Text>
          {accountEmail ? <Text className="text-body-sm text-on-surface-variant mt-0.5">{accountEmail}</Text> : null}
        </View>
        <Pressable
          onPress={() => state.disconnectSource('google_calendar')}
          className="border border-error/30 rounded-lg px-3 py-1.5"
        >
          <Text className="text-error text-label-sm">Disconnect</Text>
        </Pressable>
      </View>

      <View className="bg-surface rounded-lg border border-outline-variant p-5 mb-4">
        <Text className="text-label-sm text-on-surface-variant uppercase mb-3.5">Quick Filters</Text>
        <FilterCards
          source="google_calendar"
          filters={calFilters}
          filterTypes={state.filterTypes}
          onToggle={state.toggleFilter}
          onValueChange={state.updateFilterValue}
        />
      </View>

      <View className="flex-row gap-4">
        <View className="flex-1">
          <View className="flex-row items-center gap-2 mb-2">
            <Text className="text-headline-md text-on-surface">Agent Access Preview</Text>
          </View>
          <View className="bg-surface rounded-lg border border-outline-variant overflow-hidden">
            <View className="flex-row items-center px-3 py-2 border-b border-outline-variant">
              <Text className="text-body-sm text-on-surface-variant">Showing: {events.length} events</Text>
              {state.events && (
                <Pressable onPress={state.refreshEvents} className="ml-auto border border-outline-variant rounded px-2.5 py-0.5">
                  <Text className="text-label-sm text-on-surface-variant">Refresh</Text>
                </Pressable>
              )}
            </View>
            {state.eventsLoading ? (
              <View className="p-10 items-center">
                <Text className="text-on-surface-variant text-body-sm">Loading events...</Text>
              </View>
            ) : state.eventsError ? (
              <View className="p-10 items-center">
                <Text className="text-error text-body-sm">Error: {state.eventsError}</Text>
                <Pressable onPress={state.refreshEvents} className="bg-primary rounded-lg px-4 py-2 mt-3">
                  <Text className="text-on-primary text-label-sm">Retry</Text>
                </Pressable>
              </View>
            ) : events.length ? (
              events.map((ev) => <EventRow key={ev.id} event={ev} />)
            ) : (
              <Text className="text-on-surface-variant text-body-sm p-10 text-center">No events found.</Text>
            )}
          </View>
        </View>

        <View className="flex-1">
          <View className="flex-row items-center gap-2 mb-2">
            <Text className="text-headline-md text-on-surface">Agent Action Review</Text>
            {pendingCount ? (
              <View className="bg-primary rounded-full px-2 py-0.5">
                <Text className="text-on-primary text-label-sm">{pendingCount}</Text>
              </View>
            ) : null}
          </View>
          {calStaging.length ? (
            calStaging.map((a) => (
              <ActionCard
                key={a.action_id}
                action={a}
                onReject={() => state.resolveAction(a.action_id, 'reject')}
                onApprove={() => state.approveAction(a.action_id)}
              />
            ))
          ) : (
            <View className="bg-surface rounded-lg border border-outline-variant p-6 items-center">
              <Text className="text-on-surface-variant text-body-sm">No pending actions.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function EventRow({ event }: { event: import('../api/client').CalendarEvent }) {
  const dt = new Date(event.start);
  const timeStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <View className="border-b border-outline-variant px-3 py-3">
      <View className="flex-row items-center gap-2">
        <Text className="text-on-surface font-semibold text-body-sm">{event.title}</Text>
        <Text className="text-on-surface-variant text-label-sm ml-auto">{timeStr}</Text>
      </View>
      {event.location ? <Text className="text-on-surface-variant text-label-sm mt-0.5">{event.location}</Text> : null}
      {event.body ? <Text className="text-on-surface-variant text-body-sm mt-0.5">{event.body}</Text> : null}
    </View>
  );
}

function ActionCard({
  action,
  onReject,
  onApprove,
}: {
  action: import('../api/client').StagingAction;
  onReject: () => void;
  onApprove: () => void;
}) {
  const data = typeof action.action_data === 'string' ? JSON.parse(action.action_data) : action.action_data;
  const isPending = action.status === 'pending';
  const typeLabel = action.action_type.replace('_event', '');
  const time = new Date(action.proposed_at || action.createdAt || Date.now());
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const borderColor =
    isPending ? 'border-l-warning' : action.status === 'approved' ? 'border-l-primary opacity-60' : 'border-l-error opacity-60';

  return (
    <View className={`bg-surface rounded-lg border border-outline-variant border-l-4 ${borderColor} p-4 mb-3`}>
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-label-sm uppercase font-mono-label">{action.status}</Text>
          <Text className="text-label-sm uppercase font-mono-label text-on-surface-variant">{typeLabel}</Text>
        </View>
        <Text className="text-label-sm font-mono-label text-on-surface-variant">{timeStr}</Text>
      </View>
      {action.purpose ? <Text className="text-body-sm text-on-surface-variant mb-2">{action.purpose}</Text> : null}
      <View className="gap-1">
        <Field label="Event:" value={data.title || ''} />
        {data.start ? <Field label="Start:" value={new Date(data.start).toLocaleString()} /> : null}
      </View>
      {isPending && (
        <View className="flex-row items-center gap-1.5 mt-3">
          <Pressable onPress={onReject} className="border border-error/30 rounded px-2.5 py-1">
            <Text className="text-label-sm text-error">Deny</Text>
          </Pressable>
          <Pressable onPress={onApprove} className="bg-primary rounded px-2.5 py-1">
            <Text className="text-label-sm text-on-primary">Approve</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-2">
      <Text className="text-on-surface-variant text-label-sm w-16">{label}</Text>
      <Text className="text-on-surface text-body-sm flex-1">{value}</Text>
    </View>
  );
}

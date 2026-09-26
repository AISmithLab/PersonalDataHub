import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, Linking } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import { oauthStartUrl } from '../api/client';
import { FilterCards } from '../components/FilterCards';

export function GmailTab({ state }: { state: AppState }) {
  const gmail = state.sources.find((s) => s.name === 'gmail');
  const gmailConnected = !!gmail?.connected;
  const gmailAccount = gmail?.accountInfo;
  const accountEmail = gmailAccount?.email ?? '';

  const gmailFilters = state.filters.filter((f) => f.source === 'gmail');
  const gmailStaging = state.staging.filter((a) => a.source === 'gmail');
  const pendingCount = gmailStaging.filter((a) => a.status === 'pending').length;
  const emails = state.emails ?? [];

  if (!gmailConnected) {
    return (
      <View className="max-w-[480px] mt-16 mx-auto items-center">
        <Text className="text-headline-md text-on-surface font-bold mb-2">Gmail</Text>
        <Text className="text-body-sm text-on-surface-variant mb-1 text-center">
          Connect your Gmail account to browse and control agent access to your emails.
        </Text>
        <Text className="text-body-sm text-on-surface-variant mb-6 text-center opacity-70">
          Powered by OAuth — we never store your password.
        </Text>
        <Pressable
          onPress={() => Linking.openURL(oauthStartUrl('gmail'))}
          className="bg-primary rounded-lg px-4 py-2.5"
        >
          <Text className="text-on-primary font-label-caps text-label-caps">Connect Gmail</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <View className="flex-row items-start justify-between mb-6">
        <View>
          <Text className="text-headline-md text-on-surface font-bold">Gmail</Text>
          {accountEmail ? <Text className="text-body-sm text-on-surface-variant mt-0.5">{accountEmail}</Text> : null}
        </View>
        <Pressable
          onPress={() => state.disconnectSource('gmail')}
          className="border border-error/30 rounded-lg px-3 py-1.5"
        >
          <Text className="text-error text-label-sm">Disconnect</Text>
        </Pressable>
      </View>

      <View className="bg-surface rounded-lg border border-outline-variant p-5 mb-4">
        <Text className="text-label-sm text-on-surface-variant uppercase mb-3.5">Quick Filters</Text>
        <FilterCards
          source="gmail"
          filters={gmailFilters}
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
              <Text className="text-body-sm text-on-surface-variant">Showing: {emails.length} emails</Text>
              {state.emails && (
                <Pressable onPress={state.refreshEmails} className="ml-auto border border-outline-variant rounded px-2.5 py-0.5">
                  <Text className="text-label-sm text-on-surface-variant">Refresh</Text>
                </Pressable>
              )}
            </View>
            {state.emailsLoading ? (
              <View className="p-10 items-center">
                <Text className="text-on-surface-variant text-body-sm">Loading emails from Gmail...</Text>
              </View>
            ) : state.emailsError ? (
              <View className="p-10 items-center">
                <Text className="text-error text-body-sm">Error: {state.emailsError}</Text>
                <Pressable onPress={state.refreshEmails} className="bg-primary rounded-lg px-4 py-2 mt-3">
                  <Text className="text-on-primary text-label-sm">Retry</Text>
                </Pressable>
              </View>
            ) : emails.length ? (
              emails.map((em) => (
                <EmailRow
                  key={em.id}
                  email={em}
                  expanded={state.expandedEmail === em.id}
                  onPress={() => state.toggleEmailExpand(em.id)}
                />
              ))
            ) : (
              <Text className="text-on-surface-variant text-body-sm p-10 text-center">No emails found.</Text>
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
          {gmailStaging.length ? (
            gmailStaging.map((a) => (
              <ActionCard
                key={a.action_id}
                action={a}
                editing={state.editingAction === a.action_id}
                onToggleEdit={() => state.toggleEditAction(a.action_id)}
                onReject={() => state.resolveAction(a.action_id, 'reject')}
                onApprove={(edits) => state.approveAction(a.action_id, edits)}
                onSend={(edits) => state.sendAction(a.action_id, edits)}
              />
            ))
          ) : (
            <View className="bg-surface rounded-lg border border-outline-variant p-6 items-center">
              <Text className="text-on-surface-variant text-body-sm">No pending actions from agents.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function EmailRow({
  email,
  expanded,
  onPress,
}: {
  email: import('../api/client').GmailEmail;
  expanded: boolean;
  onPress: () => void;
}) {
  const dt = new Date(email.date);
  const timeStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <View className="border-b border-outline-variant">
      <Pressable onPress={onPress} className="px-3 py-3">
        <View className="flex-row items-center gap-2">
          <Text className="text-on-surface font-semibold text-body-sm">{email.from}</Text>
          <Text className="text-on-surface-variant text-label-sm ml-auto">{timeStr}</Text>
        </View>
        <Text className="text-on-surface text-body-sm mt-0.5">{email.subject}</Text>
        {email.snippet ? <Text className="text-on-surface-variant text-body-sm mt-0.5">{email.snippet}</Text> : null}
        {email.labels?.length ? (
          <View className="flex-row flex-wrap gap-1 mt-1.5">
            {email.labels.map((l) => (
              <View key={l} className="bg-surface-container rounded px-1.5 py-0.5">
                <Text className="text-label-sm text-on-surface-variant">{l}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
      {expanded && (
        <View className="px-3 pb-3 gap-1">
          <Field label="From" value={email.from} />
          <Field label="To" value={email.to} />
          <Field label="Subject" value={email.subject} />
          {email.labels?.length ? <Field label="Labels" value={email.labels.join(', ')} /> : null}
          <View className="bg-surface-container-low rounded p-2 mt-1">
            <Text className="text-body-sm text-on-surface">{email.body}</Text>
          </View>
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

function ActionCard({
  action,
  editing,
  onToggleEdit,
  onReject,
  onApprove,
  onSend,
}: {
  action: import('../api/client').StagingAction;
  editing: boolean;
  onToggleEdit: () => void;
  onReject: () => void;
  onApprove: (edits?: Record<string, unknown>) => void;
  onSend: (edits: Record<string, unknown>) => void;
}) {
  const data =
    typeof action.action_data === 'string' ? JSON.parse(action.action_data) : action.action_data;
  const isPending = action.status === 'pending';
  const [to, setTo] = useState(data.to ?? '');
  const [subject, setSubject] = useState(data.subject ?? '');
  const [body, setBody] = useState(data.body ?? '');
  const typeLabel = action.action_type === 'reply_email' ? 'reply' : action.action_type === 'draft_email' ? 'draft' : action.action_type;
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

      {!editing ? (
        <Pressable onPress={onToggleEdit} className="gap-1">
          <Field label="To:" value={data.to || ''} />
          <Field label="Subj:" value={data.subject || ''} />
          <Text className="text-body-sm text-on-surface bg-surface-container-low rounded p-2" numberOfLines={3}>
            {data.body || ''}
          </Text>
        </Pressable>
      ) : (
        <View className="gap-1.5">
          <View className="flex-row items-center gap-2">
            <Text className="text-on-surface-variant text-label-sm w-16">To:</Text>
            <TextInput value={to} onChangeText={setTo} className="flex-1 border border-outline-variant rounded px-2 py-1 text-body-sm font-mono-label" />
          </View>
          <View className="flex-row items-center gap-2">
            <Text className="text-on-surface-variant text-label-sm w-16">Subj:</Text>
            <TextInput value={subject} onChangeText={setSubject} className="flex-1 border border-outline-variant rounded px-2 py-1 text-body-sm font-mono-label" />
          </View>
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            className="border border-outline-variant rounded px-2 py-1 text-body-sm font-mono-label"
            style={{ minHeight: 120 }}
          />
        </View>
      )}

      {isPending && (
        <View className="flex-row items-center gap-1.5 mt-3">
          {!editing ? (
            <Pressable onPress={onToggleEdit} className="border border-outline-variant rounded px-2.5 py-1">
              <Text className="text-label-sm">Review</Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={onReject} className="border border-error/30 rounded px-2.5 py-1">
                <Text className="text-label-sm text-error">Deny</Text>
              </Pressable>
              <Pressable onPress={() => onApprove({ to, subject, body })} className="bg-primary rounded px-2.5 py-1">
                <Text className="text-label-sm text-on-primary">Save to Draft</Text>
              </Pressable>
              <Pressable onPress={() => onSend({ to, subject, body })} className="bg-primary rounded px-2.5 py-1">
                <Text className="text-label-sm text-on-primary">Send</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

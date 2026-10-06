import React from 'react';
import { View, Text } from 'react-native';
import type { ChatMessage, ToolOutput } from '../api/client';

interface TextPart {
  type: 'text';
  content: string;
}
interface CodePart {
  type: 'code';
  lang: string;
  code: string;
}

function splitCodeBlocks(content: string): (TextPart | CodePart)[] {
  const parts: (TextPart | CodePart)[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    parts.push({ type: 'code', lang: match[1] || 'text', code: match[2] });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < content.length) parts.push({ type: 'text', content: content.slice(lastIndex) });
  return parts;
}

export function MessageContent({ message }: { message: ChatMessage }) {
  const parts = splitCodeBlocks(message.content || '');
  return (
    <View className="gap-2">
      {parts.map((p, i) =>
        p.type === 'text' ? (
          p.content.trim() ? <Text key={i} className="text-body-md text-on-surface">{p.content}</Text> : null
        ) : (
          <View key={i} className="rounded-lg overflow-hidden border border-outline-variant">
            <View className="flex-row justify-between px-2.5 py-1.5 bg-surface-container">
              <Text className="text-label-sm text-on-surface-variant">{p.lang}</Text>
            </View>
            <View className="bg-surface-container-low p-2.5">
              <Text className="text-label-sm text-on-surface" style={{ fontFamily: 'monospace' }}>{p.code}</Text>
            </View>
          </View>
        )
      )}
      {(message.toolOutputs ?? []).map((to, i) => (
        <ToolOutputCard key={i} toolOutput={to} />
      ))}
    </View>
  );
}

function ToolOutputCard({ toolOutput }: { toolOutput: ToolOutput }) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(toolOutput.output);
  } catch {
    // leave parsed null, raw output shown for run_code below
  }

  if (toolOutput.name === 'read_photos') {
    const photos = Array.isArray(parsed) ? (parsed as { id?: string; title?: string; album?: string; date?: string }[]) : [];
    if (!photos.length) return <Text className="text-label-sm text-on-surface-variant">No photos matched.</Text>;
    return (
      <View className="border border-outline-variant rounded-lg p-3 bg-surface-container-low gap-2">
        <View className="flex-row justify-between">
          <Text className="text-label-sm font-semibold text-on-surface">Gallery Photos ({photos.length})</Text>
          <Text className="text-label-sm text-primary">EXIF Stripped</Text>
        </View>
        {photos.slice(0, 4).map((p, i) => (
          <View key={p.id ?? i} className="border border-outline-variant rounded p-2 bg-surface">
            <Text className="text-label-sm font-semibold text-primary">{p.title || 'Photo'}</Text>
            <View className="flex-row justify-between">
              <Text className="text-label-sm text-on-surface-variant">{p.album || 'Gallery'}</Text>
              <Text className="text-label-sm text-on-surface-variant">{p.date ? new Date(p.date).toLocaleDateString() : ''}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (toolOutput.name === 'read_emails') {
    const emails = Array.isArray(parsed) ? (parsed as { from?: string; subject?: string; snippet?: string; date?: string }[]) : [];
    if (!emails.length) return <Text className="text-label-sm text-on-surface-variant">No emails matched.</Text>;
    return (
      <View className="gap-2">
        {emails.slice(0, 3).map((e, i) => (
          <View key={i} className="border border-outline-variant rounded-lg p-3 bg-surface gap-1">
            <View className="flex-row justify-between">
              <Text className="text-label-sm font-semibold text-on-surface">{e.from || 'Unknown'}</Text>
              <Text className="text-label-sm text-on-surface-variant">{e.date ? new Date(e.date).toLocaleDateString() : ''}</Text>
            </View>
            <Text className="text-label-sm font-bold text-on-surface">{e.subject || '(no subject)'}</Text>
            <Text className="text-label-sm text-on-surface-variant" numberOfLines={2}>{e.snippet || ''}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (toolOutput.name === 'draft_email') {
    const input = toolOutput.input as { to?: string; subject?: string; body?: string };
    return (
      <View className="border border-primary/30 bg-primary/5 rounded-lg p-3 gap-2">
        <Text className="text-label-sm font-bold text-primary uppercase">Staged Email Reply</Text>
        <Text className="text-label-sm text-on-surface-variant">To: {input.to || ''}</Text>
        <Text className="text-label-sm text-on-surface-variant">Subject: {input.subject || ''}</Text>
        <Text className="text-body-sm text-on-surface">{input.body || ''}</Text>
      </View>
    );
  }

  if (toolOutput.name === 'run_code') {
    const result = parsed as { output?: string; error?: string; duration_ms?: number } | null;
    const output = result ? result.output ?? '(no output)' : toolOutput.output;
    const hasError = !!result?.error;
    return (
      <View className="border border-outline-variant rounded-lg overflow-hidden">
        <Text className="text-label-sm text-on-surface-variant px-2.5 py-1.5 bg-surface-container">
          Code ran{result?.duration_ms ? ` · ${result.duration_ms}ms` : ''}{hasError ? ' · error' : ''}
        </Text>
        <View className="bg-surface-container-low p-2.5">
          <Text className={`text-label-sm ${hasError ? 'text-error' : 'text-on-surface'}`} style={{ fontFamily: 'monospace' }}>
            {output}
            {hasError ? `\n[error] ${result?.error}` : ''}
          </Text>
        </View>
      </View>
    );
  }

  return null;
}

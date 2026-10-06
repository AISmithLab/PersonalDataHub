import React from 'react';
import { View, Text, Pressable } from 'react-native';

export const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'groq', label: 'Groq' },
  { value: 'google', label: 'Google' },
  { value: 'ollama', label: 'Ollama' },
] as const;

export const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: '',
  groq: 'https://api.groq.com/openai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  ollama: 'http://localhost:11434/v1',
};

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  groq: 'llama-3.3-70b-versatile',
  google: 'gemini-2.0-flash',
  ollama: 'llama3',
};

export function ProviderPills({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {PROVIDERS.map((p) => {
        const selected = value === p.value;
        return (
          <Pressable
            key={p.value}
            onPress={() => onChange(p.value)}
            className={`px-4 py-1.5 rounded-full ${selected ? 'bg-primary' : 'bg-surface border border-outline-variant'}`}
          >
            <Text className={`text-label-sm font-semibold ${selected ? 'text-on-primary' : 'text-on-surface-variant'}`}>
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

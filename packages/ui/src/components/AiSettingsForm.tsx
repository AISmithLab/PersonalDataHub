import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import { ProviderPills, PROVIDER_BASE_URLS, PROVIDER_DEFAULT_MODELS } from './ProviderPills';

export function AiSettingsForm({ state }: { state: AppState }) {
  const [provider, setProvider] = useState(state.aiProvider);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(state.configuredModel ?? '');
  const [baseUrl, setBaseUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }
    const d = await state.saveAiSettings({
      api_key: apiKey.trim(),
      provider,
      model: model.trim() || undefined,
      base_url: baseUrl.trim() || undefined,
    });
    if (d.ok) {
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError(d.error || 'Unknown error');
    }
  };

  return (
    <View className="gap-4" style={{ maxWidth: 420 }}>
      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">Provider</Text>
        <ProviderPills value={provider} onChange={setProvider} />
      </View>

      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">API Key</Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry
          placeholder={state.aiAvailable ? '•••••••••••• (Configured)' : 'sk-ant-...'}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-md"
        />
      </View>

      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">Model (optional — uses provider default if blank)</Text>
        <TextInput
          value={model}
          onChangeText={setModel}
          placeholder={PROVIDER_DEFAULT_MODELS[provider] ?? 'model name'}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-md"
        />
      </View>

      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">Base URL (optional — uses provider default if blank)</Text>
        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder={PROVIDER_BASE_URLS[provider] || 'https://...'}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-md"
        />
      </View>

      {error ? <Text className="text-error text-body-sm">{error}</Text> : null}

      <View className="flex-row items-center gap-3">
        <Pressable onPress={save} className="bg-primary rounded-lg px-5 py-2.5">
          <Text className="text-on-primary text-label-caps">Save Configuration</Text>
        </Pressable>
        {saved ? <Text className="text-primary text-label-sm">Saved</Text> : null}
        <View className="flex-row items-center gap-1.5">
          <View className={`w-2 h-2 rounded-full ${state.aiAvailable ? 'bg-primary' : 'bg-outline-variant'}`} />
          <Text className={`text-label-sm ${state.aiAvailable ? 'text-primary font-semibold' : 'text-on-surface-variant'}`}>
            {state.aiAvailable ? 'Connected' : 'Not configured'}
          </Text>
        </View>
      </View>
    </View>
  );
}

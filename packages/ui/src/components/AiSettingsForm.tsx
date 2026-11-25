import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import { ProviderPills } from './ProviderPills';
import * as api from '../api/client';

/**
 * Provider, API key and model. The model is a dropdown: "Automatic" (the hub picks a
 * current model and moves on if it is overloaded) plus the models the provider lists
 * for the key. There is no base URL field: each provider's address is known.
 */
export function AiSettingsForm({ state }: { state: AppState }) {
  const [provider, setProvider] = useState(state.aiProvider);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(state.configuredModel ?? '');
  const [models, setModels] = useState<string[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModels = async (forProvider: string, key?: string) => {
    setModelsNote('Loading models…');
    try {
      const d = await api.getAiModels(forProvider, key);
      if (d.ok) {
        setModels(d.models ?? []);
        setModelsNote((d.models ?? []).length ? null : 'Enter the API key to see this provider\'s models.');
      } else {
        setModels([]);
        setModelsNote(`Could not load the model list: ${d.error ?? 'unknown error'}`);
      }
    } catch {
      setModels([]);
      setModelsNote('Could not load the model list.');
    }
  };

  useEffect(() => {
    void loadModels(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeProvider = (next: string) => {
    setProvider(next);
    setModel('');
    setOpen(false);
    void loadModels(next, apiKey.trim() || undefined);
  };

  const save = async () => {
    // The saved key is kept when only the model changes for the saved provider.
    const keepsSavedKey = !apiKey.trim() && state.aiAvailable && provider === state.aiProvider;
    if (!apiKey.trim() && !keepsSavedKey) {
      setError('API key is required');
      return;
    }
    const d = await state.saveAiSettings({ api_key: apiKey.trim(), provider, model: model || undefined });
    if (d.ok) {
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (!models.length) void loadModels(provider, apiKey.trim());
    } else {
      setError(d.error || 'Unknown error');
    }
  };

  const options = ['', ...(model && !models.includes(model) ? [model] : []), ...models];
  const label = (m: string) => (m === '' ? 'Automatic (recommended)' : m);

  return (
    <View className="gap-4" style={{ maxWidth: 420 }}>
      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">Provider</Text>
        <ProviderPills value={provider} onChange={changeProvider} />
      </View>

      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">API Key</Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          onBlur={() => { if (apiKey.trim()) void loadModels(provider, apiKey.trim()); }}
          secureTextEntry
          placeholder={state.aiAvailable ? '•••••••••••• (Configured)' : 'API key'}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-md"
        />
      </View>

      <View className="gap-1.5">
        <Text className="text-label-caps text-on-surface-variant">Model</Text>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`Model: ${label(model)}`}
          className="border border-outline-variant rounded-lg px-3 py-2 flex-row items-center justify-between bg-surface"
        >
          <Text className="text-body-md text-on-surface">{label(model)}</Text>
          <Text className="text-on-surface-variant">{open ? '▴' : '▾'}</Text>
        </Pressable>
        {open ? (
          <View className="border border-outline-variant rounded-lg bg-surface" style={{ maxHeight: 260, overflow: 'scroll' }}>
            {options.map((m) => (
              <Pressable
                key={m || 'auto'}
                onPress={() => { setModel(m); setOpen(false); }}
                className={`px-3 py-2 ${m === model ? 'bg-primary/10' : ''}`}
              >
                <Text className={`text-body-md ${m === model ? 'text-primary font-semibold' : 'text-on-surface'}`}>{label(m)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text className="text-body-sm text-on-surface-variant">
          {modelsNote ?? 'Automatic picks a current model and switches if it is overloaded.'}
        </Text>
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

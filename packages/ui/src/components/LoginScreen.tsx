import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import type { AppState } from '../hooks/useAppState';

/**
 * Shown on the web when nobody is signed in. The first visit creates the single
 * owner account; after that it is a normal sign-in. The phone app never shows
 * this: it authenticates with its device secret.
 */
export function LoginScreen({ state }: { state: AppState }) {
  const creating = !state.hasAccount;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const d = await state.signIn(email.trim(), password, creating);
      if (!d.ok) setError(d.error ?? 'Sign-in failed.');
    } catch {
      setError('Could not reach the hub.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 items-center justify-center p-4 bg-background">
      <View className="w-full bg-surface border border-outline-variant rounded-lg p-5 gap-3" style={{ maxWidth: 380 }}>
        <View className="gap-1">
          <Text className="text-headline-md text-on-surface font-bold">PersonalDataHub</Text>
          <Text className="text-body-sm text-on-surface-variant">
            {creating
              ? 'Create the owner account for this hub. Only this account can change settings and approve actions.'
              : 'Sign in to manage this hub.'}
          </Text>
        </View>

        {error ? (
          <View className="bg-error/10 border border-error/30 rounded-lg p-3">
            <Text className="text-error text-body-sm">{error}</Text>
          </View>
        ) : null}

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-md"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={creating ? 'Password (at least 8 characters)' : 'Password'}
          secureTextEntry
          onSubmitEditing={submit}
          className="border border-outline-variant rounded-lg px-3 py-2 text-body-md"
        />
        <Pressable onPress={submit} disabled={busy} className="bg-primary rounded-lg px-4 py-2.5 items-center">
          <Text className="text-on-primary text-label-caps">
            {busy ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

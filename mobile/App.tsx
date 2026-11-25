import React, { useEffect, useState } from 'react';
import { ActivityIndicator, NativeModules, PermissionsAndroid, Platform, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import nodejs from 'nodejs-mobile-react-native';
import { App as SharedApp, setDeviceSecret } from '@pdh/ui';

const SERVER_URL = 'http://127.0.0.1:3000';
const NODE_ENTRY = Platform.OS === 'ios' ? 'ios.js' : 'android.js';

// Set once the bundled server hands it over; sent on every request to it.
let deviceSecret: string | null = null;

interface IContactsModule { getContacts(): Promise<{ name: string; number: string }[]>; }
const ContactsNative: IContactsModule | null = (NativeModules.ContactsModule as IContactsModule) ?? null;

export default function App() {
  const [serverReady, setServerReady] = useState(false);

  useEffect(() => {
    // The bundled server only answers its owner. It proves we are the owner by a
    // secret it keeps in app-private storage; ask for it over the bridge until it
    // replies (the server may still be starting), then wait for the server itself.
    let secret: string | null = null;
    const onMessage = (msg: unknown) => {
      try {
        const m = JSON.parse(String(msg));
        if (m?.type === 'pdh:device-secret' && typeof m.secret === 'string') {
          secret = m.secret;
          deviceSecret = m.secret;
          setDeviceSecret(m.secret);
        }
      } catch { /* not ours */ }
    };
    nodejs.channel.addListener('message', onMessage);
    nodejs.start(NODE_ENTRY);
    const t = setInterval(() => {
      if (!secret) {
        try { nodejs.channel.send('pdh:get-device-secret'); } catch { /* server not up yet */ }
        return;
      }
      fetch(`${SERVER_URL}/health`)
        .then(r => { if (r.ok) { clearInterval(t); setServerReady(true); } })
        .catch(() => {});
    }, 700);
    return () => {
      clearInterval(t);
      nodejs.channel.removeListener('message', onMessage);
    };
  }, []);

  // Warm the backend's contact cache as soon as the server is up, so name resolution
  // works from the very first SMS auto-reply/memory even before the user opens the
  // SMS tab. Only runs if permission was already granted in a prior session — never
  // prompts here, to avoid surprising the user on launch.
  useEffect(() => {
    if (!serverReady || !ContactsNative || Platform.OS !== 'android') return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS).then(granted => {
      if (granted) ContactsNative!.getContacts().then(syncContactsToServer).catch(() => {});
    });
  }, [serverReady]);

  if (!serverReady) {
    return (
      <View style={s.loading}>
        <StatusBar barStyle="dark-content" backgroundColor="#f7f7ff" />
        <ActivityIndicator size="large" color="#0fa081" />
        <Text style={s.hint}>Starting PersonalDataHub…</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <SharedApp />
    </SafeAreaProvider>
  );
}

// Pushes the device contact list into the backend's in-memory cache so it can resolve
// phone numbers to names when building SMS-reply/memory prompts, without any extra
// tool call at reply time. Fire-and-forget: a stale/missing cache just falls back to
// showing raw phone numbers.
function syncContactsToServer(contacts: { name: string; number: string }[]) {
  fetch(`${SERVER_URL}/web/device/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(deviceSecret ? { 'X-PDH-Device-Secret': deviceSecret } : {}) },
    body: JSON.stringify({ contacts }),
  }).catch(() => {});
}

const s = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, backgroundColor: '#f7f7ff' },
  hint: { fontSize: 14, color: '#5a6b7a' },
});

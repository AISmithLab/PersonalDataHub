import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import nodejs from 'nodejs-mobile-react-native';

const SERVER_URL = 'http://127.0.0.1:3000';
const NODE_ENTRY = Platform.OS === 'ios' ? 'ios.js' : 'android.js';

interface SmsMsg { id: string; address: string; body: string; date: number; type: number; read: boolean; }
interface ISmsModule { getMessages(box: string, limit: number): Promise<SmsMsg[]>; sendMessage(to: string, body: string): Promise<void>; }
const SmsNative: ISmsModule | null = Platform.OS === 'android' ? (NativeModules.SmsModule as ISmsModule) : null;

interface IContactsModule { getContacts(): Promise<{name: string, number: string}[]>; }
const ContactsNative: IContactsModule | null = Platform.OS === 'android' ? (NativeModules.ContactsModule as IContactsModule) : null;

interface PhotoMsg { id: string; title: string; album: string; timestamp: string; uri: string; }
interface IPhotosModule { getPhotos(limit: number): Promise<PhotoMsg[]>; }
const PhotosNative: IPhotosModule | null = Platform.OS === 'android' ? (NativeModules.PhotosModule as IPhotosModule) : null;

// Injected before page scripts: defines window.AndroidSms bridging postMessage → RN
const SMS_BRIDGE = `(function(){
  if(window._pdhBridge)return;
  window._pdhBridge=true;
  window.AndroidSms={
    getMessages:function(id,box,limit){
      window.ReactNativeWebView.postMessage(JSON.stringify({t:'sms_get',id:id,box:box,limit:limit}));
    },
    sendMessage:function(id,to,body){
      window.ReactNativeWebView.postMessage(JSON.stringify({t:'sms_send',id:id,to:to,body:body}));
    },
    getContacts:function(id){
      window.ReactNativeWebView.postMessage(JSON.stringify({t:'contacts_get',id:id}));
    },
    getPhotos:function(id,limit){
      window.ReactNativeWebView.postMessage(JSON.stringify({t:'photos_get',id:id,limit:limit}));
    }
  };
  window._pdhRN=function(m){
    if(m.t==='sms_r')window._smsDeliver&&window._smsDeliver(m.id,m.msgs,m.err||null);
    else if(m.t==='sms_sr')window._smsSendDeliver&&window._smsSendDeliver(m.id,m.err||null);
    else if(m.t==='contacts_r')window._contactsDeliver&&window._contactsDeliver(m.id,m.contacts,m.err||null);
    else if(m.t==='photos_r')window._photosDeliver&&window._photosDeliver(m.id,m.photos,m.err||null);
  };
})();true;`;

export default function App() {
  const [serverReady, setServerReady] = useState(false);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    nodejs.start(NODE_ENTRY);
    const t = setInterval(() => {
      fetch(`${SERVER_URL}/api/auth/status`)
        .then(r => { if (r.status < 500) { clearInterval(t); setServerReady(true); } })
        .catch(() => {});
    }, 700);
    return () => clearInterval(t);
  }, []);

  const inject = useCallback((data: object) => {
    webRef.current?.injectJavaScript(`window._pdhRN(${JSON.stringify(data)});true;`);
  }, []);

  // OAuth (Gmail/Calendar/GitHub) finishes in the system browser, which navigates to
  // pdh://oauth?success=<source>|error=<message>. Android's intent-filter (see
  // AndroidManifest.xml) routes that back into this already-running Activity via
  // onNewIntent, which RN's Linking module surfaces here as a 'url' event.
  const handleOAuthDeepLink = useCallback((url: string) => {
    if (!url.startsWith('pdh://oauth')) return;
    const query = url.split('?')[1] ?? '';
    const params = new URLSearchParams(query);
    const success = params.get('success');
    const error = params.get('error');
    if (!success && !error) return;
    webRef.current?.injectJavaScript(
      `window.handlePdhOAuthDeepLink && window.handlePdhOAuthDeepLink(${JSON.stringify(success)}, ${JSON.stringify(error)});true;`
    );
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => handleOAuthDeepLink(url));
    Linking.getInitialURL().then(url => { if (url) handleOAuthDeepLink(url); }).catch(() => {});
    return () => sub.remove();
  }, [handleOAuthDeepLink]);

  // Warm the backend's contact cache as soon as the server is up, so name resolution
  // works from the very first SMS auto-reply/memory even before the user opens the
  // Contacts tab. Only runs if permission was already granted in a prior session —
  // never prompts here, to avoid surprising the user on launch.
  useEffect(() => {
    if (!serverReady || !ContactsNative || Platform.OS !== 'android') return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS).then(granted => {
      if (granted) ContactsNative!.getContacts().then(syncContactsToServer).catch(() => {});
    });
  }, [serverReady]);

  const onShouldStartLoadWithRequest = useCallback((request: { url: string }) => {
    const { url } = request;
    // OAuth start pages must open in the real browser — Google blocks WebView user agents
    if (url.includes('/oauth/') && url.includes('/start')) {
      Linking.openURL(url).catch(e => console.warn('[PDH] open URL failed:', e));
      return false;
    }
    return true;
  }, []);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }

    if (msg.t === 'sms_get') {
      if (!SmsNative) { inject({ t: 'sms_r', id: msg.id, msgs: null, err: 'PERMISSION_DENIED' }); return; }
      const granted = await requestPerm(PermissionsAndroid.PERMISSIONS.READ_SMS);
      if (!granted) { inject({ t: 'sms_r', id: msg.id, msgs: null, err: 'PERMISSION_DENIED' }); return; }
      SmsNative.getMessages(msg.box as string, msg.limit as number)
        .then(msgs => inject({ t: 'sms_r', id: msg.id, msgs, err: null }))
        .catch((err: Error) => inject({ t: 'sms_r', id: msg.id, msgs: null, err: err.message }));
    } else if (msg.t === 'sms_send') {
      if (!SmsNative) { inject({ t: 'sms_sr', id: msg.id, err: 'PERMISSION_DENIED' }); return; }
      const granted = await requestPerm(PermissionsAndroid.PERMISSIONS.SEND_SMS);
      if (!granted) { inject({ t: 'sms_sr', id: msg.id, err: 'PERMISSION_DENIED' }); return; }
      SmsNative.sendMessage(msg.to as string, msg.body as string)
        .then(() => inject({ t: 'sms_sr', id: msg.id, err: null }))
        .catch((err: Error) => inject({ t: 'sms_sr', id: msg.id, err: err.message }));
    } else if (msg.t === 'contacts_get') {
      const granted = await requestPerm(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
      if (!granted) { inject({ t: 'contacts_r', id: msg.id, contacts: null, err: 'PERMISSION_DENIED' }); return; }
      if (!ContactsNative) return;
      ContactsNative.getContacts()
        .then(contacts => {
          inject({ t: 'contacts_r', id: msg.id, contacts, err: null });
          syncContactsToServer(contacts);
        })
        .catch((err: Error) => inject({ t: 'contacts_r', id: msg.id, contacts: null, err: err.message }));
    } else if (msg.t === 'photos_get') {
      const perm = (Platform.Version as number) >= 33
        ? 'android.permission.READ_MEDIA_IMAGES'
        : 'android.permission.READ_EXTERNAL_STORAGE';
      const granted = await requestPerm(perm);
      if (!granted) { inject({ t: 'photos_r', id: msg.id, photos: null, err: 'PERMISSION_DENIED' }); return; }
      if (!PhotosNative) { inject({ t: 'photos_r', id: msg.id, photos: [], err: null }); return; }
      PhotosNative.getPhotos(msg.limit as number || 50)
        .then(photos => inject({ t: 'photos_r', id: msg.id, photos, err: null }))
        .catch((err: Error) => inject({ t: 'photos_r', id: msg.id, photos: null, err: err.message }));
    }
  }, [inject]);

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
    <View style={s.full}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <WebView
        ref={webRef}
        source={{ uri: SERVER_URL }}
        style={s.full}
        injectedJavaScriptBeforeContentLoaded={SMS_BRIDGE}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        originWhitelist={['*']}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

async function requestPerm(perm: string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const r = await PermissionsAndroid.request(perm);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

// Pushes the device contact list into the backend's in-memory cache so it can resolve
// phone numbers to names when building SMS-reply/memory prompts, without any extra
// tool call at reply time. Fire-and-forget: a stale/missing cache just falls back to
// showing raw phone numbers.
function syncContactsToServer(contacts: { name: string; number: string }[]) {
  fetch(`${SERVER_URL}/device/contacts-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts }),
  }).catch(() => {});
}

const s = StyleSheet.create({
  full: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, backgroundColor: '#f7f7ff' },
  hint: { fontSize: 14, color: '#5a6b7a' },
});

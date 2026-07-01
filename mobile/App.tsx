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
    }
  };
  window._pdhRN=function(m){
    if(m.t==='sms_r')window._smsDeliver&&window._smsDeliver(m.id,m.msgs,m.err||null);
    else if(m.t==='sms_sr')window._smsSendDeliver&&window._smsSendDeliver(m.id,m.err||null);
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
    if (!SmsNative) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }

    if (msg.t === 'sms_get') {
      const granted = await requestPerm(PermissionsAndroid.PERMISSIONS.READ_SMS);
      if (!granted) { inject({ t: 'sms_r', id: msg.id, msgs: null, err: 'PERMISSION_DENIED' }); return; }
      SmsNative.getMessages(msg.box as string, msg.limit as number)
        .then(msgs => inject({ t: 'sms_r', id: msg.id, msgs, err: null }))
        .catch((err: Error) => inject({ t: 'sms_r', id: msg.id, msgs: null, err: err.message }));
    } else if (msg.t === 'sms_send') {
      const granted = await requestPerm(PermissionsAndroid.PERMISSIONS.SEND_SMS);
      if (!granted) { inject({ t: 'sms_sr', id: msg.id, err: 'PERMISSION_DENIED' }); return; }
      SmsNative.sendMessage(msg.to as string, msg.body as string)
        .then(() => inject({ t: 'sms_sr', id: msg.id, err: null }))
        .catch((err: Error) => inject({ t: 'sms_sr', id: msg.id, err: err.message }));
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

const s = StyleSheet.create({
  full: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, backgroundColor: '#f7f7ff' },
  hint: { fontSize: 14, color: '#5a6b7a' },
});

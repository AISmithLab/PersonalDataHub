import { useCallback, useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';

/**
 * Handles `pdh://oauth?success=<source>|error=<message>` deep links, which
 * Android's intent-filter (see AndroidManifest.xml) routes back into the
 * already-running Activity via onNewIntent, surfaced here as RN Linking events.
 * No-op on web (there's no custom-scheme deep link path there — OAuth returns
 * via a normal page redirect instead).
 */
export function useOAuthDeepLink(onResult: (source: string | null, error: string | null) => void) {
  const handleUrl = useCallback(
    (url: string) => {
      if (!url.startsWith('pdh://oauth')) return;
      const query = url.split('?')[1] ?? '';
      const params = new URLSearchParams(query);
      const success = params.get('success');
      const error = params.get('error');
      if (!success && !error) return;
      onResult(success, error);
    },
    [onResult]
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    Linking.getInitialURL()
      .then((url) => {
        if (url) handleUrl(url);
      })
      .catch(() => {});
    return () => sub.remove();
  }, [handleUrl]);
}

export function alertOAuthError(error: string) {
  Alert.alert('OAuth error', error);
}

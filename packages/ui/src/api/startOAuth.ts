import { Alert, Linking, Platform } from 'react-native';
import { getOAuthStartUrl } from './client';

// The shared UI is type-checked without DOM types (it also builds for native).
const browser = globalThis as unknown as { location: { assign(url: string): void }; alert(message: string): void };

/**
 * Starts connecting a source. The hub (owner-only) builds the provider's sign-in
 * URL; we then leave for it. On the web that is a same-tab navigation, because a
 * new tab opened after an await is treated as a popup and blocked.
 */
export async function startOAuth(source: string): Promise<void> {
  let message = 'Could not reach the hub.';
  try {
    const d = await getOAuthStartUrl(source);
    if (d.ok && d.url) {
      if (Platform.OS === 'web') browser.location.assign(d.url);
      else await Linking.openURL(d.url);
      return;
    }
    message = d.error ?? 'The hub did not return a sign-in link.';
  } catch (err) {
    if (err instanceof Error) message = err.message;
  }
  if (Platform.OS === 'web') browser.alert(`Could not start sign-in: ${message}`);
  else Alert.alert('Could not start sign-in', message);
}

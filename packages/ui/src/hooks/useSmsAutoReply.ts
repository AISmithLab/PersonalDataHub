import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api/baseUrl';
import * as api from '../api/client';
import { deviceBridge } from '../device/deviceBridge';

/**
 * Runs independent of any visible tab, mirroring main.js's legacy WebView-side
 * polling: drains queued replies from the drain path (app-was-killed case) and
 * watches the inbox for new messages to auto-reply to. Safe no-op on web/iOS —
 * deviceBridge.getSmsMessages/sendSms reject with NOT_ANDROID there.
 *
 * Gating flags (auto-reply enabled, AI configured) live in Settings/Chat state
 * that isn't ported until Phase 4 — fetched directly here in the meantime,
 * same endpoints main.js already polls (`/api/settings/auto-reply`, `/api/chat/status`).
 */
export function useSmsAutoReply() {
  const lastCheckedMsRef = useRef(Date.now());
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/settings/auto-reply`);
        const d = await r.json();
        if (d.ok) setAutoReplyEnabled(!!d.enabled);
      } catch {
        // non-fatal
      }
      try {
        const r = await fetch(`${API_BASE_URL}/api/chat/status`);
        const d = await r.json();
        if (d.ok) setAiAvailable(!!d.configured);
      } catch {
        // non-fatal
      }
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!autoReplyEnabled) return;
    const drainTimer = setInterval(async () => {
      try {
        const d = await api.getPendingSmsReplies();
        if (!d.ok || !d.replies?.length) return;
        for (const r of d.replies) {
          try {
            await deviceBridge.sendSms(r.to, r.body);
          } catch (err) {
            console.warn('[auto-reply] send error:', err);
          }
          api.deletePendingSmsReply(r.id).catch(() => {});
        }
      } catch {
        // non-fatal
      }
    }, 3000);
    return () => clearInterval(drainTimer);
  }, [autoReplyEnabled]);

  useEffect(() => {
    if (!autoReplyEnabled || !aiAvailable) return;
    const loopTimer = setInterval(async () => {
      const checkFrom = lastCheckedMsRef.current;
      lastCheckedMsRef.current = Date.now();
      try {
        const messages = await deviceBridge.getSmsMessages('inbox', 50);
        const newMsgs = messages.filter((m) => m.type === 1 && m.date > checkFrom);
        for (const msg of newMsgs) {
          try {
            const history = messages
              .filter((m) => m.address === msg.address)
              .sort((a, b) => a.date - b.date)
              .slice(-10);
            const d = await api.autoReplySms(msg.address, msg.body, history);
            if (d.ok && d.enabled && d.reply) {
              await deviceBridge.sendSms(msg.address, d.reply);
            }
          } catch (err) {
            console.warn('[auto-reply] failed:', err);
          }
        }
      } catch {
        // non-fatal — NOT_ANDROID / PERMISSION_DENIED on web/iOS/ungranted
      }
    }, 5000);
    return () => clearInterval(loopTimer);
  }, [autoReplyEnabled, aiAvailable]);
}

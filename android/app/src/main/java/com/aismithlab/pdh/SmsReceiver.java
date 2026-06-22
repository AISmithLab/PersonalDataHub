package com.aismithlab.pdh;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SmsReceiver";
    private static final String SERVER_URL = "http://127.0.0.1:3000/sms/auto-reply";
    // goAsync() gives ~10s; keep HTTP budget tight
    private static final int CONNECT_TIMEOUT_MS = 2000;
    private static final int READ_TIMEOUT_MS = 5000;
    // Queue directory mirrors Node.js dataDir: getFilesDir()/pdh-data/sms_queue/
    private static final String QUEUE_SUBDIR = "pdh-data/sms_queue";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        StringBuilder bodyBuilder = new StringBuilder();
        String from = null;
        for (SmsMessage msg : messages) {
            if (from == null) from = msg.getOriginatingAddress();
            bodyBuilder.append(msg.getMessageBody());
        }

        if (from == null || bodyBuilder.length() == 0) return;

        // Skip purely numeric short codes (< 7 digits) — allow alphanumeric sender IDs like "noreply@textem.net"
        boolean hasAlpha = from.matches(".*[a-zA-Z].*");
        String digits = from.replaceAll("[^0-9]", "");
        if (!hasAlpha && digits.length() < 7) {
            Log.d(TAG, "Skipping short code: " + from);
            return;
        }

        final String finalFrom = from;
        final String finalBody = bodyBuilder.toString();

        // Use goAsync() so Android doesn't kill us before the HTTP call finishes.
        // Total budget is ~10s; our timeouts are set to stay within that.
        final PendingResult pendingResult = goAsync();
        new Thread(() -> {
            try {
                callAutoReply(context, finalFrom, finalBody);
            } catch (Exception e) {
                Log.e(TAG, "Auto-reply error: " + e.getMessage(), e);
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    private void callAutoReply(Context context, String from, String body) {
        String json = "{\"from\":\"" + escJson(from) + "\",\"body\":\"" + escJson(body) + "\"}";

        // 1. Write to queue file FIRST — survives even if the server is not running
        File queueFile = writeQueue(context, json);

        // 2. Try to notify the running server (it will generate the AI reply and
        //    store a pending reply; WebView picks it up and sends via AndroidSms)
        try {
            byte[] data = json.getBytes(StandardCharsets.UTF_8);
            URL url = new URL(SERVER_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) { os.write(data); }
            int code = conn.getResponseCode();
            conn.disconnect();
            Log.d(TAG, "Server responded HTTP " + code + " for: " + from);
            // Server handled it — remove the queue file so startup drain skips it
            if (code == 200 && queueFile != null) queueFile.delete();
        } catch (Exception e) {
            // Server not running — queue file stays on disk for startup drain
            Log.w(TAG, "Server unreachable, queued for next startup: " + e.getMessage());
        }
    }

    private File writeQueue(Context context, String json) {
        try {
            File dir = new File(context.getFilesDir(), QUEUE_SUBDIR);
            if (!dir.exists()) dir.mkdirs();
            File file = new File(dir, System.currentTimeMillis() + ".json");
            java.io.FileWriter fw = new java.io.FileWriter(file);
            fw.write(json);
            fw.close();
            Log.d(TAG, "Queued: " + file.getAbsolutePath());
            return file;
        } catch (Exception e) {
            Log.e(TAG, "Queue write failed: " + e.getMessage());
            return null;
        }
    }

    private String escJson(String s) {
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}

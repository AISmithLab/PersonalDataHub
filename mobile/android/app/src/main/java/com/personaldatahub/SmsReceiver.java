package com.personaldatahub;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsManager;
import android.telephony.SmsMessage;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SmsReceiver";
    private static final String SERVER_URL = "http://127.0.0.1:3000/sms/auto-reply";
    private static final int CONNECT_TIMEOUT_MS = 2000;
    private static final int READ_TIMEOUT_MS = 30000;
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

        boolean hasAlpha = from.matches(".*[a-zA-Z].*");
        String digits = from.replaceAll("[^0-9]", "");
        if (!hasAlpha && digits.length() < 7) {
            Log.d(TAG, "Skipping short code: " + from);
            return;
        }

        final String finalFrom = from;
        final String finalBody = bodyBuilder.toString();

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

        File queueFile = writeQueue(context, json);

        try {
            byte[] data = json.getBytes(StandardCharsets.UTF_8);
            URL url = new URL(SERVER_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setDoInput(true);
            try (OutputStream os = conn.getOutputStream()) { os.write(data); }
            int code = conn.getResponseCode();
            Log.d(TAG, "Server responded HTTP " + code + " for: " + from);

            if (code == 200) {
                StringBuilder sb = new StringBuilder();
                try (InputStream is = conn.getInputStream();
                     BufferedReader reader = new BufferedReader(
                             new InputStreamReader(is, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) sb.append(line);
                }
                JSONObject resp = new JSONObject(sb.toString());
                String reply = resp.optString("reply", null);
                if (reply != null && !reply.isEmpty()) {
                    sendSmsReply(context, from, reply);
                }
                if (queueFile != null) queueFile.delete();
            }
            conn.disconnect();
        } catch (Exception e) {
            Log.w(TAG, "Server unreachable, queued for next startup: " + e.getMessage());
        }
    }

    private void sendSmsReply(Context context, String to, String body) {
        try {
            SmsManager smsManager;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                smsManager = context.getSystemService(SmsManager.class);
            } else {
                smsManager = SmsManager.getDefault();
            }
            if (smsManager == null) { Log.e(TAG, "SmsManager unavailable"); return; }
            java.util.ArrayList<String> parts = smsManager.divideMessage(body);
            if (parts.size() == 1) {
                smsManager.sendTextMessage(to, null, body, null, null);
            } else {
                smsManager.sendMultipartTextMessage(to, null, parts, null, null);
            }
            Log.d(TAG, "Auto-reply sent to: " + to);
        } catch (Exception e) {
            Log.e(TAG, "Failed to send auto-reply SMS: " + e.getMessage(), e);
        }
    }

    private File writeQueue(Context context, String json) {
        try {
            File dir = new File(context.getFilesDir(), QUEUE_SUBDIR);
            if (!dir.exists()) dir.mkdirs();
            File file = new File(dir, System.currentTimeMillis() + ".json");
            FileWriter fw = new FileWriter(file);
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

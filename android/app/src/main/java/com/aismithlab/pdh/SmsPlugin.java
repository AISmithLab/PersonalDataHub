package com.aismithlab.pdh;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.telephony.SmsManager;
import android.webkit.JavascriptInterface;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "Sms",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_SMS }, alias = "readSms"),
        @Permission(strings = { Manifest.permission.SEND_SMS }, alias = "sendSms")
    }
)
public class SmsPlugin extends Plugin {

    static final int JS_SMS_READ_REQUEST = 9001;
    static final int JS_SMS_SEND_REQUEST = 9002;

    private static SmsJsBridge pendingReadBridge = null;
    private static SmsJsBridge pendingSendBridge = null;

    @Override
    public void load() {
        SmsJsBridge bridge = new SmsJsBridge();
        getBridge().getWebView().post(() ->
            getBridge().getWebView().addJavascriptInterface(bridge, "AndroidSms"));
    }

    static void handlePermissionsResult(int requestCode, int[] grantResults) {
        boolean granted = grantResults.length > 0
            && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == JS_SMS_READ_REQUEST && pendingReadBridge != null) {
            SmsJsBridge b = pendingReadBridge;
            pendingReadBridge = null;
            b.onReadPermissionResult(granted);
        } else if (requestCode == JS_SMS_SEND_REQUEST && pendingSendBridge != null) {
            SmsJsBridge b = pendingSendBridge;
            pendingSendBridge = null;
            b.onSendPermissionResult(granted);
        }
    }

    // -------------------------------------------------------------------------
    // JavascriptInterface — exposed as window.AndroidSms on ALL origins
    // -------------------------------------------------------------------------
    class SmsJsBridge {
        // read state
        private volatile String pendingReadCbId;
        private volatile String pendingBox;
        private volatile int    pendingLimit;
        // send state
        private volatile String pendingSendCbId;
        private volatile String pendingSendTo;
        private volatile String pendingSendBody;

        @JavascriptInterface
        public void getMessages(String callbackId, String box, int limit) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS)
                    == PackageManager.PERMISSION_GRANTED) {
                fetchAndDeliver(callbackId, box, limit);
            } else {
                pendingReadCbId = callbackId;
                pendingBox      = box;
                pendingLimit    = limit;
                pendingReadBridge = this;
                getActivity().runOnUiThread(() ->
                    ActivityCompat.requestPermissions(getActivity(),
                        new String[]{ Manifest.permission.READ_SMS },
                        JS_SMS_READ_REQUEST));
            }
        }

        @JavascriptInterface
        public void sendMessage(String callbackId, String to, String body) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.SEND_SMS)
                    == PackageManager.PERMISSION_GRANTED) {
                doSend(callbackId, to, body);
            } else {
                pendingSendCbId  = callbackId;
                pendingSendTo    = to;
                pendingSendBody  = body;
                pendingSendBridge = this;
                getActivity().runOnUiThread(() ->
                    ActivityCompat.requestPermissions(getActivity(),
                        new String[]{ Manifest.permission.SEND_SMS },
                        JS_SMS_SEND_REQUEST));
            }
        }

        void onReadPermissionResult(boolean granted) {
            String cid   = pendingReadCbId;
            String box   = pendingBox;
            int    limit = pendingLimit;
            pendingReadCbId = null;
            if (granted) fetchAndDeliver(cid, box, limit);
            else deliverReadError(cid, "PERMISSION_DENIED");
        }

        void onSendPermissionResult(boolean granted) {
            String cid  = pendingSendCbId;
            String to   = pendingSendTo;
            String body = pendingSendBody;
            pendingSendCbId = null;
            if (granted) doSend(cid, to, body);
            else deliverSendResult(cid, "PERMISSION_DENIED");
        }

        private void fetchAndDeliver(String callbackId, String box, int limit) {
            new Thread(() -> {
                try {
                    String json = readSmsJson(box, limit);
                    deliverReadResult(callbackId, json);
                } catch (Exception e) {
                    deliverReadError(callbackId, e.getMessage() != null ? e.getMessage() : "Read failed");
                }
            }).start();
        }

        private void doSend(String callbackId, String to, String body) {
            try {
                SmsManager smsManager = SmsManager.getDefault();
                // splitMessage handles texts over 160 chars
                java.util.ArrayList<String> parts = smsManager.divideMessage(body);
                if (parts.size() == 1) {
                    smsManager.sendTextMessage(to, null, body, null, null);
                } else {
                    smsManager.sendMultipartTextMessage(to, null, parts, null, null);
                }
                deliverSendResult(callbackId, null);
            } catch (Exception e) {
                deliverSendResult(callbackId, e.getMessage() != null ? e.getMessage() : "Send failed");
            }
        }

        private void deliverReadResult(String callbackId, String json) {
            String js = "window._smsDeliver&&window._smsDeliver('"
                + esc(callbackId) + "'," + json + ",null)";
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(js, null));
        }

        private void deliverReadError(String callbackId, String error) {
            String js = "window._smsDeliver&&window._smsDeliver('"
                + esc(callbackId) + "',null,'" + esc(error) + "')";
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(js, null));
        }

        private void deliverSendResult(String callbackId, String error) {
            String errPart = error != null ? "'" + esc(error) + "'" : "null";
            String js = "window._smsSendDeliver&&window._smsSendDeliver('"
                + esc(callbackId) + "'," + errPart + ")";
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(js, null));
        }

        private String esc(String s) {
            return s.replace("\\", "\\\\").replace("'", "\\'");
        }
    }

    // -------------------------------------------------------------------------
    // Capacitor PluginMethod (kept for completeness; unused by current UI)
    // -------------------------------------------------------------------------
    @PluginMethod
    public void getMessages(PluginCall call) {
        if (getPermissionState("readSms") != PermissionState.GRANTED) {
            requestPermissionForAlias("readSms", call, "smsPermissionCallback");
            return;
        }
        try {
            JSArray messages = readSms(call.getString("box", "inbox"), call.getInt("limit", 100));
            JSObject result = new JSObject();
            result.put("messages", messages);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to read SMS: " + e.getMessage());
        }
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        if (getPermissionState("readSms") == PermissionState.GRANTED) {
            try {
                JSArray messages = readSms(call.getString("box", "inbox"), call.getInt("limit", 100));
                JSObject result = new JSObject();
                result.put("messages", messages);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to read SMS: " + e.getMessage());
            }
        } else {
            call.reject("READ_SMS permission denied");
        }
    }

    // -------------------------------------------------------------------------
    // Shared SMS reader
    // -------------------------------------------------------------------------
    private String readSmsJson(String box, int limit) throws Exception {
        return readSms(box, limit).toString();
    }

    private JSArray readSms(String box, int limit) throws Exception {
        Uri uri;
        switch (box != null ? box : "inbox") {
            case "sent": uri = Uri.parse("content://sms/sent"); break;
            case "all":  uri = Uri.parse("content://sms/");     break;
            default:     uri = Uri.parse("content://sms/inbox");break;
        }
        String[] projection = { "_id", "address", "body", "date", "type", "read" };
        JSArray messages = new JSArray();
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, projection, null, null, "date DESC")) {
            if (cursor != null) {
                int count = 0;
                while (cursor.moveToNext() && count < limit) {
                    JSObject msg = new JSObject();
                    msg.put("id",      cursor.getString(cursor.getColumnIndexOrThrow("_id")));
                    msg.put("address", cursor.getString(cursor.getColumnIndexOrThrow("address")));
                    msg.put("body",    cursor.getString(cursor.getColumnIndexOrThrow("body")));
                    msg.put("date",    cursor.getLong(cursor.getColumnIndexOrThrow("date")));
                    msg.put("type",    cursor.getInt(cursor.getColumnIndexOrThrow("type")));
                    msg.put("read",    cursor.getInt(cursor.getColumnIndexOrThrow("read")) == 1);
                    messages.put(msg);
                    count++;
                }
            }
        }
        return messages;
    }
}

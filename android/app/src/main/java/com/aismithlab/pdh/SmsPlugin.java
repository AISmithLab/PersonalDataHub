package com.aismithlab.pdh;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
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
        @Permission(strings = { Manifest.permission.READ_SMS }, alias = "readSms")
    }
)
public class SmsPlugin extends Plugin {

    static final int JS_SMS_PERMISSION_REQUEST = 9001;

    // Pending bridge instance waiting for a permission result from MainActivity.
    private static SmsJsBridge pendingBridge = null;

    @Override
    public void load() {
        SmsJsBridge bridge = new SmsJsBridge();
        getBridge().getWebView().post(() ->
            getBridge().getWebView().addJavascriptInterface(bridge, "AndroidSms"));
    }

    /** Called by MainActivity.onRequestPermissionsResult for our request code. */
    static void handlePermissionsResult(int requestCode, int[] grantResults) {
        if (requestCode != JS_SMS_PERMISSION_REQUEST || pendingBridge == null) return;
        boolean granted = grantResults.length > 0
            && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        SmsJsBridge b = pendingBridge;
        pendingBridge = null;
        b.onPermissionResult(granted);
    }

    // -------------------------------------------------------------------------
    // JavascriptInterface — available on ALL origins, including http://127.0.0.1
    // -------------------------------------------------------------------------
    class SmsJsBridge {
        private volatile String pendingCallbackId;
        private volatile String pendingBox;
        private volatile int    pendingLimit;

        @JavascriptInterface
        public void getMessages(String callbackId, String box, int limit) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS)
                    == PackageManager.PERMISSION_GRANTED) {
                fetchAndDeliver(callbackId, box, limit);
            } else {
                pendingCallbackId = callbackId;
                pendingBox        = box;
                pendingLimit      = limit;
                pendingBridge     = this;
                getActivity().runOnUiThread(() ->
                    ActivityCompat.requestPermissions(getActivity(),
                        new String[]{ Manifest.permission.READ_SMS },
                        JS_SMS_PERMISSION_REQUEST));
            }
        }

        void onPermissionResult(boolean granted) {
            String cid = pendingCallbackId;
            String b   = pendingBox;
            int    l   = pendingLimit;
            pendingCallbackId = null;
            if (granted) {
                fetchAndDeliver(cid, b, l);
            } else {
                deliverError(cid, "PERMISSION_DENIED");
            }
        }

        private void fetchAndDeliver(String callbackId, String box, int limit) {
            new Thread(() -> {
                try {
                    String json = readSmsJson(box, limit);
                    deliverResult(callbackId, json);
                } catch (Exception e) {
                    deliverError(callbackId, e.getMessage() != null ? e.getMessage() : "Read failed");
                }
            }).start();
        }

        private void deliverResult(String callbackId, String json) {
            String js = "window._smsDeliver&&window._smsDeliver('"
                + esc(callbackId) + "'," + json + ",null)";
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(js, null));
        }

        private void deliverError(String callbackId, String error) {
            String js = "window._smsDeliver&&window._smsDeliver('"
                + esc(callbackId) + "',null,'" + esc(error) + "')";
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

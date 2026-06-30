package com.personaldatahub;

import android.database.Cursor;
import android.net.Uri;
import android.telephony.SmsManager;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

public class SmsModule extends ReactContextBaseJavaModule {

    SmsModule(ReactApplicationContext context) {
        super(context);
    }

    @NonNull
    @Override
    public String getName() {
        return "SmsModule";
    }

    @ReactMethod
    public void getMessages(String box, int limit, Promise promise) {
        new Thread(() -> {
            try {
                Uri uri;
                switch (box != null ? box : "inbox") {
                    case "sent": uri = Uri.parse("content://sms/sent"); break;
                    case "all":  uri = Uri.parse("content://sms/");     break;
                    default:     uri = Uri.parse("content://sms/inbox"); break;
                }
                String[] projection = {"_id", "address", "body", "date", "type", "read"};
                WritableArray messages = Arguments.createArray();
                try (Cursor cursor = getReactApplicationContext().getContentResolver().query(
                        uri, projection, null, null, "date DESC")) {
                    if (cursor != null) {
                        int count = 0;
                        while (cursor.moveToNext() && count < limit) {
                            WritableMap msg = Arguments.createMap();
                            msg.putString("id",      cursor.getString(cursor.getColumnIndexOrThrow("_id")));
                            msg.putString("address", cursor.getString(cursor.getColumnIndexOrThrow("address")));
                            msg.putString("body",    cursor.getString(cursor.getColumnIndexOrThrow("body")));
                            msg.putDouble("date",    cursor.getLong(cursor.getColumnIndexOrThrow("date")));
                            msg.putInt("type",       cursor.getInt(cursor.getColumnIndexOrThrow("type")));
                            msg.putBoolean("read",   cursor.getInt(cursor.getColumnIndexOrThrow("read")) == 1);
                            messages.pushMap(msg);
                            count++;
                        }
                    }
                }
                promise.resolve(messages);
            } catch (Exception e) {
                promise.reject("READ_ERROR", e.getMessage() != null ? e.getMessage() : "Read failed");
            }
        }).start();
    }

    @ReactMethod
    public void sendMessage(String to, String body, Promise promise) {
        try {
            SmsManager smsManager = SmsManager.getDefault();
            java.util.ArrayList<String> parts = smsManager.divideMessage(body);
            if (parts.size() == 1) {
                smsManager.sendTextMessage(to, null, body, null, null);
            } else {
                smsManager.sendMultipartTextMessage(to, null, parts, null, null);
            }
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("SEND_ERROR", e.getMessage() != null ? e.getMessage() : "Send failed");
        }
    }
}

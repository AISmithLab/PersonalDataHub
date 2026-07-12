package com.personaldatahub;

import android.database.Cursor;
import android.provider.ContactsContract;
import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

public class ContactsModule extends ReactContextBaseJavaModule {
    ContactsModule(ReactApplicationContext context) {
        super(context);
    }

    @NonNull
    @Override
    public String getName() {
        return "ContactsModule";
    }

    @ReactMethod
    public void getContacts(Promise promise) {
        new Thread(() -> {
            try {
                WritableArray contacts = Arguments.createArray();
                String[] projection = {
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                };
                
                try (Cursor cursor = getReactApplicationContext().getContentResolver().query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection, null, null, null)) {
                    if (cursor != null) {
                        while (cursor.moveToNext()) {
                            WritableMap contact = Arguments.createMap();
                            contact.putString("name", cursor.getString(cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)));
                            contact.putString("number", cursor.getString(cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)));
                            contacts.pushMap(contact);
                        }
                    }
                }
                promise.resolve(contacts);
            } catch (Exception e) {
                promise.reject("READ_CONTACTS_ERROR", e.getMessage() != null ? e.getMessage() : "Read contacts failed");
            }
        }).start();
    }
}

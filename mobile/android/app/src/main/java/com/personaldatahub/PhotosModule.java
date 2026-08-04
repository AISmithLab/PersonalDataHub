package com.personaldatahub;

import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class PhotosModule extends ReactContextBaseJavaModule {
    PhotosModule(ReactApplicationContext context) {
        super(context);
    }

    @NonNull
    @Override
    public String getName() {
        return "PhotosModule";
    }

    @ReactMethod
    public void getPhotos(int limit, Promise promise) {
        new Thread(() -> {
            try {
                WritableArray photos = Arguments.createArray();
                String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
                    MediaStore.Images.Media.DATE_ADDED,
                    MediaStore.Images.Media.WIDTH,
                    MediaStore.Images.Media.HEIGHT
                };

                String sortOrder = MediaStore.Images.Media.DATE_ADDED + " DESC";

                try (Cursor cursor = getReactApplicationContext().getContentResolver().query(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        projection,
                        null,
                        null,
                        sortOrder)) {
                    if (cursor != null) {
                        int count = 0;
                        int idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                        int nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
                        int bucketCol = cursor.getColumnIndex(MediaStore.Images.Media.BUCKET_DISPLAY_NAME);
                        int dateCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED);
                        int widthCol = cursor.getColumnIndex(MediaStore.Images.Media.WIDTH);
                        int heightCol = cursor.getColumnIndex(MediaStore.Images.Media.HEIGHT);

                        while (cursor.moveToNext() && count < limit) {
                            long id = cursor.getLong(idCol);
                            String title = cursor.getString(nameCol);
                            String album = bucketCol >= 0 ? cursor.getString(bucketCol) : "Camera";
                            if (album == null || album.isEmpty()) album = "Gallery";
                            long dateSec = cursor.getLong(dateCol);
                            String timestamp = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).format(new java.util.Date(dateSec * 1000L));
                            int width = widthCol >= 0 ? cursor.getInt(widthCol) : 1080;
                            int height = heightCol >= 0 ? cursor.getInt(heightCol) : 1080;

                            Uri contentUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                            String dataUrl = "";
                            try {
                                InputStream stream = getReactApplicationContext().getContentResolver().openInputStream(contentUri);
                                if (stream != null) {
                                    BitmapFactory.Options options = new BitmapFactory.Options();
                                    options.inSampleSize = 4;
                                    Bitmap bitmap = BitmapFactory.decodeStream(stream, null, options);
                                    stream.close();
                                    if (bitmap != null) {
                                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                                        bitmap.compress(Bitmap.CompressFormat.JPEG, 75, baos);
                                        byte[] bytes = baos.toByteArray();
                                        dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
                                        bitmap.recycle();
                                    }
                                }
                            } catch (Exception ignored) {
                                dataUrl = contentUri.toString();
                            }

                            WritableMap photo = Arguments.createMap();
                            photo.putString("id", String.valueOf(id));
                            photo.putString("title", title != null ? title : "Photo.jpg");
                            photo.putString("album", album);
                            photo.putString("timestamp", timestamp);
                            photo.putString("date", timestamp);
                            photo.putInt("width", width > 0 ? width : 1080);
                            photo.putInt("height", height > 0 ? height : 1080);
                            photo.putString("uri", contentUri.toString());
                            photo.putString("dataUrl", dataUrl);
                            photos.pushMap(photo);
                            count++;
                        }
                    }
                }
                promise.resolve(photos);
            } catch (Exception e) {
                promise.reject("READ_PHOTOS_ERROR", e.getMessage() != null ? e.getMessage() : "Read photos failed");
            }
        }).start();
    }
}

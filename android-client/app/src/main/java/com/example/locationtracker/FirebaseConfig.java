package com.example.locationtracker;

import android.os.Build;

/**
 * FirebaseConfig
 * -------------
 * Single source of truth for Firebase configuration.
 * Both MainActivity and LocationService reference this class
 * instead of duplicating the config values.
 *
 * Tên thiết bị được lấy từ tên máy (Build.MODEL), ví dụ "Pixel 6" -> "Pixel 6".
 * Ký tự đặc biệt / dấu cách vẫn hợp lệ trong key Firebase.
 */
final class FirebaseConfig {
    static final String API_KEY = "AIzaSyD_mMdWjE7xcI4fqAX03iP5p4joq1af838";
    static final String DATABASE_URL = "https://locationrealtimeapps-default-rtdb.firebaseio.com";
    static final String PROJECT_ID = "locationrealtimeapps";
    static final String APP_ID = "1:549557847899:web:18339736baa351804c3c7e";

    static final String DEVICE_ID = safeDeviceId(Build.MODEL);
    static final String DEVICE_PATH = "devices/" + DEVICE_ID;
    static final String COMMAND_PATH = DEVICE_PATH + "/command";

    /** Làm sạch tên máy để dùng làm key Firebase (không rỗng, không khoảng trắng 2 đầu). */
    private static String safeDeviceId(String model) {
        String id = model == null ? "device" : model.trim();
        if (id.isEmpty()) id = "device";
        return id;
    }

    private FirebaseConfig() {}
}
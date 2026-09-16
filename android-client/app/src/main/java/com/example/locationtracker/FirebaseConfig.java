package com.example.locationtracker;

/**
 * FirebaseConfig
 * -------------
 * Single source of truth for Firebase configuration.
 * Both MainActivity and LocationService reference this class
 * instead of duplicating the config values.
 */
final class FirebaseConfig {
    static final String API_KEY = "AIzaSyD_mMdWjE7xcI4fqAX03iP5p4joq1af838";
    static final String DATABASE_URL = "https://locationrealtimeapps-default-rtdb.firebaseio.com";
    static final String PROJECT_ID = "locationrealtimeapps";
    static final String APP_ID = "1:549557847899:web:18339736baa351804c3c7e";

    static final String DEVICE_PATH = "devices/device_android_01";
    static final String COMMAND_PATH = "devices/device_android_01/command";

    private FirebaseConfig() {}
}

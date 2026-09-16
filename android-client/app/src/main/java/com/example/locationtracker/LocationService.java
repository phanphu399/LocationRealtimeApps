package com.example.locationtracker;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.util.HashMap;
import java.util.Map;

/**
 * LocationService
 * ---------------
 * Foreground Service chạy ngầm, thực hiện 2 chức năng chính:
 *
 *  1. LẤY TỌA ĐỘ GPS: Dùng FusedLocationProviderClient lấy vị trí mỗi 5 giây,
 *     đẩy {lat, lng, timestamp} lên Firebase path /devices/device_android_01.
 *
 *  2. LẮNG NGHE LỆNH "PLAY_SOUND": Lắng nghe liên tục node:
 *         /devices/device_android_01/command
 *     (KHỚP 100% với app.js trên web dashboard - ref(db, "devices/device_android_01/command")).
 *     Khi nhận giá trị "PLAY_SOUND", service sẽ:
 *       a. Ép âm lượng báo thức tối đa (AudioManager)
 *       b. Phát âm thanh báo động (alarm ringtone) qua MediaPlayer
 *       c. Sau 10 giây -> dừng phát + ghi lại giá trị "NONE" vào Firebase
 */
public class LocationService extends Service {

    private static final String TAG = "LocationService";

    // Trạng thái chạy của service - MainActivity đọc để hiển thị UI realtime
    private static volatile boolean sRunning = false;

    /** @return true nếu service đang chạy (MainActivity dùng để hiển thị trạng thái). */
    public static boolean isRunning() {
        return sRunning;
    }

    // ---- Đường dẫn Firebase (ĐỒNG BỘ 100% với web-dashboard/app.js) ----
    private static final String DEVICE_PATH  = FirebaseConfig.DEVICE_PATH;
    private static final String COMMAND_PATH = FirebaseConfig.COMMAND_PATH;

    // ---- Cấu hình location ----
    private static final long UPDATE_INTERVAL_MS = 5000L;

    // ---- Cấu hình phát âm thanh ----
    private static final long ALARM_DURATION_MS = 10_000L; // Tối đa 10 giây

    // ---- Notification ----
    private static final String CHANNEL_ID = "location_channel";
    private static final int NOTIFICATION_ID = 1001;

    // ---- FusedLocation ----
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;

    // ---- Firebase ----
    private DatabaseReference deviceRef;
    private DatabaseReference commandRef;   // Reference tới /devices/device_android_01/command
    private ValueEventListener commandListener;

    // ---- Alarm / Sound ----
    private MediaPlayer mediaPlayer;
    private AudioManager audioManager;
    private Handler alarmHandler;
    private final Runnable alarmTimeoutRunnable = this::stopAlarmSound;

    // ---- Battery ----
    private final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level >= 0 && scale > 0) {
                batteryPercent = (int) Math.round(level * 100.0 / scale);
            }
            int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN);
            batteryCharging = status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL;
        }
    };
    private int batteryPercent = -1;
    private boolean batteryCharging = false;

    /* ===================================================================== */
    /* LIFECYCLE                                                             */
    /* ===================================================================== */

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "onCreate - khởi tạo service");

        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        alarmHandler = new Handler(Looper.getMainLooper());

        // Đọc mức pin thật và cache lại để đẩy lên Firebase cùng tọa độ
        registerReceiver(batteryReceiver, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));

        // Firebase
        ensureFirebaseInitialized();
        deviceRef = FirebaseDatabase.getInstance().getReference(DEVICE_PATH);
        commandRef = FirebaseDatabase.getInstance().getReference(COMMAND_PATH);

        // Location
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        buildLocationCallback();
        createNotificationChannel();

        // Lắng nghe lệnh từ Firebase (PLAY_SOUND)
        startCommandListener();
    }

    /**
     * START_STICKY: nếu hệ thống kill service -> Android tự khởi động lại.
     */
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "onStartCommand - bắt đầu foreground + lấy vị trí");
        sRunning = true;
        startForeground(NOTIFICATION_ID, buildNotification());
        startLocationUpdates();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "onDestroy - dọn dẹp tài nguyên");
        sRunning = false;

        // Dừng location
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }

        // Bỏ lắng nghe lệnh
        if (commandListener != null && commandRef != null) {
            commandRef.removeEventListener(commandListener);
        }

        // Dừng MediaPlayer nếu đang phát
        stopAlarmSound();

        try {
            unregisterReceiver(batteryReceiver);
        } catch (Exception ignored) {
        }

        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ===================================================================== */
    /* FIREBASE - INIT & LOCATION WRITE                                      */
    /* ===================================================================== */

    private void ensureFirebaseInitialized() {
        if (!FirebaseApp.getApps(this).isEmpty()) return;

        FirebaseOptions options = new FirebaseOptions.Builder()
                .setApplicationId(FirebaseConfig.APP_ID)
                .setApiKey(FirebaseConfig.API_KEY)
                .setDatabaseUrl(FirebaseConfig.DATABASE_URL)
                .setProjectId(FirebaseConfig.PROJECT_ID)
                .build();

        FirebaseApp.initializeApp(this, options);
        Log.d(TAG, "Firebase đã khởi tạo với databaseURL: " + FirebaseConfig.DATABASE_URL);
    }

    /**
     * Ghi tọa độ lên Firebase bằng updateChildren (KHÔNG ghi đè field "command").
     * Giá trị "command" sẽ do web dashboard đặt thành "PLAY_SOUND"
     * và service sẽ tự đặt lại "NONE" khi hoàn tất.
     */
    private void writeLocationToFirebase(Location location) {
        Map<String, Object> updates = new HashMap<>();
        updates.put("lat", round(location.getLatitude(), 6));
        updates.put("lng", round(location.getLongitude(), 6));
        updates.put("timestamp", System.currentTimeMillis() / 1000L);
        if (batteryPercent >= 0) {
            updates.put("battery", batteryPercent);
            updates.put("charging", batteryCharging);
        }
        if (location.hasSpeed()) {
            updates.put("speed", Math.round(location.getSpeed() * 3.6 * 10.0) / 10.0); // m/s -> km/h
        }

        deviceRef.updateChildren(updates)
                .addOnSuccessListener(aVoid ->
                        Log.d(TAG, "Đẩy tọa độ OK: lat=" + updates.get("lat") + ", lng=" + updates.get("lng")))
                .addOnFailureListener(e ->
                        Log.e(TAG, "Đẩy tọa độ thất bại: " + e.getMessage()));
    }

    /* ===================================================================== */
    /* FIREBASE - COMMAND LISTENER (PLAY_SOUND)                              */
    /* ===================================================================== */

    /**
     * Bắt đầu lắng nghe node "command" trên Firebase:
     *   /devices/device_android_01/command
     *
     * Đây chính xác là node mà web-dashboard/app.js ghi giá trị khi
     * người dùng bấm nút "Play Sound" (ref(db, "devices/device_android_01/command")).
     */
    private void startCommandListener() {
        commandListener = new ValueEventListener() {
            /**
             * Được gọi khi command thay đổi:
             *  - "PLAY_SOUND" -> phát âm thanh báo động
             *  - "NONE"      -> (mặc định, bỏ qua)
             */
            @Override
            public void onDataChange(DataSnapshot snapshot) {
                String command = snapshot.getValue(String.class);
                if (command == null) return;

                Log.d(TAG, "Nhận lệnh tại " + COMMAND_PATH + ": " + command);

                if ("PLAY_SOUND".equals(command)) {
                    playAlarmSound();
                } else if ("VOLUME_UP".equals(command)) {
                    increaseAlarmVolume();
                    resetCommandToNone();
                }
            }

            @Override
            public void onCancelled(DatabaseError error) {
                Log.e(TAG, "Lỗi khi đọc lệnh: " + error.getMessage());
            }
        };

        commandRef.addValueEventListener(commandListener);
        Log.d(TAG, "Đăng ký lắng nghe lệnh tại /" + COMMAND_PATH);
    }

    /* ===================================================================== */
    /* ALARM / PLAY SOUND                                                    */
    /* ===================================================================== */

    /**
     * Phát âm thanh báo động:
     *  1. Lấy ringtone mặc định (TYPE_ALARM ưu tiên, nếu không có dùng TYPE_RINGTONE).
     *  2. Ép volume về MAX (mức MAX_STREAM_ALARM).
     *  3. Dùng MediaPlayer.loop() để lặp liên tục.
     *  4. Sau ALARM_DURATION_MS (10 giây) -> tự dừng và ghi "NONE" lên Firebase.
     */
    private void playAlarmSound() {
        // Nếu đang phát rồi -> dừng trước khi phát lại
        stopAlarmSound();

        try {
            // Đặt âm lượng MAX cho stream ALARM
            int maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, maxVol, 0);

            // Lấy URI ringtone (ưu tiên alarm, fallback ringtone)
            Uri alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarmUri == null) {
                alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            }

            if (alarmUri == null) {
                Log.e(TAG, "Không tìm thấy ringtone nào trên thiết bị");
                return;
            }

            // Tạo MediaPlayer và phát
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(this, alarmUri);
            mediaPlayer.setAudioAttributes(
                    new android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
            );
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.start();

            Log.d(TAG, "Bắt đầu phát âm thanh báo động (tối đa " + ALARM_DURATION_MS / 1000 + " giây)");

            // Tự dừng sau ALARM_DURATION_MS
            alarmHandler.postDelayed(alarmTimeoutRunnable, ALARM_DURATION_MS);

        } catch (Exception e) {
            Log.e(TAG, "Lỗi khi phát âm thanh: " + e.getMessage());
            resetCommandToNone();
        }
    }

    /**
     * Dừng phát âm thanh, giải phóng MediaPlayer, ghi lại "NONE" lên Firebase.
     */
    private void stopAlarmSound() {
        // Bỏ timeout cũ
        alarmHandler.removeCallbacks(alarmTimeoutRunnable);

        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.release();
            } catch (Exception e) {
                Log.e(TAG, "Lỗi khi dừng MediaPlayer: " + e.getMessage());
            }
            mediaPlayer = null;
            Log.d(TAG, "Đã dừng phát âm thanh");
        }

        // Đặt lại command = "NONE" trên Firebase
        resetCommandToNone();
    }

    /**
     * Ghi giá trị "NONE" vào /devices/device_android_01/command
     * để web dashboard biết lệnh đã được xử lý xong.
     */
    private void resetCommandToNone() {
        if (commandRef != null) {
            commandRef.setValue("NONE")
                    .addOnSuccessListener(aVoid -> Log.d(TAG, "Command đã reset về NONE"))
                    .addOnFailureListener(e -> Log.e(TAG, "Reset command thất bại: " + e.getMessage()));
        }
    }

    /**
     * Tăng âm lượng của stream ALARM lên một nấc (xử lý lệnh "VOLUME_UP").
     * Khác với PLAY_SOUND (tự phát âm thanh), đây chỉ điều chỉnh volume
     * để khi phát chuông báo động sẽ to hơn.
     */
    private void increaseAlarmVolume() {
        try {
            int maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            int curVol = audioManager.getStreamVolume(AudioManager.STREAM_ALARM);
            int newVol = Math.min(maxVol, curVol + 1);
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, newVol, 0);

            Log.d(TAG, "Tăng âm lượng báo thức: " + curVol + " -> " + newVol + " / " + maxVol);
            Toast.makeText(this, "Âm lượng báo động: " + newVol + "/" + maxVol, Toast.LENGTH_SHORT).show();

            // Bật notifyVolumOff only nếu cần: dòng dưới tạm để 0 (không show UI) cho nhẹ
            // setStreamVolume đang dùng flag 0 nên người dùng không thấy slider hệ thống.
        } catch (Exception e) {
            Log.e(TAG, "Lỗi tăng âm lượng: " + e.getMessage());
        }
    }

    /* ===================================================================== */
    /* LOCATION                                                              */
    /* ===================================================================== */

    private void buildLocationCallback() {
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) return;
                Location location = locationResult.getLastLocation();
                if (location != null) {
                    Log.d(TAG, String.format("Vị trí mới: %.6f, %.6f (acc=%.1fm)",
                            location.getLatitude(), location.getLongitude(), location.getAccuracy()));
                    writeLocationToFirebase(location);
                }
            }
        };
    }

    @SuppressLint("MissingPermission")
    private void startLocationUpdates() {
        LocationRequest locationRequest = LocationRequest.create()
                .setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY)
                .setInterval(UPDATE_INTERVAL_MS)
                .setFastestInterval(UPDATE_INTERVAL_MS);

        if (ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
                && ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Thiếu quyền vị trí - dừng service");
            stopSelf();
            return;
        }

        fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper());
        Log.d(TAG, "Bắt đầu lấy vị trí mỗi " + UPDATE_INTERVAL_MS + "ms");
    }

    /* ===================================================================== */
    /* NOTIFICATION                                                          */
    /* ===================================================================== */

    private Notification buildNotification() {
        Intent appIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, appIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(this, CHANNEL_ID)
                    .setContentTitle("GPS Tracker")
                    .setContentText("Đang chạy ngầm lấy tọa độ")
                    .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                    .setOngoing(true)
                    .setContentIntent(pendingIntent)
                    .build();
        } else {
            return new Notification.Builder(this)
                    .setContentTitle("GPS Tracker")
                    .setContentText("Đang chạy ngầm lấy tọa độ")
                    .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                    .setOngoing(true)
                    .setContentIntent(pendingIntent)
                    .build();
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Vị trí GPS", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Thông báo khi service đang lấy tọa độ");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    /* ===================================================================== */
    /* UTILS                                                                 */
    /* ===================================================================== */

    private static double round(double value, int places) {
        double factor = Math.pow(10, places);
        return Math.round(value * factor) / factor;
    }
}
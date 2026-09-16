package com.example.locationtracker;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * MainActivity
 * ------------
 * Giao diện chính dạng Material Design (XML layout), hiển thị trạng thái
 * realtime của thiết bị: kết nối Firebase, tọa độ đang đẩy, pin, trạng thái service.
 *
 * Tính năng:
 *  - Tự động refresh tọa độ mỗi lần Firebase cập nhật (onValue realtime).
 *  - Đọc mức pin thật từ BatteryManager (không giả lập).
 *  - Kiểm tra/xin quyền vị trí + background + notification.
 *  - Nút Start/Stop cho LocationService (Foreground Service).
 */
public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_LOCATION_PERMISSION = 1001;
    private static final int REQUEST_NOTIFICATION_PERMISSION = 1002;
    private static final int REQUEST_IGNORE_BATTERY_OPTIMIZATIONS = 1003;

    private static final String DEVICE_PATH = FirebaseConfig.DEVICE_PATH;

    // Nhóm quyền vị trí (background location chỉ tồn tại từ API 29)
    private static final String[] REQUIRED_PERMISSIONS;
    static {
        List<String> perms = new ArrayList<>();
        perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
        perms.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            perms.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        }
        REQUIRED_PERMISSIONS = perms.toArray(new String[0]);
    }

    // ---- Views ----
    private TextView tvServiceStatus;
    private TextView tvFirebaseStatus;
    private TextView tvLat;
    private TextView tvLng;
    private TextView tvAccuracy;
    private TextView tvUpdatedAt;
    private TextView tvBattery;
    private ProgressBar pbBattery;
    private View vFirebaseDot;
    private TextView tvIgnoreBattery;
    private MaterialButton btnAskIgnoreBattery;

    private DatabaseReference deviceRef;
    private DatabaseReference connectedRef;
    private ValueEventListener commandValueListener;
    private ValueEventListener connectedListener;

    // Battery receiver cập nhật pin realtime
    private final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level >= 0 && scale > 0) {
                int percent = (int) Math.round(level * 100.0 / scale);
                updateBatteryUi(percent);
            }
        }
    };

    private final Handler uiHandler = new Handler(Looper.getMainLooper());

    /* ===================================================================== */
    /* LIFECYCLE                                                             */
    /* ===================================================================== */

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        bindViews();
        ensureFirebaseInitialized();

        // Kết nối Firebase vào /devices/device_android_01 để hiện tọa độ realtime
        deviceRef = FirebaseDatabase.getInstance().getReference(DEVICE_PATH);
        connectedRef = FirebaseDatabase.getInstance().getReference(".info/connected");

        refreshServiceStatus();
        refreshConnectionStatus();
        registerBatteryReceiver();
        setupFirebaseListeners();

        // Xin quyền notification (Android 13+) cho FGS
        maybeRequestNotificationPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshServiceStatus();
        updateBatteryIgnoreUi();
    }

    @Override
    protected void onPause() {
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (deviceRef != null && commandValueListener != null) {
            deviceRef.removeEventListener(commandValueListener);
        }
        if (connectedRef != null && connectedListener != null) {
            connectedRef.removeEventListener(connectedListener);
        }
        unregisterReceiver(batteryReceiver);
        super.onDestroy();
    }

    /* ===================================================================== */
    /* SETUP                                                                 */
    /* ===================================================================== */

    private void bindViews() {
        tvServiceStatus = findViewById(R.id.tvServiceStatus);
        tvFirebaseStatus = findViewById(R.id.tvFirebaseStatus);
        tvLat = findViewById(R.id.tvLat);
        tvLng = findViewById(R.id.tvLng);
        tvAccuracy = findViewById(R.id.tvAccuracy);
        tvUpdatedAt = findViewById(R.id.tvUpdatedAt);
        tvBattery = findViewById(R.id.tvBattery);
        pbBattery = findViewById(R.id.pbBattery);
        vFirebaseDot = findViewById(R.id.vFirebaseDot);

        MaterialButton btnStart = findViewById(R.id.btnStart);
        MaterialButton btnStop = findViewById(R.id.btnStop);
        tvIgnoreBattery = findViewById(R.id.tvIgnoreBattery);
        btnAskIgnoreBattery = findViewById(R.id.btnAskIgnoreBattery);

        btnStart.setOnClickListener(v -> onStartClicked());
        btnStop.setOnClickListener(v -> {
            stopService(new Intent(this, LocationService.class));
            refreshServiceStatus();
            Toast.makeText(this, "Đã dừng service", Toast.LENGTH_SHORT).show();
        });
        btnAskIgnoreBattery.setOnClickListener(v -> requestIgnoreBatteryOptimizations());
    }

    /** Kiểm tra xem app có nằm trong danh sách loại trừ tối ưu hóa pin (Android 6+) hay không. */
    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void updateBatteryIgnoreUi() {
        if (tvIgnoreBattery == null) return;
        boolean ignoring = isIgnoringBatteryOptimizations();
        if (ignoring) {
            tvIgnoreBattery.setText("Đã cấp quyền - app sẽ không bị hệ thống đóng khi chạy ngầm.");
            tvIgnoreBattery.setTextColor(ContextCompat.getColor(this, R.color.online_green));
            btnAskIgnoreBattery.setEnabled(false);
            btnAskIgnoreBattery.setAlpha(0.5f);
        } else {
            tvIgnoreBattery.setText("App có thể bị hệ thống đóng để tiết kiệm pin. Nên cấp quyền nếu muốn theo dõi liên tục.");
            tvIgnoreBattery.setTextColor(ContextCompat.getColor(this, R.color.offline_red));
            btnAskIgnoreBattery.setEnabled(true);
            btnAskIgnoreBattery.setAlpha(1f);
        }
    }

    /** Mở hộp thoại hệ thống để người dùng bật "Không hạn chế pin" (Android 6+). */
    private void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || isIgnoringBatteryOptimizations()) {
            updateBatteryIgnoreUi();
            return;
        }
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getPackageName()));
        try {
            startActivityForResult(intent, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        } catch (Exception e) {
            Toast.makeText(this, "Thiết bị không hỗ trợ. Hãy tự mở Cài đặt > Pin để cấu hình.", Toast.LENGTH_LONG).show();
            openAppSettings();
        }
    }

    private void ensureFirebaseInitialized() {
        if (!FirebaseApp.getApps(this).isEmpty()) return;
        FirebaseOptions options = new FirebaseOptions.Builder()
                .setApplicationId(FirebaseConfig.APP_ID)
                .setApiKey(FirebaseConfig.API_KEY)
                .setDatabaseUrl(FirebaseConfig.DATABASE_URL)
                .setProjectId(FirebaseConfig.PROJECT_ID)
                .build();
        FirebaseApp.initializeApp(this, options);
    }

    private void registerBatteryReceiver() {
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        registerReceiver(batteryReceiver, filter);
    }

    /* ===================================================================== */
    /* FIREBASE LISTENERS (REALTIME)                                         */
    /* ===================================================================== */

    /**
     * Lắng nghe tọa độ của chính thiết bị trên Firebase.
     * Mỗi khi LocationService đẩy vị trí mới (mỗi 5 giây), UI sẽ tự cập nhật ngay.
     */
    private void setupFirebaseListeners() {
        // Lắng nghe node device_android_01 (lat, lng, timestamp)
        commandValueListener = new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot snapshot) {
                if (snapshot.exists()) {
                    Double lat = snapshot.child("lat").getValue(Double.class);
                    Double lng = snapshot.child("lng").getValue(Double.class);
                    Long ts = snapshot.child("timestamp").getValue(Long.class);
                    if (lat != null) tvLat.setText(String.format(Locale.US, "%.6f", lat));
                    if (lng != null) tvLng.setText(String.format(Locale.US, "%.6f", lng));
                    if (ts != null) {
                        tvUpdatedAt.setText(new SimpleDateFormat("HH:mm:ss", Locale.getDefault())
                                .format(new Date(ts * 1000L)));
                    }
                }
            }

            @Override
            public void onCancelled(DatabaseError error) {
                tvFirebaseStatus.setText("Lỗi: " + error.getMessage());
            }
        };
        deviceRef.addValueEventListener(commandValueListener);

        // Lắng nghe trạng thái kết nối Firebase (.info/connected)
        connectedListener = new ValueEventListener() {
            @Override
            public void onDataChange(DataSnapshot snapshot) {
                Boolean connected = snapshot.getValue(Boolean.class);
                if (connected != null && connected) {
                    tvFirebaseStatus.setText("Đã kết nối Firebase");
                    vFirebaseDot.setVisibility(View.VISIBLE);
                } else {
                    tvFirebaseStatus.setText("Đang kết nối...");
                    vFirebaseDot.setVisibility(View.INVISIBLE);
                }
            }

            @Override
            public void onCancelled(DatabaseError error) {
                // ignore
            }
        };
        connectedRef.addValueEventListener(connectedListener);
    }

    /* ===================================================================== */
    /* UI REFRESH                                                            */
    /* ===================================================================== */

    private void refreshServiceStatus() {
        if (tvServiceStatus == null) return;
        boolean running = LocationService.isRunning();
        tvServiceStatus.setText(running ? "● Service đang chạy - đang đẩy tọa độ" : "● Service đang dừng");
        tvServiceStatus.setTextColor(ContextCompat.getColor(this,
                running ? R.color.online_green : R.color.text_secondary));
    }

    private void refreshConnectionStatus() {
        if (tvFirebaseStatus == null) return;
        tvFirebaseStatus.setText("Đợi kết nối...");
        vFirebaseDot.setVisibility(View.INVISIBLE);
    }

    private void updateBatteryUi(int percent) {
        tvBattery.setText(percent + " %");
        pbBattery.setProgress(percent);
        int color = percent <= 20 ? R.color.offline_red : R.color.online_green;
        pbBattery.setProgressTintList(ContextCompat.getColorStateList(this, color));
    }

    /* ===================================================================== */
    /* PERMISSION LOGIC                                                      */
    /* ===================================================================== */

    /** Khi bấm Start: kiểm tra quyền rồi khởi động foreground service. */
    private void onStartClicked() {
        if (hasAllPermissions()) {
            startTrackerService();
            // Gợi ý bật "Không hạn chế pin" để service chạy ngầm ổn định
            if (!isIgnoringBatteryOptimizations()) {
                requestIgnoreBatteryOptimizations();
            }
        } else {
            requestPermissions(REQUIRED_PERMISSIONS, REQUEST_LOCATION_PERMISSION);
        }
    }

    private boolean hasAllPermissions() {
        for (String permission : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    /** Xin quyền notification (Android 13+) cho FGS. */
    private void maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    REQUEST_NOTIFICATION_PERMISSION);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQUEST_LOCATION_PERMISSION) {
            if (hasAllPermissions()) {
                startTrackerService();
                return;
            }
            // Thiếu background location -> mở Settings cho người dùng bật "Allow all the time"
            boolean hasForeground = ContextCompat.checkSelfPermission(this,
                    Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            if (hasForeground) {
                Toast.makeText(this,
                        "Chọn 'Cho phép mọi lúc' (Allow all the time) để theo dõi khi chạy ngầm",
                        Toast.LENGTH_LONG).show();
                openAppSettings();
            } else {
                Toast.makeText(this, "Cần cấp quyền vị trí để sử dụng", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) {
            updateBatteryIgnoreUi();
        }
    }

    /** Khởi động LocationService (startForegroundService bắt buộc từ Android 8). */
    private void startTrackerService() {
        Intent serviceIntent = new Intent(this, LocationService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        Toast.makeText(this, "Service đang chạy...", Toast.LENGTH_SHORT).show();
        refreshServiceStatus();
    }

    private void openAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getPackageName()));
        startActivity(intent);
    }
}
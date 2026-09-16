package com.example.locationtracker;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * MainActivity
 * ------------
 * Màn hình chính của ứng dụng GPS Tracker.
 *
 * Nhiệm vụ chính:
 *  1. Kiểm tra & xin quyền vị trí (foreground + background).
 *  2. Khi đã đủ quyền -> bấm nút Start để gọi startForegroundService()
 *     kích hoạt LocationService (chạy ngầm, đẩy tọa độ lên Firebase).
 *
 * LƯU Ý QUAN TRỌNG về ACCESS_BACKGROUND_LOCATION:
 *  - Từ Android 10 (API 29): quyền background có thể xin bằng dialog.
 *  - Từ Android 11 (API 30) TRỞ LÊN: hệ thống KHÔNG cho xin quyền background
 *    bằng dialog mà bắt buộc người dùng phải vào Settings > App info
 *    > Permissions > "Allow all the time". Code dưới đây sẽ tự mở màn hình
 *    đó nếu người dùng chỉ mới cấp quyền "while using the app".
 */
public class MainActivity extends AppCompatActivity {

    private static final int REQUEST_LOCATION_PERMISSION = 1001;

    // Nhóm quyền cần thiết. ACCESS_BACKGROUND_LOCATION chỉ tồn tại từ API 29.
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

    private TextView statusText;
    private Button startButton;
    private Button stopButton;

    /* ===================================================================== */
    /* LIFECYCLE                                                             */
    /* ===================================================================== */

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi(); // Tạo giao diện đơn giản bằng code (không cần layout XML)

        refreshStatus();

        // Nút START: khởi động foreground service lấy tọa độ
        startButton.setOnClickListener(v -> onStartClicked());

        // Nút STOP: dừng service
        stopButton.setOnClickListener(v -> {
            stopService(new Intent(this, LocationService.class));
            refreshStatus();
            Toast.makeText(this, "Đã dừng service", Toast.LENGTH_SHORT).show();
        });
    }

    /* ===================================================================== */
    /* PERMISSION LOGIC                                                      */
    /* ===================================================================== */

    /** Xử lý khi người dùng bấm nút Start. */
    private void onStartClicked() {
        if (hasAllPermissions()) {
            startTrackerService();
        } else {
            // Xin các quyền còn thiếu (NẾU background location chưa cấp,
            // hãy xin nó RIÊNG bằng dialog trước, không xin chung với foreground)
            requestPermissions(REQUIRED_PERMISSIONS, REQUEST_LOCATION_PERMISSION);
        }
    }

    /**
     * Kiểm tra trong runtime: app đã được cấp ĐỦ TẤT CẢ quyền cần thiết chưa.
     */
    private boolean hasAllPermissions() {
        for (String permission : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, permission)
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    /**
     * Callback nhận kết quả từ requestPermissions().
     * Nếu cấp đủ -> chạy service. Nếu chưa -> hướng dẫn người dùng bật
     * background location qua Settings (bắt buộc từ Android 11/API 30).
     */
    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode != REQUEST_LOCATION_PERMISSION) {
            return;
        }

        if (hasAllPermissions()) {
            startTrackerService();
            return;
        }

        // Nếu vẫn còn thiếu -> có 2 trường hợp:
        // 1. Người dùng từ chối quyền foreground -> kêu họ cấp lại.
        // 2. Thiếu ACCESS_BACKGROUND_LOCATION (chạy ngầm) -> phải qua Settings.
        boolean hasForegroundLocation = ContextCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;

        if (!hasForegroundLocation) {
            Toast.makeText(this, "Vui lòng cấp quyền truy cập vị trí để sử dụng ứng dụng",
                    Toast.LENGTH_LONG).show();
            requestPermissions(REQUIRED_PERMISSIONS, REQUEST_LOCATION_PERMISSION);
        } else {
            // Đã có quyền "while using the app", cần thêm quyền chạy ngầm
            Toast.makeText(this, "Vui lòng chọn 'Cho phép mọi lúc' (Allow all the time) để lấy tọa độ khi chạy ngầm",
                    Toast.LENGTH_LONG).show();
            openAppSettings();
        }

        refreshStatus();
    }

    /* ===================================================================== */
    /* SERVICE CONTROL                                                       */
    /* ===================================================================== */

    /**
     * Khởi động LocationService:
     *  - Android 8.0+ : bắt buộc dùng startForegroundService() để service
     *    có khoảng 5 giây gọi startForeground() - không thì crash.
     *  - Android cũ    : dùng startService() thông thường.
     */
    private void startTrackerService() {
        Intent serviceIntent = new Intent(this, LocationService.class);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }

        Toast.makeText(this, "Service đang chạy ngầm...", Toast.LENGTH_SHORT).show();
        refreshStatus();
    }

    /* ===================================================================== */
    /* UI HELPERS                                                            */
    /* ===================================================================== */

    /** Cập nhật TextView trạng thái dựa trên quyền hiện tại. */
    private void refreshStatus() {
        if (statusText == null) return;

        if (hasAllPermissions()) {
            statusText.setText("Tất cả quyền đã được cấp. Bấm Start để bắt đầu.");
        } else {
            statusText.setText("Cần cấp quyền vị trí (gồm quyền chạy ngầm) trước khi bắt đầu.");
        }
    }

    /** Mở màn hình Settings chi tiết của app để người dùng bật quyền chạy ngầm. */
    private void openAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getPackageName()));
        startActivity(intent);
    }

    /**
     * Dựng giao diện bằng code thuần (LinearLayout) để file này tự chạy được
     * ngay khi copy vào Android Studio mà không cần thêm layout XML.
     */
    private void buildUi() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(48, 48, 48, 48);

        statusText = new TextView(this);
        statusText.setTextSize(16);
        statusText.setGravity(Gravity.CENTER);
        statusText.setPadding(0, 0, 0, 32);

        startButton = new Button(this);
        startButton.setText("START - Bắt đầu theo dõi GPS");

        stopButton = new Button(this);
        stopButton.setText("STOP - Dừng service");

        layout.addView(statusText);
        layout.addView(startButton);
        layout.addView(stopButton);

        setContentView(layout);
    }
}
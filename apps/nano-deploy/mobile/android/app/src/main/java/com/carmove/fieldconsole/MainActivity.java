package com.carmove.fieldconsole;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.webrtc.SurfaceViewRenderer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {
    private static final String PREFS = "carmove_field_console";
    private static final String DASHBOARD_URL = "dashboard_url";
    private static final String AUTH_TOKEN = "auth_token";

    // web.zip design tokens, kept in the native screen as the single visual baseline.
    private static final int PAGE = Color.rgb(241, 245, 249);
    private static final int PANEL = Color.WHITE;
    private static final int CARD = Color.rgb(248, 250, 252);
    private static final int BASE = Color.rgb(226, 232, 240);
    private static final int PRIMARY = Color.rgb(30, 41, 59);
    private static final int SECONDARY = Color.rgb(51, 65, 85);
    private static final int MUTED = Color.rgb(71, 85, 105);
    private static final int DISABLED = Color.rgb(100, 116, 139);
    private static final int ACCENT = Color.rgb(3, 105, 161);
    private static final int ACCENT_LIGHT = Color.rgb(224, 242, 254);
    private static final int GOOD = Color.rgb(4, 120, 87);
    private static final int GOOD_LIGHT = Color.rgb(236, 253, 245);
    private static final int WARN = Color.rgb(180, 83, 9);
    private static final int WARN_LIGHT = Color.rgb(255, 247, 237);
    private static final int DANGER = Color.rgb(185, 28, 28);
    private static final int DANGER_LIGHT = Color.rgb(254, 242, 242);

    private SharedPreferences preferences;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newFixedThreadPool(3);
    private final AtomicBoolean statusRequestInFlight = new AtomicBoolean(false);

    private String dashboardUrl = "";
    private String authToken = "";
    private boolean dashboardVisible = false;
    private boolean webRtcStarted = false;
    private String streamMode = "visible_raw";
    private Runnable pollRunnable;

    private TextView connectionValue;
    private TextView videoState;
    private SurfaceViewRenderer videoRenderer;
    private NativeWebRtcReceiver videoReceiver;
    private TextView batteryValue;
    private TextView batteryDetail;
    private TextView baseValue;
    private TextView captureValue;
    private TextView captureDetail;
    private TextView motionValue;
    private TextView statusMessage;
    private EditText sceneInput;
    private EditText noteInput;
    private EditText intervalInput;
    private EditText durationInput;
    private Spinner streamModeInput;
    private Button loginButton;
    private Button startCaptureButton;
    private Button stopCaptureButton;
    private Button snapshotButton;
    private LinearLayout historyContainer;
    private TextView historySummary;
    private Button refreshHistoryButton;
    private final AtomicBoolean historyRequestInFlight = new AtomicBoolean(false);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(PAGE);
        getWindow().setNavigationBarColor(PAGE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        dashboardUrl = preferences.getString(DASHBOARD_URL, "");
        authToken = preferences.getString(AUTH_TOKEN, "");
        if (dashboardUrl.isEmpty() || authToken.isEmpty()) {
            showConfiguration(dashboardUrl);
        } else {
            showDashboard();
        }
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setIncludeFontPadding(true);
        return view;
    }

    private GradientDrawable background(int fill, int stroke, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        if (stroke != Color.TRANSPARENT) {
            drawable.setStroke(dp(1), stroke);
        }
        return drawable;
    }

    private LinearLayout.LayoutParams params(int width, int height) {
        return new LinearLayout.LayoutParams(width, height);
    }

    private LinearLayout.LayoutParams params(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams layoutParams = new LinearLayout.LayoutParams(width, height);
        layoutParams.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return layoutParams;
    }

    private void addText(LinearLayout parent, String value, float size, int color, int top, int bottom) {
        parent.addView(text(value, size, color), params(-1, -2, 0, top, 0, bottom));
    }

    private LinearLayout baseLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(24));
        root.setBackgroundColor(PAGE);
        return root;
    }

    private ScrollView scrollRoot(LinearLayout content) {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(PAGE);
        scrollView.addView(content, new ScrollView.LayoutParams(-1, -1));
        return scrollView;
    }

    private void showConfiguration(String existingUrl) {
        dashboardVisible = false;
        stopPolling();
        releaseWebRtcStream();

        LinearLayout root = baseLayout();
        addText(root, "CARMOVE / NATIVE ANDROID", 11, ACCENT, 0, 0);
        TextView eyebrow = (TextView) root.getChildAt(root.getChildCount() - 1);
        eyebrow.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);

        TextView title = text("连接现场控制台", 30, PRIMARY);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title, params(-1, -2, 0, 16, 0, 8));
        addText(root, "这是原生 Android 控制台，不依赖 WebView。先通过 Tailscale 连接小车，再填写 Dashboard 地址。", 14, MUTED, 0, 20);

        addText(root, "Dashboard 地址", 12, SECONDARY, 0, 6);
        EditText urlInput = input(existingUrl, "例如 http://100.64.0.10:8080", false);
        root.addView(urlInput, params(-1, dp(50), 0, 0, 0, 12));

        addText(root, "用户名", 12, SECONDARY, 0, 6);
        EditText usernameInput = input("admin", "用户名", false);
        root.addView(usernameInput, params(-1, dp(50), 0, 0, 0, 12));

        addText(root, "密码", 12, SECONDARY, 0, 6);
        EditText passwordInput = input("", "密码", true);
        root.addView(passwordInput, params(-1, dp(50), 0, 0, 0, 16));

        loginButton = actionButton("登录并进入原生控制台", ACCENT, Color.WHITE);
        root.addView(loginButton, params(-1, dp(50)));
        addText(root, "Tailscale 负责手机到小车的私网连接；原生 App 负责状态、采集和控制。", 11, DISABLED, 0, 0);
        ((TextView) root.getChildAt(root.getChildCount() - 1)).setGravity(Gravity.CENTER);

        loginButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                String normalized = normalizeUrl(urlInput.getText().toString());
                String username = usernameInput.getText().toString().trim();
                String password = passwordInput.getText().toString();
                if (normalized.isEmpty()) {
                    urlInput.setError("请填写有效地址");
                    return;
                }
                if (username.isEmpty()) {
                    usernameInput.setError("请填写用户名");
                    return;
                }
                loginButton.setEnabled(false);
                loginButton.setText("连接中…");
                login(normalized, username, password);
            }
        });

        setContentView(scrollRoot(root));
    }

    private EditText input(String value, String hint, boolean password) {
        EditText editText = new EditText(this);
        editText.setSingleLine(true);
        editText.setText(value);
        editText.setHint(hint);
        editText.setHintTextColor(DISABLED);
        editText.setTextColor(SECONDARY);
        editText.setTextSize(14);
        editText.setPadding(dp(13), 0, dp(13), 0);
        editText.setBackground(background(CARD, BASE, 8));
        if (password) {
            editText.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        }
        return editText;
    }

    private Button actionButton(String label, int fill, int textColor) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(textColor);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setMinHeight(dp(44));
        button.setBackground(background(fill, fill, 8));
        return button;
    }

    private LinearLayout section(String title, String subtitle) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(background(PANEL, BASE, 10));
        TextView titleView = text(title, 19, PRIMARY);
        titleView.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        card.addView(titleView, params(-1, -2));
        if (subtitle != null && !subtitle.isEmpty()) {
            card.addView(text(subtitle, 12, MUTED), params(-1, -2, 0, 3, 0, 14));
        } else {
            card.addView(space(0, 12));
        }
        return card;
    }

    private View space(int width, int height) {
        View view = new View(this);
        return setViewParams(view, params(dp(width), dp(height)));
    }

    private View setViewParams(View view, ViewGroup.LayoutParams layoutParams) {
        view.setLayoutParams(layoutParams);
        return view;
    }

    private LinearLayout metricRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        return row;
    }

    private TextView metric(LinearLayout row, String label, TextView[] valueHolder) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(10), dp(12), dp(10));
        card.setBackground(background(CARD, BASE, 8));
        TextView labelView = text(label, 10, MUTED);
        labelView.setTypeface(Typeface.MONOSPACE, Typeface.NORMAL);
        card.addView(labelView, params(-1, -2));
        TextView value = text("--", 16, PRIMARY);
        value.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        card.addView(value, params(-1, -2, 0, 4, 0, 0));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(0, -2, 1f);
        cardParams.setMargins(0, 0, dp(6), 0);
        row.addView(card, cardParams);
        if (valueHolder != null && valueHolder.length > 0) {
            valueHolder[0] = value;
        }
        return value;
    }

    private void addRow(LinearLayout parent, View view, int top, int bottom) {
        parent.addView(view, params(-1, -2, 0, top, 0, bottom));
    }

    private void showDashboard() {
        dashboardVisible = true;
        streamMode = "visible_raw";
        stopPolling();
        stopWebRtcStream();

        LinearLayout root = baseLayout();
        root.setPadding(dp(14), dp(14), dp(14), dp(24));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = text("CARMOVE / NATIVE", 17, PRIMARY);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        toolbar.addView(title, params(0, -2, 0, 0, 0, 0));
        ((LinearLayout.LayoutParams) title.getLayoutParams()).weight = 1f;
        connectionValue = text("连接中", 11, WARN);
        connectionValue.setGravity(Gravity.CENTER);
        connectionValue.setPadding(dp(9), dp(5), dp(9), dp(5));
        connectionValue.setBackground(background(WARN_LIGHT, Color.rgb(253, 186, 116), 6));
        toolbar.addView(connectionValue, params(-2, -2, 6, 0, 6, 0));
        Button settingsButton = actionButton("设置", PANEL, MUTED);
        settingsButton.setTextSize(12);
        settingsButton.setTypeface(Typeface.DEFAULT, Typeface.NORMAL);
        settingsButton.setBackground(background(PANEL, BASE, 7));
        settingsButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showConfiguration(dashboardUrl);
            }
        });
        toolbar.addView(settingsButton, params(dp(56), dp(40)));
        root.addView(toolbar, params(-1, dp(48), 0, 0, 0, 12));

        LinearLayout videoCard = section("实时画面", "原生 WebRTC 接收器直出视频轨道，不再使用 MJPEG 或逐帧 JPEG 解码。");
        videoRenderer = new SurfaceViewRenderer(this);
        videoRenderer.setBackgroundColor(Color.rgb(15, 23, 42));
        videoCard.addView(videoRenderer, params(-1, dp(218), 0, 0, 0, 8));
        videoState = text("视频等待连接", 11, MUTED);
        videoState.setGravity(Gravity.CENTER_VERTICAL);
        videoCard.addView(videoState, params(-1, -2));
        addRow(root, videoCard, 0, 12);

        LinearLayout overview = section("状态概览", "关键状态会自动刷新；电量使用后端滤波后的百分比。");
        LinearLayout firstRow = metricRow();
        TextView[] batteryHolder = new TextView[1];
        metric(firstRow, "电量", batteryHolder);
        batteryValue = batteryHolder[0];
        TextView[] baseHolder = new TextView[1];
        metric(firstRow, "底盘", baseHolder);
        baseValue = baseHolder[0];
        overview.addView(firstRow, params(-1, -2));
        LinearLayout secondRow = metricRow();
        TextView[] captureHolder = new TextView[1];
        metric(secondRow, "采集", captureHolder);
        captureValue = captureHolder[0];
        TextView[] motionHolder = new TextView[1];
        metric(secondRow, "控制", motionHolder);
        motionValue = motionHolder[0];
        overview.addView(secondRow, params(-1, -2, 0, 6, 0, 0));
        batteryDetail = text("电压等待数据", 11, MUTED);
        overview.addView(batteryDetail, params(-1, -2, 0, 10, 0, 0));
        addRow(root, overview, 0, 12);

        LinearLayout capture = section("数据采集", "配置场景和采样周期，采集结果会写入板端 manifest。");
        streamModeInput = new Spinner(this);
        ArrayAdapter<String> modeAdapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, new String[]{"可见光", "红外"});
        modeAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        streamModeInput.setAdapter(modeAdapter);
        streamModeInput.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                String nextMode = position == 1 ? "ir_raw" : "visible_raw";
                if (nextMode.equals(streamMode)) return;
                streamMode = nextMode;
                if (dashboardVisible) {
                    restartWebRtcStream();
                }
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                // Keep the last selected source when the spinner temporarily has no selection.
            }
        });
        capture.addView(streamModeInput, params(-1, dp(46), 0, 0, 0, 8));
        sceneInput = input("gate_a_day", "场景名称", false);
        capture.addView(sceneInput, params(-1, dp(46), 0, 0, 0, 8));
        noteInput = input("园区入口，白天，垃圾和车辆", "备注（可选）", false);
        capture.addView(noteInput, params(-1, dp(46), 0, 0, 0, 8));
        LinearLayout timing = new LinearLayout(this);
        timing.setOrientation(LinearLayout.HORIZONTAL);
        intervalInput = input("1", "间隔秒", false);
        durationInput = input("3", "时长分钟", false);
        timing.addView(intervalInput, params(0, dp(46), 0, 0, 6, 0));
        ((LinearLayout.LayoutParams) intervalInput.getLayoutParams()).weight = 1f;
        timing.addView(durationInput, params(0, dp(46), 6, 0, 0, 0));
        ((LinearLayout.LayoutParams) durationInput.getLayoutParams()).weight = 1f;
        capture.addView(timing, params(-1, dp(46), 0, 0, 0, 10));
        LinearLayout captureButtons = new LinearLayout(this);
        captureButtons.setOrientation(LinearLayout.HORIZONTAL);
        startCaptureButton = actionButton("开始采集", ACCENT, Color.WHITE);
        stopCaptureButton = actionButton("停止", PANEL, DANGER);
        stopCaptureButton.setBackground(background(DANGER_LIGHT, Color.rgb(254, 202, 202), 8));
        snapshotButton = actionButton("立即拍照", PANEL, ACCENT);
        snapshotButton.setBackground(background(ACCENT_LIGHT, Color.rgb(125, 211, 252), 8));
        addWeighted(captureButtons, startCaptureButton, 0, 0, 4);
        addWeighted(captureButtons, stopCaptureButton, 4, 0, 4);
        addWeighted(captureButtons, snapshotButton, 4, 0, 0);
        capture.addView(captureButtons, params(-1, dp(48)));
        captureValue.setText("空闲");
        captureDetail = text("尚未开始采集", 11, MUTED);
        capture.addView(captureDetail, params(-1, -2, 0, 10, 0, 0));
        addRow(root, capture, 0, 12);

        startCaptureButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startCapture();
            }
        });
        stopCaptureButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                stopCapture();
            }
        });
        snapshotButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                takeSnapshot();
            }
        });

        LinearLayout controls = section("基础控制", "后端安全锁仍然生效；未解锁或非 real 模式时，底盘会拒绝运动命令。");
        addControlPad(controls);
        Button emergency = actionButton("急停", DANGER, Color.WHITE);
        emergency.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                sendControl("emergency-stop", true);
            }
        });
        controls.addView(emergency, params(-1, dp(48), 0, 8, 0, 0));
        addRow(root, controls, 0, 12);

        LinearLayout history = section("采集记录", "已完成的采集段按场景归档，点击刷新查看最近一帧。");
        LinearLayout historyHeader = new LinearLayout(this);
        historyHeader.setGravity(Gravity.CENTER_VERTICAL);
        historySummary = text("尚未加载", 11, MUTED);
        historyHeader.addView(historySummary, params(0, -2, 0, 0, 6, 0));
        ((LinearLayout.LayoutParams) historySummary.getLayoutParams()).weight = 1f;
        refreshHistoryButton = actionButton("刷新记录", PANEL, ACCENT);
        refreshHistoryButton.setTextSize(12);
        refreshHistoryButton.setTypeface(Typeface.DEFAULT, Typeface.NORMAL);
        refreshHistoryButton.setBackground(background(PANEL, BASE, 7));
        historyHeader.addView(refreshHistoryButton, params(dp(88), dp(38)));
        history.addView(historyHeader, params(-1, dp(40), 0, 0, 0, 8));
        historyContainer = new LinearLayout(this);
        historyContainer.setOrientation(LinearLayout.VERTICAL);
        history.addView(historyContainer, params(-1, -2));
        refreshHistoryButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                loadCaptureHistory();
            }
        });
        addRow(root, history, 0, 12);

        statusMessage = text("等待状态刷新…", 12, MUTED);
        statusMessage.setGravity(Gravity.CENTER);
        root.addView(statusMessage, params(-1, -2, 0, 4, 0, 0));
        setContentView(scrollRoot(root));

        startPolling();
        videoReceiver = new NativeWebRtcReceiver(this, videoRenderer);
        startWebRtcStream();
        loadCaptureHistory();
    }

    private void addWeighted(LinearLayout parent, View child, int left, int right, int end) {
        LinearLayout.LayoutParams layoutParams = new LinearLayout.LayoutParams(0, -1, 1f);
        layoutParams.setMargins(dp(left), 0, dp(right + end), 0);
        parent.addView(child, layoutParams);
    }

    private void addControlPad(LinearLayout parent) {
        Button forward = actionButton("前进", PANEL, SECONDARY);
        forward.setBackground(background(CARD, BASE, 8));
        forward.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                sendControl("forward", false);
            }
        });
        parent.addView(forward, params(-1, dp(46), 0, 0, 0, 6));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        addControlButton(row, "左转", "left", true);
        addControlButton(row, "停止", "stop", true);
        addControlButton(row, "右转", "right", false);
        parent.addView(row, params(-1, dp(46), 0, 0, 0, 6));
        Button backward = actionButton("后退", PANEL, SECONDARY);
        backward.setBackground(background(CARD, BASE, 8));
        backward.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                sendControl("backward", false);
            }
        });
        parent.addView(backward, params(-1, dp(46)));
    }

    private void addControlButton(LinearLayout parent, String label, String command, boolean withMargin) {
        Button button = actionButton(label, command.equals("stop") ? DANGER_LIGHT : PANEL, command.equals("stop") ? DANGER : SECONDARY);
        button.setBackground(background(command.equals("stop") ? DANGER_LIGHT : CARD, command.equals("stop") ? Color.rgb(254, 202, 202) : BASE, 8));
        button.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                sendControl(command, false);
            }
        });
        LinearLayout.LayoutParams layoutParams = new LinearLayout.LayoutParams(0, -1, 1f);
        layoutParams.setMargins(0, 0, withMargin ? dp(6) : 0, 0);
        parent.addView(button, layoutParams);
    }

    private void loadCaptureHistory() {
        if (historyContainer == null || !dashboardVisible) return;
        if (!historyRequestInFlight.compareAndSet(false, true)) return;
        if (refreshHistoryButton != null) {
            refreshHistoryButton.setEnabled(false);
            refreshHistoryButton.setText("加载中…");
        }
        if (historySummary != null) historySummary.setText("正在读取采集记录…");
        networkExecutor.submit(new Runnable() {
            @Override
            public void run() {
                try {
                    String response = request(dashboardUrl + "/api/capture/gallery?page=1&page_size=12", "GET", authToken, null);
                    String trimmed = response.trim();
                    final JSONArray items;
                    if (trimmed.startsWith("[")) {
                        items = new JSONArray(trimmed);
                    } else {
                        JSONArray wrappedItems = new JSONObject(trimmed).optJSONArray("items");
                        items = wrappedItems == null ? new JSONArray() : wrappedItems;
                    }
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            renderCaptureHistory(items);
                        }
                    });
                } catch (final Exception error) {
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            if (historySummary != null) historySummary.setText("读取失败");
                            showMessage("采集记录读取失败：" + explain(error), true);
                        }
                    });
                } finally {
                    historyRequestInFlight.set(false);
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            if (refreshHistoryButton != null) {
                                refreshHistoryButton.setEnabled(true);
                                refreshHistoryButton.setText("刷新记录");
                            }
                        }
                    });
                }
            }
        });
    }

    private void renderCaptureHistory(JSONArray items) {
        if (historyContainer == null) return;
        historyContainer.removeAllViews();
        int count = items == null ? 0 : items.length();
        historySummary.setText(count == 0 ? "暂无已完成采集" : count + " 段已完成");
        if (count == 0) {
            TextView empty = text("完成一次采集后，最近一帧和 manifest 会显示在这里。", 12, MUTED);
            historyContainer.addView(empty, params(-1, -2, 0, 4, 0, 4));
            return;
        }

        for (int index = 0; index < count; index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            String group = item.optString("group", "");
            String scene = item.optString("scene", "未命名场景");
            String mode = historyModeLabel(item.optString("stream_mode", "unknown"));
            int frames = item.optInt("frames_saved", 0);
            String capturedAt = formatHistoryTime(item.optString("last_captured_at", ""));
            String note = item.optString("note", "").trim();
            if (note.isEmpty()) note = item.optString("manifest_name", "manifest 未命名");

            LinearLayout historyItem = new LinearLayout(this);
            historyItem.setOrientation(LinearLayout.HORIZONTAL);
            historyItem.setGravity(Gravity.CENTER_VERTICAL);
            historyItem.setPadding(dp(10), dp(10), dp(10), dp(10));
            historyItem.setBackground(background(CARD, BASE, 8));

            ImageView thumbnail = new ImageView(this);
            thumbnail.setScaleType(ImageView.ScaleType.CENTER_CROP);
            thumbnail.setBackgroundColor(BASE);
            thumbnail.setContentDescription(scene + " 最近一帧");
            thumbnail.setTag(group);
            historyItem.addView(thumbnail, params(dp(96), dp(72)));

            LinearLayout body = new LinearLayout(this);
            body.setOrientation(LinearLayout.VERTICAL);
            TextView title = text(scene, 14, PRIMARY);
            title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            body.addView(title, params(-1, -2));
            body.addView(text(mode + " · " + frames + " 帧 · " + capturedAt, 11, MUTED), params(-1, -2, 0, 4, 0, 0));
            body.addView(text(note, 11, SECONDARY), params(-1, -2, 0, 5, 0, 0));
            LinearLayout.LayoutParams bodyParams = params(0, -2, 9, 0, 0, 0);
            bodyParams.weight = 1f;
            historyItem.addView(body, bodyParams);
            historyContainer.addView(historyItem, params(-1, -2, 0, 0, 0, 8));

            if (!group.isEmpty() && !item.optString("latest_frame_name", "").isEmpty()) {
                loadHistoryThumbnail(group, thumbnail);
            }
        }
    }

    private String historyModeLabel(String mode) {
        if ("ir_raw".equals(mode)) return "红外";
        if ("visible_raw".equals(mode)) return "可见光";
        return "来源未标记";
    }

    private String formatHistoryTime(String value) {
        if (value == null || value.isEmpty()) return "时间未知";
        String result = value.replace('T', ' ');
        int plus = result.indexOf('+');
        if (plus > 0) result = result.substring(0, plus);
        int dot = result.indexOf('.');
        if (dot > 0) result = result.substring(0, dot);
        return result;
    }

    private void loadHistoryThumbnail(final String group, final ImageView imageView) {
        networkExecutor.submit(new Runnable() {
            @Override
            public void run() {
                try {
                    byte[] imageBytes = requestBytes(
                            dashboardUrl + "/api/capture/gallery/" + Uri.encode(group) + "/latest",
                            authToken
                    );
                    final Bitmap bitmap = decodeThumbnail(imageBytes, dp(96), dp(72));
                    if (bitmap == null) return;
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            if (group.equals(imageView.getTag())) imageView.setImageBitmap(bitmap);
                        }
                    });
                } catch (Exception ignored) {
                    // Keep the neutral thumbnail when a session frame has been removed or is unavailable.
                }
            }
        });
    }

    private Bitmap decodeThumbnail(byte[] bytes, int targetWidth, int targetHeight) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        int sample = 1;
        while (bounds.outWidth / sample > targetWidth * 2 || bounds.outHeight / sample > targetHeight * 2) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    private void login(final String url, final String username, final String password) {
        networkExecutor.submit(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject body = new JSONObject();
                    body.put("username", username);
                    body.put("password", password);
                    String response = request(url + "/api/auth/login", "POST", "", body.toString());
                    String newToken = new JSONObject(response).optString("token", "");
                    if (newToken.isEmpty()) {
                        throw new IOException("登录响应中没有 token");
                    }
                    dashboardUrl = url;
                    authToken = newToken;
                    preferences.edit().putString(DASHBOARD_URL, dashboardUrl).putString(AUTH_TOKEN, authToken).apply();
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            showDashboard();
                        }
                    });
                } catch (final Exception error) {
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            loginButton.setEnabled(true);
                            loginButton.setText("登录并进入原生控制台");
                            showMessage("登录失败：" + explain(error), true);
                        }
                    });
                }
            }
        });
    }

    private void startPolling() {
        stopPolling();
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                if (!dashboardVisible || authToken.isEmpty()) return;
                refreshStatus();
                mainHandler.postDelayed(this, 2000);
            }
        };
        mainHandler.post(pollRunnable);
    }

    private void stopPolling() {
        if (pollRunnable != null) {
            mainHandler.removeCallbacks(pollRunnable);
            pollRunnable = null;
        }
    }

    private void refreshStatus() {
        if (!statusRequestInFlight.compareAndSet(false, true)) return;
        networkExecutor.submit(new Runnable() {
            @Override
            public void run() {
                try {
                    String statusResponse = request(dashboardUrl + "/api/system/status", "GET", authToken, null);
                    String captureResponse = request(dashboardUrl + "/api/capture/status", "GET", authToken, null);
                    final JSONObject status = new JSONObject(statusResponse);
                    final JSONObject capture = new JSONObject(captureResponse);
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            applyStatus(status, capture);
                        }
                    });
                } catch (final Exception error) {
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            connectionValue.setText("离线");
                            connectionValue.setTextColor(DANGER);
                            connectionValue.setBackground(background(DANGER_LIGHT, Color.rgb(254, 202, 202), 6));
                            showMessage("连接异常：" + explain(error), true);
                        }
                    });
                } finally {
                    statusRequestInFlight.set(false);
                }
            }
        });
    }

    private void applyStatus(JSONObject status, JSONObject capture) {
        boolean agent = status.optBoolean("agent_online", false);
        boolean board = status.optBoolean("board_online", false);
        connectionValue.setText(agent && board ? "在线" : agent ? "Agent 在线" : "离线");
        connectionValue.setTextColor(agent && board ? GOOD : WARN);
        connectionValue.setBackground(background(agent && board ? GOOD_LIGHT : WARN_LIGHT, agent && board ? Color.rgb(167, 243, 208) : Color.rgb(253, 186, 116), 6));

        JSONObject battery = status.optJSONObject("battery_status");
        boolean batteryAvailable = battery != null && battery.optBoolean("available", false);
        double voltage = batteryAvailable ? battery.optDouble("voltage", Double.NaN) : Double.NaN;
        double percentage = batteryAvailable ? battery.optDouble("percentage", Double.NaN) : Double.NaN;
        batteryValue.setText(!Double.isNaN(percentage) ? String.format(Locale.US, "%.0f%%", percentage) : !Double.isNaN(voltage) ? String.format(Locale.US, "%.1fV", voltage) : "未知");
        batteryValue.setTextColor(!Double.isNaN(voltage) && voltage < 20.0 ? DANGER : !Double.isNaN(voltage) && voltage < 21.0 ? WARN : PRIMARY);
        if (!Double.isNaN(voltage)) {
            String charging = battery != null && battery.optBoolean("charging", false) ? " · 充电中" : "";
            batteryDetail.setText(String.format(Locale.US, "电压 %.2fV%s · 后端已滤波", voltage, charging));
        } else {
            batteryDetail.setText("电压等待数据");
        }

        JSONObject base = status.optJSONObject("base_status");
        boolean baseRunning = base != null && base.optBoolean("running", false);
        baseValue.setText(baseRunning ? "已启动" : "未启动");
        baseValue.setTextColor(baseRunning ? GOOD : MUTED);

        boolean captureRunning = capture.optBoolean("running", false);
        captureValue.setText(captureRunning ? "采集中" : "空闲");
        captureValue.setTextColor(captureRunning ? ACCENT : MUTED);
        if (captureRunning) {
            captureDetail.setText(String.format(Locale.US, "%s · 已保存 %d 帧", capture.optString("scene", "采集"), capture.optInt("frames_saved", 0)));
        } else if (!capture.optString("last_error", "").isEmpty()) {
            captureDetail.setText("采集错误：" + capture.optString("last_error"));
        } else {
            captureDetail.setText("尚未开始采集");
        }
        startCaptureButton.setEnabled(!captureRunning);
        stopCaptureButton.setEnabled(captureRunning);

        JSONObject motion = status.optJSONObject("motion_state");
        if (motion != null) {
            String mode = motion.optString("mode", "dry_run");
            boolean armed = motion.optBoolean("armed", false);
            motionValue.setText(mode + (armed ? " / 解锁" : " / 锁定"));
        } else {
            motionValue.setText("等待");
        }
        showMessage("状态已更新", false);
    }

    private void startCapture() {
        String scene = sceneInput.getText().toString().trim();
        if (scene.isEmpty()) {
            sceneInput.setError("请填写场景名称");
            return;
        }
        double interval;
        double durationMinutes;
        try {
            interval = Double.parseDouble(intervalInput.getText().toString().trim());
            durationMinutes = Double.parseDouble(durationInput.getText().toString().trim());
        } catch (NumberFormatException error) {
            showMessage("间隔和时长必须是数字", true);
            return;
        }
        if (interval < 0.2 || interval > 60 || durationMinutes < 0 || durationMinutes > 60) {
            showMessage("间隔范围 0.2–60 秒，时长范围 0–60 分钟", true);
            return;
        }
        try {
            JSONObject body = new JSONObject();
            body.put("stream_mode", streamModeInput.getSelectedItemPosition() == 1 ? "ir_raw" : "visible_raw");
            body.put("scene", scene);
            body.put("note", noteInput.getText().toString().trim());
            body.put("interval_seconds", interval);
            body.put("duration_seconds", durationMinutes * 60.0);
            body.put("max_frames", 0);
            body.put("jpeg_quality", 95);
            postAction("/api/capture/start", body.toString(), "采集已启动");
        } catch (Exception error) {
            showMessage("采集参数无效", true);
        }
    }

    private void stopCapture() {
        postAction("/api/capture/stop", null, "采集已停止");
    }

    private void takeSnapshot() {
        try {
            JSONObject body = new JSONObject();
            body.put("stream_mode", streamModeInput.getSelectedItemPosition() == 1 ? "ir_raw" : "visible_raw");
            postAction("/api/media/snapshot", body.toString(), "拍照请求已发送");
        } catch (Exception error) {
            showMessage("拍照参数无效", true);
        }
    }

    private void sendControl(final String command, boolean emergency) {
        if (emergency) {
            postAction("/api/control/emergency-stop", null, "急停已发送");
            return;
        }
        try {
            JSONObject body = new JSONObject();
            body.put("command", command);
            body.put("speed", "low");
            postAction("/api/control/send", body.toString(), command + " 命令已发送");
        } catch (Exception error) {
            showMessage("控制参数无效", true);
        }
    }

    private void postAction(final String path, final String body, final String successMessage) {
        networkExecutor.submit(new Runnable() {
            @Override
            public void run() {
                try {
                    request(dashboardUrl + path, "POST", authToken, body);
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            showMessage(successMessage, false);
                            refreshStatus();
                            if (path.startsWith("/api/capture/")) loadCaptureHistory();
                        }
                    });
                } catch (final Exception error) {
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            showMessage("操作失败：" + explain(error), true);
                        }
                    });
                }
            }
        });
    }

    private void showMessage(String message, boolean error) {
        if (statusMessage == null) return;
        statusMessage.setText(message);
        statusMessage.setTextColor(error ? DANGER : MUTED);
    }

    private String request(String urlValue, String method, String bearer, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlValue).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(6000);
        connection.setReadTimeout(10000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        if (bearer != null && !bearer.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + bearer);
        }
        if (body != null) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setFixedLengthStreamingMode(bytes.length);
            connection.getOutputStream().write(bytes);
        }
        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String response = stream == null ? "" : readAll(stream);
        connection.disconnect();
        if (code < 200 || code >= 300) {
            throw new IOException(response.isEmpty() ? "HTTP " + code : response);
        }
        return response;
    }

    private String readAll(InputStream stream) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = stream.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
        stream.close();
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }

    private byte[] requestBytes(String urlValue, String bearer) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlValue).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(6000);
        connection.setReadTimeout(10000);
        connection.setUseCaches(false);
        if (bearer != null && !bearer.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + bearer);
        }
        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        byte[] response = stream == null ? new byte[0] : readBytes(stream);
        connection.disconnect();
        if (code < 200 || code >= 300) {
            throw new IOException("HTTP " + code);
        }
        return response;
    }

    private byte[] readBytes(InputStream stream) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
        stream.close();
        return output.toByteArray();
    }

    private void startWebRtcStream() {
        if (!dashboardVisible || videoReceiver == null) return;
        if (webRtcStarted) return;
        webRtcStarted = true;
        final String requestedMode = streamMode;
        videoReceiver.start(requestedMode, new NativeWebRtcReceiver.SignalingClient() {
            @Override
            public String createAnswer(String sdp, String type, String streamMode) throws Exception {
                JSONObject body = new JSONObject();
                body.put("sdp", sdp);
                body.put("type", type);
                body.put("stream_mode", streamMode);
                return request(dashboardUrl + "/api/stream/webrtc-offer", "POST", authToken, body.toString());
            }
        }, new NativeWebRtcReceiver.Listener() {
            @Override
            public void onState(final String state, final String detail) {
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (videoState == null || !dashboardVisible || !requestedMode.equals(streamMode)) return;
                        videoState.setText(detail);
                        videoState.setTextColor("failed".equals(state) ? DANGER : "connected".equals(state) ? GOOD : MUTED);
                        if ("failed".equals(state)) {
                            webRtcStarted = false;
                            mainHandler.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    if (dashboardVisible && requestedMode.equals(streamMode)) startWebRtcStream();
                                }
                            }, 1500);
                        }
                    }
                });
            }
        });
    }

    private void restartWebRtcStream() {
        stopWebRtcStream();
        startWebRtcStream();
    }

    private void stopWebRtcStream() {
        webRtcStarted = false;
        if (videoReceiver != null) videoReceiver.stop();
    }

    private void releaseWebRtcStream() {
        if (videoReceiver != null) {
            videoReceiver.release();
            videoReceiver = null;
        }
        videoRenderer = null;
    }

    private String explain(Exception error) {
        String message = error.getMessage();
        if (message == null || message.isEmpty()) return "网络请求失败";
        if (message.contains("invalid credentials")) return "用户名或密码不正确";
        if (message.contains("missing bearer") || message.contains("invalid token")) return "登录已过期，请重新登录";
        if (message.contains("base is not ready")) return "底盘未就绪";
        if (message.contains("manual control is locked")) return "手动控制已锁定";
        if (message.contains("Connection refused")) return "无法连接 Dashboard";
        return message.replace("\n", " ").replace("\r", "");
    }

    private String normalizeUrl(String raw) {
        String value = raw.trim();
        if (value.isEmpty()) return "";
        if (!value.toLowerCase(Locale.US).startsWith("http://") && !value.toLowerCase(Locale.US).startsWith("https://")) {
            value = "http://" + value;
        }
        Uri parsed = Uri.parse(value);
        if (parsed.getHost() == null) return "";
        return value.replaceAll("/+$", "");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (dashboardVisible) {
            startPolling();
            startWebRtcStream();
        }
    }

    @Override
    protected void onPause() {
        stopPolling();
        stopWebRtcStream();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        dashboardVisible = false;
        stopPolling();
        releaseWebRtcStream();
        networkExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (dashboardVisible) {
            showConfiguration(dashboardUrl);
        } else {
            super.onBackPressed();
        }
    }
}

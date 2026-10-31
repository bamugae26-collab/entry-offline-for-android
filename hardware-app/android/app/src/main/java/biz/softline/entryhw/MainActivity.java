package biz.softline.entryhw;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * Entry Android Hardware — 화면
 *  - 연결 프로그램 화면(PC 엔트리 하드웨어 연결 프로그램과 같은 화면)을 WebView 로 띄운다 (Node 가 127.0.0.1:23519 에서 제공)
 *  - Entry for Android 에서 [연결 프로그램 열기]로 열렸으면, 하드웨어가 연결되는 순간 Entry for Android 로 돌아간다
 *    (이 앱은 닫지 않고 뒤에서 연결을 유지)
 */
public class MainActivity extends Activity implements HardwareService.UiListener {
    private static final String UI_URL = "http://127.0.0.1:23519/";
    private static final String DEFAULT_ENTRY_PACKAGE = "biz.softline.entrylocal";

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private View loading;
    private TextView loadingText;
    private boolean resumed;
    /** Entry for Android 가 열었는가 → 연결되면 돌아간다 (한 번) */
    private boolean returnToEntry;
    private String entryPackage = DEFAULT_ENTRY_PACKAGE;
    private boolean uiLoaded;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("127.0.0.1".equals(uri.getHost())) return false;
                openUrl(uri.toString());
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.WHITE);
        ProgressBar bar = new ProgressBar(this);
        box.addView(bar);
        loadingText = new TextView(this);
        loadingText.setText(HardwareService.tr("연결 프로그램을 준비하고 있습니다…", "Starting the hardware program…"));
        loadingText.setTextColor(Color.parseColor("#2C313D"));
        loadingText.setTextSize(16);
        loadingText.setGravity(Gravity.CENTER);
        loadingText.setPadding(40, 30, 40, 0);
        box.addView(loadingText);
        loading = box;
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        fitSystemBars(root);

        askPermissions();
        HardwareService.start(this);
        handleIntent(getIntent());
        waitForUi();
    }

    /** 연결 프로그램 화면 위쪽 파란 띠와 같은 색 */
    private static final int HEADER_COLOR = Color.parseColor("#5096F5");

    /**
     * 안드로이드 15 이상은 앱 화면이 상태 표시줄·내비게이션 바 밑까지 깔린다(edge-to-edge 강제)
     * → 화면이 막대 밑으로 들어가 잘리지 않게 그만큼 비우고, 위쪽 빈칸은 머리 띠 색으로 칠한다
     */
    private void fitSystemBars(FrameLayout root) {
        if (Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                // 위: 파란 바탕 → 흰 아이콘 / 아래: 흰 바탕 → 어두운 아이콘
                c.setSystemBarsAppearance(android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                                | android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            }
        } else if (Build.VERSION.SDK_INT >= 26) {
            View d = getWindow().getDecorView();
            d.setSystemUiVisibility(d.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        if (Build.VERSION.SDK_INT < 35) return; // 그 아래는 시스템이 막대를 피해 화면을 놓는다
        final View top = new View(this);
        top.setBackgroundColor(HEADER_COLOR);
        root.addView(top, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets b = insets.getInsets(android.view.WindowInsets.Type.systemBars()
                    | android.view.WindowInsets.Type.displayCutout());
            for (View child : new View[] { web, loading }) {
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) child.getLayoutParams();
                lp.setMargins(b.left, b.top, b.right, b.bottom);
                child.setLayoutParams(lp);
            }
            FrameLayout.LayoutParams tp = (FrameLayout.LayoutParams) top.getLayoutParams();
            tp.height = b.top;
            top.setLayoutParams(tp);
            return android.view.WindowInsets.CONSUMED;
        });
        root.requestApplyInsets();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("fromEntry", false)) return;
        returnToEntry = true;
        String pkg = intent.getStringExtra("entryPackage");
        entryPackage = pkg == null || pkg.isEmpty() ? DEFAULT_ENTRY_PACKAGE : pkg;
        HardwareService.notifyLaunch(intent.getStringExtra("roomId"));
        // 같은 요청을 다시 처리하지 않게
        intent.removeExtra("fromEntry");
    }

    /** 처음 실행: 알림(안드로이드 13+) · 근처 기기(블루투스 시리얼, 12+) 권한 */
    private void askPermissions() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> want = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            want.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            want.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (!want.isEmpty()) requestPermissions(want.toArray(new String[0]), 1);
    }

    /** Node 가 화면을 줄 수 있을 때까지 기다렸다가 연다 (처음 실행은 파일 복사 때문에 몇 초) */
    private void waitForUi() {
        new Thread(() -> {
            long until = System.currentTimeMillis() + 90_000;
            while (System.currentTimeMillis() < until) {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(UI_URL).openConnection();
                    c.setConnectTimeout(500);
                    c.setReadTimeout(1000);
                    int code = c.getResponseCode();
                    c.disconnect();
                    if (code == 200) {
                        main.post(this::showUi);
                        return;
                    }
                } catch (Exception ignored) {
                    // 아직
                }
                try {
                    Thread.sleep(300);
                } catch (InterruptedException e) {
                    return;
                }
            }
            main.post(() -> loadingText.setText(HardwareService.tr(
                "연결 프로그램을 시작하지 못했습니다. 앱을 완전히 종료한 뒤 다시 실행해 주세요.",
                "The hardware program could not start. Quit the app completely and open it again.")));
        }, "EntryHwWaitUi").start();
    }

    private void showUi() {
        if (uiLoaded) return;
        uiLoaded = true;
        web.loadUrl(UI_URL);
        main.postDelayed(() -> loading.setVisibility(View.GONE), 400);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        HardwareService.setUiListener(this);
    }

    @Override
    protected void onPause() {
        resumed = false;
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        HardwareService.setUiListener(null);
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** 뒤로: 앱을 닫지 않고 뒤로 보낸다 (연결 유지). 끝내려면 알림의 [종료] */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    // ── 연결 프로그램(Node) 알림 ─────────────────────────────

    @Override
    public void onHardwareState(String state, String name) {
        if ("connected".equals(state) && returnToEntry && resumed) {
            returnToEntry = false;
            Toast.makeText(this, HardwareService.tr(
                name + " 연결됨 — Entry for Android 로 돌아갑니다",
                name + " connected — returning to Entry for Android"), Toast.LENGTH_SHORT).show();
            main.postDelayed(this::openEntry, 1200);
        }
    }

    @Override
    public void onOpenEntryRequested() {
        openEntry();
    }

    @Override
    public void onOpenUrl(String url) {
        openUrl(url);
    }

    private void openEntry() {
        Intent intent = getPackageManager().getLaunchIntentForPackage(entryPackage);
        if (intent == null && !DEFAULT_ENTRY_PACKAGE.equals(entryPackage)) {
            intent = getPackageManager().getLaunchIntentForPackage(DEFAULT_ENTRY_PACKAGE);
        }
        if (intent == null) {
            Toast.makeText(this, HardwareService.tr("Entry for Android 가 설치되어 있지 않습니다.", "Entry for Android is not installed."), Toast.LENGTH_LONG).show();
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(intent);
    }

    private void openUrl(String url) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            Toast.makeText(this, url, Toast.LENGTH_LONG).show();
        }
    }
}

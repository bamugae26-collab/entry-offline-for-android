package biz.softline.entryhw;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import java.security.SecureRandom;
import java.util.Locale;
import org.json.JSONObject;

/**
 * 연결 프로그램을 뒤에서도 계속 돌리는 서비스 (알림창: '하드웨어 연결 프로그램 실행 중').
 * Entry for Android 로 돌아가 코딩하는 동안에도 하드웨어 연결이 끊기지 않게 한다.
 *  - Node(연결 프로그램 본체) 시작, Java 쪽 통로(NodeBridge: USB·블루투스 시리얼) 유지
 *  - 알림의 [종료] : 연결을 닫고 앱 프로세스를 끝낸다 (Node 는 다시 켤 수 없으므로)
 */
public class HardwareService extends Service implements NodeBridge.Notifications {
    interface UiListener {
        void onHardwareState(String state, String name);

        void onOpenEntryRequested();

        void onOpenUrl(String url);
    }

    static final String ACTION_STOP = "biz.softline.entryhw.STOP";
    private static final String CHANNEL = "entry-hw";
    private static final int NOTIFICATION_ID = 23518;

    private static HardwareService instance;
    private static UiListener uiListener;
    private static String lastState = "";
    private static String lastName = "";
    /** Node 와 같은 값이어야 하므로 프로세스마다 한 번만 만든다 (Node 는 프로세스당 한 번만 켜짐) */
    private static final String TOKEN = newToken();
    /** 서비스가 아직 준비되기 전에 들어온 '엔트리가 열었음' 알림 */
    private static JSONObject pendingLaunch;

    private final Handler main = new Handler(Looper.getMainLooper());
    private NodeBridge bridge;
    private PowerManager.WakeLock wakeLock;

    static void setUiListener(UiListener listener) {
        uiListener = listener;
        if (listener != null && !lastState.isEmpty()) listener.onHardwareState(lastState, lastName);
    }

    static boolean isKorean() {
        return "ko".equals(Locale.getDefault().getLanguage());
    }

    static String tr(String ko, String en) {
        return isKorean() ? ko : en;
    }

    static void start(Context context) {
        Intent intent = new Intent(context, HardwareService.class);
        if (Build.VERSION.SDK_INT >= 26) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    /** 엔트리가 연결 프로그램을 열었음 (roomId) */
    static void notifyLaunch(String roomId) {
        try {
            JSONObject e = new JSONObject().put("event", "launch");
            if (roomId != null && !roomId.isEmpty()) e.put("roomId", roomId);
            HardwareService s = instance;
            if (s == null || s.bridge == null) {
                pendingLaunch = e;
            } else {
                s.bridge.sendEvent(e);
            }
        } catch (Exception ignored) {
            // 무시
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        Notification n = buildNotification(tr("하드웨어 연결 프로그램 실행 중", "Hardware program running"));
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        bridge = new NodeBridge(this, TOKEN, this);
        NodeRunner.start(this, TOKEN, isKorean() ? "ko" : "en");
        if (pendingLaunch != null) {
            bridge.sendEvent(pendingLaunch);
            pendingLaunch = null;
        }
        try {
            // 화면이 꺼져도 하드웨어와 계속 주고받도록 (연결 프로그램이 켜져 있는 동안만)
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "EntryHw:connection");
            wakeLock.setReferenceCounted(false);
        } catch (Exception ignored) {
            // 없음
        }
    }

    private static String newToken() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            shutdownApp();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    /**
     * 최근 앱 목록에서 이 앱 창을 밀어 지웠다 → [종료]와 똑같이 끝낸다.
     * 연결 프로그램(127.0.0.1:23518)이 꺼져야 Entry for Android 의 하드웨어 칸이 처음 화면([하드웨어 연결하기])으로 돌아간다.
     * (연결된 뒤 Entry for Android 로 넘어갈 때는 창을 지우지 않고 뒤로 보내므로 연결은 그대로 유지된다)
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        shutdownApp();
        super.onTaskRemoved(rootIntent);
    }

    private boolean shuttingDown;

    /** [종료] — 하드웨어 연결을 닫고 앱을 끝낸다 */
    void shutdownApp() {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
            if (bridge != null) bridge.sendEvent(new JSONObject().put("event", "stop"));
        } catch (Exception ignored) {
            // 무시
        }
        main.postDelayed(() -> {
            if (bridge != null) bridge.shutdown();
            if (Build.VERSION.SDK_INT >= 24) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            }
            // 서비스가 먼저 정상 종료되어야 시스템이 다시 살리지 않는다(START_STICKY) → onDestroy 에서 프로세스를 끝낸다
            stopSelf();
            // 혹시 onDestroy 가 늦으면
            main.postDelayed(() -> android.os.Process.killProcess(android.os.Process.myPid()), 1500);
        }, 400);
    }

    @Override
    public void onNodeMessage(String cmd, JSONObject msg) {
        main.post(() -> {
            switch (cmd) {
                case "state": {
                    lastState = msg.optString("state", "");
                    lastName = msg.optString("name", "");
                    updateNotification();
                    if (uiListener != null) uiListener.onHardwareState(lastState, lastName);
                    break;
                }
                case "openEntry":
                    if (uiListener != null) uiListener.onOpenEntryRequested();
                    break;
                case "openUrl": {
                    String url = msg.optString("url", "");
                    if (uiListener != null) {
                        uiListener.onOpenUrl(url);
                    } else if (url.startsWith("http://") || url.startsWith("https://")) {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        } catch (Exception ignored) {
                            // 브라우저 없음
                        }
                    }
                    break;
                }
                default:
                    break;
            }
        });
    }

    private void updateNotification() {
        String text;
        boolean connected = "connected".equals(lastState);
        if (connected) {
            text = tr(lastName + " 연결됨", lastName + " connected");
        } else if ("scan".equals(lastState) || "connect".equals(lastState) || "before_connect".equals(lastState) || "lost".equals(lastState)) {
            text = tr("하드웨어 연결 중…", "Connecting hardware…");
        } else {
            text = tr("하드웨어 연결 프로그램 실행 중", "Hardware program running");
        }
        try {
            if (wakeLock != null) {
                if (connected && !wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
                if (!connected && wakeLock.isHeld()) wakeLock.release();
            }
        } catch (Exception ignored) {
            // 무시
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, tr("하드웨어 연결", "Hardware connection"), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    @SuppressWarnings("deprecation")
    private Notification buildNotification(String text) {
        int immutable = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(this, 0,
            new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT), immutable);
        PendingIntent stop = PendingIntent.getService(this, 1,
            new Intent(this, HardwareService.class).setAction(ACTION_STOP), immutable);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Entry Android Hardware")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(new Notification.Action.Builder(0, tr("종료", "Quit"), stop).build());
        return b.build();
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (bridge != null) bridge.shutdown();
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
            // 무시
        }
        super.onDestroy();
        // Node(연결 프로그램 본체)는 프로세스 안에서 돌기 때문에 프로세스째 끝내야 23518 포트가 닫힌다
        if (shuttingDown) main.post(() -> android.os.Process.killProcess(android.os.Process.myPid()));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

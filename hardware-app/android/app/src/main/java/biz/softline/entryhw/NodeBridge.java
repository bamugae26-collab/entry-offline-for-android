package biz.softline.entryhw;

import android.util.Base64;
import android.util.Log;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * 연결 프로그램 본체(Node)와 이 앱(Java) 사이의 통로 — 127.0.0.1:23520, 한 줄에 JSON 하나.
 * Node 가 기다리고 Java 가 접속한다. 첫 줄로 token 을 보낸다 (Node 를 켤 때 넘긴 값).
 *
 * Node → Java : 요청 {"id","cmd":"list|open|write|set|update|close"} → 응답 {"id","ok","result|error"}
 *               알림 {"cmd":"openUrl|openEntry|state|entry", …}
 * Java → Node : {"event":"data","path","data"} · {"event":"disconnect","path"} · {"event":"launch","roomId"} · {"event":"stop"}
 */
final class NodeBridge implements SerialPorts.Listener {
    interface Notifications {
        void onNodeMessage(String cmd, JSONObject msg);
    }

    private static final String TAG = "EntryHwBridge";
    static final int PORT = 23520;

    private final String token;
    private final SerialPorts ports;
    private final Notifications notifications;
    private final ExecutorService work = Executors.newCachedThreadPool();
    private final List<String> pending = new ArrayList<>();
    private volatile Socket socket;
    private volatile OutputStream out;
    private volatile boolean running = true;

    NodeBridge(android.content.Context context, String token, Notifications notifications) {
        this.token = token;
        this.notifications = notifications;
        this.ports = new SerialPorts(context, this);
        Thread t = new Thread(this::loop, "EntryHwBridge");
        t.setDaemon(true);
        t.start();
    }

    /** Node 가 켜질 때까지 다시 시도하며 접속을 유지한다 */
    private void loop() {
        while (running) {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress("127.0.0.1", PORT), 1000);
                s.setTcpNoDelay(true);
                socket = s;
                out = s.getOutputStream();
                writeLine(new JSONObject().put("token", token).toString());
                flushPending();
                Log.i(TAG, "attached to node");
                BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                String line;
                while ((line = in.readLine()) != null) {
                    handle(line);
                }
            } catch (Exception e) {
                // Node 가 아직 준비 중
            }
            socket = null;
            out = null;
            try {
                Thread.sleep(300);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void handle(String line) {
        final JSONObject msg;
        try {
            msg = new JSONObject(line);
        } catch (Exception e) {
            return;
        }
        final String cmd = msg.optString("cmd", "");
        if (!msg.has("id")) {
            notifications.onNodeMessage(cmd, msg);
            return;
        }
        final long id = msg.optLong("id");
        work.execute(() -> {
            JSONObject reply = new JSONObject();
            try {
                reply.put("id", id);
                Object result = Boolean.TRUE;
                switch (cmd) {
                    case "list":
                        result = ports.list();
                        break;
                    case "open":
                        ports.open(msg);
                        break;
                    case "write":
                        ports.write(msg.getString("path"), msg.getString("data"));
                        break;
                    case "set":
                        ports.set(msg);
                        break;
                    case "update":
                        ports.update(msg);
                        break;
                    case "close":
                        ports.close(msg.getString("path"));
                        break;
                    default:
                        throw new Exception("unknown command " + cmd);
                }
                reply.put("ok", true);
                reply.put("result", result);
            } catch (Exception e) {
                try {
                    reply.put("ok", false);
                    reply.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
                } catch (Exception ignored) {
                    // 무시
                }
            }
            writeLine(reply.toString());
        });
    }

    private synchronized void writeLine(String line) {
        OutputStream o = out;
        if (o == null) return;
        try {
            o.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            o.flush();
        } catch (Exception e) {
            Log.w(TAG, "write failed", e);
        }
    }

    /** Node 에 이벤트 보내기 (아직 접속 전이면 모았다가) */
    void sendEvent(JSONObject event) {
        String line = event.toString();
        synchronized (pending) {
            if (out == null) {
                pending.add(line);
                return;
            }
        }
        writeLine(line);
    }

    private void flushPending() {
        List<String> copy;
        synchronized (pending) {
            copy = new ArrayList<>(pending);
            pending.clear();
        }
        for (String l : copy) writeLine(l);
    }

    @Override
    public void onData(String path, byte[] data) {
        try {
            writeLine(new JSONObject().put("event", "data").put("path", path)
                .put("data", Base64.encodeToString(data, Base64.NO_WRAP)).toString());
        } catch (Exception ignored) {
            // 무시
        }
    }

    @Override
    public void onLost(String path) {
        try {
            writeLine(new JSONObject().put("event", "disconnect").put("path", path).toString());
        } catch (Exception ignored) {
            // 무시
        }
    }

    void shutdown() {
        running = false;
        ports.closeAll();
        try {
            Socket s = socket;
            if (s != null) s.close();
        } catch (Exception ignored) {
            // 닫힘
        }
        work.shutdownNow();
    }
}

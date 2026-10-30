package biz.softline.entryhw;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.res.AssetManager;
import android.system.Os;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 연결 프로그램 본체(Node.js — entry-hw 메인 로직)를 nodejs-mobile 로 실행한다.
 *  - 앱 자산(assets/nodejs-project)은 파일 시스템에 있어야 Node 가 읽을 수 있으므로, 앱이 설치·업데이트된 뒤 처음 한 번 복사한다.
 *  - Node 는 한 프로세스에서 한 번만 시작할 수 있다 (끝나지 않는다).
 */
final class NodeRunner {
    private static final String TAG = "EntryHw";
    private static volatile boolean started = false;

    static {
        System.loadLibrary("node");
        System.loadLibrary("native-lib");
    }

    private static native int startNodeWithArguments(String[] arguments);

    private NodeRunner() {}

    static boolean isStarted() {
        return started;
    }

    /** 처음 한 번만 Node 를 켠다 (따로 실행) */
    static synchronized void start(final Context context, final String token, final String lang) {
        if (started) return;
        started = true;
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                File project = prepareProject(app);
                File data = new File(app.getFilesDir(), "hw-data");
                //noinspection ResultOfMethodCallIgnored
                data.mkdirs();
                Os.setenv("ENTRY_HW_ROOT", project.getAbsolutePath(), true);
                Os.setenv("ENTRY_HW_DATA", data.getAbsolutePath(), true);
                Os.setenv("ENTRY_HW_TOKEN", token, true);
                Os.setenv("ENTRY_HW_LANG", lang, true);
                Os.setenv("HOME", data.getAbsolutePath(), true);
                Os.setenv("TMPDIR", app.getCacheDir().getAbsolutePath(), true);
                Log.i(TAG, "node start: " + project);
                int code = startNodeWithArguments(new String[] {
                    "node", new File(project, "main.js").getAbsolutePath()
                });
                Log.e(TAG, "node exited: " + code);
            } catch (Throwable t) {
                Log.e(TAG, "node failed", t);
            }
        }, "EntryHwNode").start();
    }

    /** assets/nodejs-project → files/nodejs-project (앱 버전이 바뀌었을 때만) */
    @SuppressWarnings("deprecation")
    private static File prepareProject(Context app) throws Exception {
        File dir = new File(app.getFilesDir(), "nodejs-project");
        PackageInfo info = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
        String stamp = info.versionCode + ":" + info.lastUpdateTime;
        File marker = new File(app.getFilesDir(), "nodejs-project.stamp");
        if (dir.isDirectory() && marker.isFile() && stamp.equals(readText(marker))) {
            return dir;
        }
        long t = System.currentTimeMillis();
        deleteRecursive(dir);
        copyAssetDir(app.getAssets(), "nodejs-project", dir);
        try (OutputStream out = new FileOutputStream(marker)) {
            out.write(stamp.getBytes(StandardCharsets.UTF_8));
        }
        Log.i(TAG, "node project copied in " + (System.currentTimeMillis() - t) + "ms");
        return dir;
    }

    private static void copyAssetDir(AssetManager am, String path, File dest) throws Exception {
        String[] children = am.list(path);
        if (children == null || children.length == 0) {
            // 파일
            //noinspection ResultOfMethodCallIgnored
            dest.getParentFile().mkdirs();
            InputStream in;
            try {
                in = am.open(path);
            } catch (java.io.FileNotFoundException emptyDir) {
                // 빈 폴더
                //noinspection ResultOfMethodCallIgnored
                dest.mkdirs();
                return;
            }
            try (InputStream src = in; OutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = src.read(buf)) > 0) out.write(buf, 0, n);
            }
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        dest.mkdirs();
        for (String child : children) {
            copyAssetDir(am, path + "/" + child, new File(dest, child));
        }
    }

    private static void deleteRecursive(File f) {
        if (!f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static String readText(File f) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0;
            while (off < b.length) {
                int n = in.read(b, off, b.length - off);
                if (n < 0) break;
                off += n;
            }
            return new String(b, 0, off, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }
}

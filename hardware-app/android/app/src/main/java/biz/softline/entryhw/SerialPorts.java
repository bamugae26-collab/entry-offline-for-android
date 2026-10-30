package biz.softline.entryhw;

import android.Manifest;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;
import com.hoho.android.usbserial.util.SerialInputOutputManager;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 연결 프로그램이 쓰는 '시리얼 포트' — USB(OTG)와 블루투스 시리얼(SPP)
 *  - USB : usb-serial-for-android (MIT) — 아두이노 정품(CDC)·CH340·CP210x·FTDI·PL2303
 *  - 블루투스 : 안드로이드 설정에서 등록(페어링)한 기기 (HC-05/06 등)
 * 포트 이름(path): USB 는 /dev/bus/usb/…, 블루투스는 "bt:<주소>"
 * PC 의 COM 포트 정보와 비슷하게 manufacturer · pnpId(USB\VID_xxxx&PID_xxxx\…) 를 만들어 하드웨어 설정과 맞춰 본다.
 */
final class SerialPorts {
    interface Listener {
        void onData(String path, byte[] data);

        void onLost(String path);
    }

    private static final String ACTION_USB_PERMISSION = "biz.softline.entryhw.USB_PERMISSION";
    private static final String BT_PREFIX = "bt:";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private static final class Open {
        UsbSerialPort usb;
        SerialInputOutputManager io;
        BluetoothSocket bt;
        OutputStream out;
    }

    private final Context context;
    private final Listener listener;
    private final Map<String, Open> open = new ConcurrentHashMap<>();

    SerialPorts(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
    }

    private UsbManager usb() {
        return (UsbManager) context.getSystemService(Context.USB_SERVICE);
    }

    private BluetoothAdapter bt() {
        try {
            BluetoothManager m = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
            return m == null ? null : m.getAdapter();
        } catch (Exception e) {
            return null;
        }
    }

    private boolean btAllowed() {
        return Build.VERSION.SDK_INT < 31
            || context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    // ── 목록 ─────────────────────────────────────────────

    JSONArray list() {
        JSONArray arr = new JSONArray();
        try {
            for (UsbSerialDriver d : UsbSerialProber.getDefaultProber().findAllDrivers(usb())) {
                arr.put(usbInfo(d.getDevice()));
            }
        } catch (Exception ignored) {
            // USB 없음
        }
        BluetoothAdapter adapter = bt();
        if (adapter != null && btAllowed()) {
            try {
                if (adapter.isEnabled()) {
                    for (BluetoothDevice d : adapter.getBondedDevices()) {
                        if (d.getType() == BluetoothDevice.DEVICE_TYPE_LE) continue;
                        BluetoothClass c = d.getBluetoothClass();
                        int major = c == null ? BluetoothClass.Device.Major.UNCATEGORIZED : c.getMajorDeviceClass();
                        if (major == BluetoothClass.Device.Major.AUDIO_VIDEO
                            || major == BluetoothClass.Device.Major.PHONE
                            || major == BluetoothClass.Device.Major.COMPUTER) continue;
                        arr.put(btInfo(d));
                    }
                }
            } catch (SecurityException ignored) {
                // 권한 없음
            }
        }
        return arr;
    }

    private static String hex4(int v) {
        return String.format(Locale.ROOT, "%04X", v & 0xFFFF);
    }

    private JSONObject usbInfo(UsbDevice d) {
        JSONObject o = new JSONObject();
        try {
            String manufacturer = null;
            String product = null;
            String serial = null;
            try {
                manufacturer = d.getManufacturerName();
                product = d.getProductName();
                serial = d.getSerialNumber();
            } catch (SecurityException ignored) {
                // 권한을 받기 전에는 이름을 못 읽을 수 있음
            }
            String vid = hex4(d.getVendorId());
            String pid = hex4(d.getProductId());
            o.put("path", d.getDeviceName());
            o.put("name", product != null ? product : "USB " + vid + ":" + pid);
            o.put("manufacturer", knownManufacturer(d.getVendorId(), manufacturer));
            o.put("serialNumber", serial == null ? "" : serial);
            o.put("pnpId", "USB\\VID_" + vid + "&PID_" + pid + "\\" + (serial == null ? "0" : serial));
            o.put("vendorId", vid.toLowerCase(Locale.ROOT));
            o.put("productId", pid.toLowerCase(Locale.ROOT));
        } catch (Exception ignored) {
            // 빈 값
        }
        return o;
    }

    /** PC(Windows) 에서 보이는 제조사 이름에 맞춘다 — 하드웨어 설정(vendor)이 이 이름으로 포트를 고른다 */
    private static String knownManufacturer(int vid, String reported) {
        String base = reported == null ? "" : reported;
        switch (vid) {
            case 0x2341:
            case 0x2A03:
                return base.contains("Arduino") ? base : "Arduino LLC (www.arduino.cc) " + base;
            case 0x1A86:
                return "wch.cn " + base;
            case 0x10C4:
                return "Silicon Labs " + base;
            case 0x0403:
                return "FTDI " + base;
            case 0x067B:
                return "Prolific " + base;
            case 0x0D28:
                return "ARM mbed " + base;
            default:
                return base;
        }
    }

    @SuppressWarnings("MissingPermission")
    private static JSONObject btInfo(BluetoothDevice d) {
        JSONObject o = new JSONObject();
        try {
            String name = null;
            try {
                name = d.getName();
            } catch (SecurityException ignored) {
                // 권한 없음
            }
            o.put("path", BT_PREFIX + d.getAddress());
            o.put("name", name == null ? d.getAddress() : name);
            o.put("manufacturer", "Bluetooth");
            o.put("pnpId", "BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}\\" + d.getAddress().replace(":", ""));
            o.put("bluetooth", true);
        } catch (Exception ignored) {
            // 빈 값
        }
        return o;
    }

    // ── 열기 ─────────────────────────────────────────────

    /** 연결에 몇 초 걸릴 수 있다 (USB 권한 창 · 블루투스) — 부르는 쪽에서 따로 실행 */
    void open(JSONObject args) throws Exception {
        String path = args.getString("path");
        if (open.containsKey(path)) close(path);
        if (path.startsWith(BT_PREFIX)) {
            openBluetooth(path);
        } else {
            openUsb(path, args);
        }
    }

    private UsbSerialDriver findDriver(String path) {
        for (UsbSerialDriver d : UsbSerialProber.getDefaultProber().findAllDrivers(usb())) {
            if (d.getDevice().getDeviceName().equals(path)) return d;
        }
        return null;
    }

    private void openUsb(final String path, JSONObject args) throws Exception {
        UsbSerialDriver driver = findDriver(path);
        if (driver == null) throw new Exception("USB device not found: " + path);
        UsbManager manager = usb();
        if (!manager.hasPermission(driver.getDevice())) {
            requestUsbPermission(driver.getDevice());
            if (!manager.hasPermission(driver.getDevice())) throw new Exception("USB permission denied");
        }
        UsbDeviceConnection connection = manager.openDevice(driver.getDevice());
        if (connection == null) throw new Exception("USB open failed");
        final Open op = new Open();
        op.usb = driver.getPorts().get(0);
        try {
            op.usb.open(connection);
            int baud = args.optInt("baudRate", 9600);
            int dataBits = args.optInt("dataBits", 8);
            int stopBits = args.optInt("stopBits", 1) == 2 ? UsbSerialPort.STOPBITS_2 : UsbSerialPort.STOPBITS_1;
            String parityName = args.optString("parity", "none");
            int parity = "even".equals(parityName) ? UsbSerialPort.PARITY_EVEN
                : "odd".equals(parityName) ? UsbSerialPort.PARITY_ODD
                : "mark".equals(parityName) ? UsbSerialPort.PARITY_MARK
                : "space".equals(parityName) ? UsbSerialPort.PARITY_SPACE
                : UsbSerialPort.PARITY_NONE;
            op.usb.setParameters(baud, dataBits, stopBits, parity);
            try {
                // node-serialport 처럼 열 때 DTR·RTS 를 켠다 (아두이노는 이때 재시작됨)
                op.usb.setDTR(true);
                op.usb.setRTS(true);
            } catch (Exception ignored) {
                // 지원하지 않는 칩
            }
            op.io = new SerialInputOutputManager(op.usb, new SerialInputOutputManager.Listener() {
                @Override
                public void onNewData(byte[] data) {
                    listener.onData(path, data);
                }

                @Override
                public void onRunError(Exception e) {
                    if (open.remove(path) != null) {
                        closeQuietly(op);
                        listener.onLost(path);
                    }
                }
            });
            op.io.start();
            open.put(path, op);
        } catch (Exception e) {
            closeQuietly(op);
            throw e;
        }
    }

    /** USB 권한 창을 띄우고 답을 기다린다 (최대 60초) */
    private void requestUsbPermission(UsbDevice device) throws InterruptedException {
        final CountDownLatch latch = new CountDownLatch(1);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                if (ACTION_USB_PERMISSION.equals(intent.getAction())) latch.countDown();
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(receiver, filter);
        }
        try {
            Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(context.getPackageName());
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            usb().requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags));
            latch.await(60, TimeUnit.SECONDS);
        } finally {
            try {
                context.unregisterReceiver(receiver);
            } catch (Exception ignored) {
                // 이미 해제
            }
        }
    }

    @SuppressWarnings("MissingPermission")
    private void openBluetooth(final String path) throws Exception {
        BluetoothAdapter adapter = bt();
        if (adapter == null) throw new Exception("no bluetooth");
        if (!btAllowed()) throw new Exception("bluetooth permission denied");
        if (!adapter.isEnabled()) throw new Exception("bluetooth is off");
        BluetoothDevice device = adapter.getRemoteDevice(path.substring(BT_PREFIX.length()));
        try {
            adapter.cancelDiscovery();
        } catch (Exception ignored) {
            // 찾는 중 아님
        }
        BluetoothSocket socket = null;
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
        } catch (Exception first) {
            try {
                if (socket != null) socket.close();
            } catch (Exception ignored) {
                // 닫힘
            }
            // 일부 모듈은 보안 연결을 받지 않는다 → 한 번 더
            socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
        }
        final Open op = new Open();
        op.bt = socket;
        op.out = socket.getOutputStream();
        final InputStream in = socket.getInputStream();
        open.put(path, op);
        new Thread(() -> {
            byte[] buf = new byte[1024];
            try {
                while (true) {
                    int n = in.read(buf);
                    if (n < 0) break;
                    if (n == 0) continue;
                    byte[] chunk = new byte[n];
                    System.arraycopy(buf, 0, chunk, 0, n);
                    listener.onData(path, chunk);
                }
            } catch (Exception ignored) {
                // 끊김
            }
            if (open.get(path) == op) {
                open.remove(path);
                closeQuietly(op);
                listener.onLost(path);
            }
        }, "EntryHwBt").start();
    }

    // ── 쓰기 · 설정 · 닫기 ─────────────────────────────────

    void write(String path, String base64) throws Exception {
        Open op = open.get(path);
        if (op == null) throw new Exception("port is not open");
        byte[] data = Base64.decode(base64, Base64.DEFAULT);
        if (op.bt != null) {
            op.out.write(data);
            op.out.flush();
        } else {
            op.usb.write(data, 2000);
        }
    }

    void set(JSONObject args) throws Exception {
        Open op = open.get(args.getString("path"));
        if (op == null || op.usb == null) return;
        try {
            if (args.has("dtr")) op.usb.setDTR(args.getBoolean("dtr"));
            if (args.has("rts")) op.usb.setRTS(args.getBoolean("rts"));
        } catch (Exception ignored) {
            // 지원하지 않는 칩
        }
    }

    void update(JSONObject args) throws Exception {
        Open op = open.get(args.getString("path"));
        if (op == null || op.usb == null) return;
        op.usb.setParameters(args.optInt("baudRate", 9600), 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
    }

    void close(String path) {
        Open op = open.remove(path);
        if (op != null) closeQuietly(op);
    }

    void closeAll() {
        for (String path : open.keySet()) close(path);
    }

    private static void closeQuietly(Open op) {
        try {
            if (op.io != null) op.io.stop();
        } catch (Exception ignored) {
            // 멈춤
        }
        try {
            if (op.usb != null) op.usb.close();
        } catch (Exception ignored) {
            // 닫힘
        }
        try {
            if (op.bt != null) op.bt.close();
        } catch (Exception ignored) {
            // 닫힘
        }
    }
}

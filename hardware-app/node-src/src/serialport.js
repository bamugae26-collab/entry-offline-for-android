/**
 * [Entry Android Hardware] 'serialport' 대신
 *
 * entry-hw 는 node-serialport 로 COM 포트를 연다. 안드로이드에는 COM 포트가 없으므로
 * 같은 모양(SerialPort 클래스: Duplex 스트림)을 만들고 실제 통신은 안드로이드 앱(Java)에 맡긴다.
 *  - USB : usb-serial-for-android (아두이노 정품·CH340·CP210x·FTDI·PL2303)
 *  - 블루투스 시리얼(SPP) : 안드로이드 설정에서 등록한 기기 (HC-05/06 등)
 * Java 와는 bridge.js (127.0.0.1 TCP, 한 줄에 JSON 하나) 로 이야기한다.
 */
const { Duplex } = require('stream');
const bridge = require('./bridge');

const openPorts = new Map(); // path → SerialPort

bridge.on('data', ({ path, data }) => {
    const port = openPorts.get(path);
    port && port._receive(Buffer.from(data, 'base64'));
});

bridge.on('disconnect', ({ path }) => {
    const port = openPorts.get(path);
    port && port._lost();
});

class SerialPort extends Duplex {
    constructor(path, options = {}, openCallback) {
        super({ highWaterMark: options.highWaterMark || 65536 });
        if (typeof options === 'function') {
            openCallback = options;
            options = {};
        }
        this.path = path;
        this.settings = Object.assign(
            { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', rtscts: false, autoOpen: true },
            options
        );
        this.isOpen = false;
        this.opening = false;
        this.closing = false;
        if (this.settings.autoOpen !== false) {
            process.nextTick(() => this.open(openCallback));
        }
    }

    // node-serialport 9 호환: 바인딩 지정은 무시
    static set Binding(_) {}

    static get Binding() {
        return {};
    }

    /** 연결된 포트 목록 (node-serialport 의 PortInfo 모양) */
    static async list() {
        try {
            const ports = await bridge.request('list');
            return (ports || []).map((p) => ({
                path: p.path,
                comName: p.path,
                manufacturer: p.manufacturer || undefined,
                serialNumber: p.serialNumber || undefined,
                pnpId: p.pnpId || undefined,
                locationId: undefined,
                vendorId: p.vendorId || undefined,
                productId: p.productId || undefined,
                friendlyName: p.name || p.path,
                bluetooth: !!p.bluetooth,
            }));
        } catch (e) {
            console.warn('serial list failed', e && e.message);
            return [];
        }
    }

    open(callback) {
        if (this.isOpen || this.opening) {
            const err = new Error('Port is already open');
            callback ? callback(err) : this.emit('error', err);
            return;
        }
        this.opening = true;
        const s = this.settings;
        bridge
            .request('open', {
                path: this.path,
                baudRate: s.baudRate,
                dataBits: s.dataBits,
                stopBits: s.stopBits,
                parity: s.parity,
                rtscts: !!s.rtscts,
            }, 20000)
            .then(() => {
                this.opening = false;
                this.isOpen = true;
                openPorts.set(this.path, this);
                callback && callback(null);
                this.emit('open');
            })
            .catch((err) => {
                this.opening = false;
                callback && callback(err);
                this.emit('error', err);
            });
    }

    _receive(buf) {
        if (this.isOpen) {
            this.push(buf);
        }
    }

    _lost() {
        if (!this.isOpen) {
            return;
        }
        this.isOpen = false;
        openPorts.delete(this.path);
        const err = new Error('Port disconnected');
        err.disconnected = true;
        this.emit('disconnect', err);
        this.emit('close', err);
    }

    _read() {
        // 받은 데이터는 _receive 에서 바로 push
    }

    _write(chunk, encoding, callback) {
        if (!this.isOpen) {
            callback(new Error('Port is not open'));
            return;
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        bridge
            .request('write', { path: this.path, data: buf.toString('base64') })
            .then(() => callback())
            .catch((e) => callback(e));
    }

    write(data, encoding, callback) {
        if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }
        if (Array.isArray(data)) {
            data = Buffer.from(data);
        }
        // entry-hw 는 commType('ascii' 등)을 encoding 자리로 넘긴다
        if (encoding && !Buffer.isEncoding(encoding)) {
            encoding = undefined;
        }
        return super.write(data, encoding, callback);
    }

    drain(callback) {
        // 쓰기는 Java 가 끝낸 뒤 응답하므로 따로 기다릴 것이 없다
        if (this.writableLength === 0) {
            process.nextTick(() => callback && callback(null));
        } else {
            this.once('drain', () => callback && callback(null));
        }
    }

    flush(callback) {
        process.nextTick(() => callback && callback(null));
    }

    set(options = {}, callback) {
        const payload = { path: this.path };
        if (options.dtr !== undefined) {
            payload.dtr = !!options.dtr;
        }
        if (options.rts !== undefined) {
            payload.rts = !!options.rts;
        }
        bridge
            .request('set', payload)
            .then(() => callback && callback(null))
            .catch((e) => callback && callback(e));
    }

    get(callback) {
        process.nextTick(() => callback && callback(null, { cts: false, dsr: false, dcd: false }));
    }

    update(options = {}, callback) {
        if (options.baudRate) {
            this.settings.baudRate = options.baudRate;
        }
        bridge
            .request('update', { path: this.path, baudRate: this.settings.baudRate })
            .then(() => callback && callback(null))
            .catch((e) => callback && callback(e));
    }

    close(callback) {
        if (!this.isOpen) {
            const err = new Error('Port is not open');
            callback ? process.nextTick(() => callback(err)) : this.emit('error', err);
            return;
        }
        this.isOpen = false;
        openPorts.delete(this.path);
        bridge
            .request('close', { path: this.path })
            .catch(() => undefined)
            .then(() => {
                callback && callback(null);
                this.emit('close');
            });
    }
}

module.exports = SerialPort;
module.exports.default = SerialPort;

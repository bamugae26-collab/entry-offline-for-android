/** HID 하드웨어는 안드로이드판에서 지원하지 않는다 (목록에서도 뺀) */
class HID {
    constructor() {
        throw new Error('HID is not supported on Android');
    }
}
const nodeHid = { HID, devices: () => [], setDriverType: () => undefined };
module.exports = nodeHid;
module.exports.default = nodeHid;

/**
 * 펌웨어 설치(avrdude 등 PC 프로그램) 대신.
 * 안드로이드에서는 펌웨어를 설치할 수 없으므로 바로 실패를 돌려준다 → 화면에 'PC에서 설치' 안내.
 */
class Flasher {
    flash() {
        return Promise.resolve(['exit']);
    }

    kill() {}

    async checkOpenCM7Version() {}
}
module.exports = Flasher;
module.exports.default = Flasher;

/** winston 로거 대신 — 콘솔(→ 안드로이드 logcat)로만 */
const LEVELS = { error: 0, warn: 1, info: 2, verbose: 3, debug: 4 };
const current = LEVELS[process.env.ENTRY_HW_LOG || 'info'];

module.exports = function createLogger(label) {
    const make = (level) => (message, ...rest) => {
        if (LEVELS[level] <= current) {
            const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
            fn(`[${label}][${level}]`, message, ...rest);
        }
    };
    return { error: make('error'), warn: make('warn'), info: make('info'), verbose: make('verbose'), debug: make('debug') };
};
module.exports.default = module.exports;

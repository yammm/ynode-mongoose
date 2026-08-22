/**
 * Races an operation against a deadline. The operation's eventual settlement
 * remains observed so a late rejection cannot become unhandled.
 * @param {Promise<*>} promise - Operation to bound.
 * @param {number} timeoutMs - Deadline in milliseconds.
 * @param {function(): Error} createTimeoutError - Deadline error factory.
 * @returns {Promise<*>} Operation result before the deadline.
 */
export function raceWithDeadline(promise, timeoutMs, createTimeoutError) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);
        timer.unref?.();
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

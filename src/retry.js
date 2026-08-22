import { performance } from "node:perf_hooks";

const DEFAULT_RETRY_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_INITIAL_DELAY_MS = 100;
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;
const DEFAULT_RETRY_FACTOR = 2;
const RETRY_OPTION_KEYS = new Set([
    "timeoutMs",
    "initialDelayMs",
    "maxDelayMs",
    "factor",
    "signal",
]);

function isAbortSignal(signal) {
    return (
        signal !== null &&
        typeof signal === "object" &&
        typeof signal.aborted === "boolean" &&
        typeof signal.addEventListener === "function" &&
        typeof signal.removeEventListener === "function"
    );
}

function abortError(reason) {
    const error = new Error(
        "Mongoose initial connection retry was aborted",
        reason === undefined ? undefined : { cause: reason },
    );
    error.name = "AbortError";
    error.code = "MONGOOSE_INITIAL_CONNECT_ABORTED";
    return error;
}

function timeoutError(timeoutMs, cause) {
    const error = new Error(
        `Mongoose initial connection retry timed out after ${timeoutMs}ms`,
        cause === undefined ? undefined : { cause },
    );
    error.code = "MONGOOSE_INITIAL_CONNECT_TIMEOUT";
    return error;
}

function assertFiniteNumber(value, name, predicate, expectation) {
    if (typeof value !== "number" || !Number.isFinite(value) || !predicate(value)) {
        throw new TypeError(`initialConnectionRetry.${name} must be ${expectation}`);
    }
}

/**
 * Validates and normalizes the opt-in initial connection retry policy.
 * @param {boolean|object|undefined} value - User-supplied retry option.
 * @returns {object|null} Normalized policy, or null when retry is disabled.
 */
export function normalizeInitialConnectionRetry(value) {
    if (value === undefined || value === false) {
        return null;
    }
    if (value !== true && (value === null || typeof value !== "object" || Array.isArray(value))) {
        throw new TypeError("initialConnectionRetry must be a boolean or an options object");
    }

    const options = value === true ? {} : value;
    const unknownOption = Object.keys(options)
        .filter((key) => !RETRY_OPTION_KEYS.has(key))
        .sort()
        .at(0);
    if (unknownOption !== undefined) {
        throw new TypeError(`initialConnectionRetry received unknown option: ${unknownOption}`);
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_RETRY_TIMEOUT_MS;
    const initialDelayMs = options.initialDelayMs ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
    const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    const factor = options.factor ?? DEFAULT_RETRY_FACTOR;
    const { signal } = options;

    assertFiniteNumber(timeoutMs, "timeoutMs", (number) => number > 0, "greater than 0");
    assertFiniteNumber(initialDelayMs, "initialDelayMs", (number) => number > 0, "greater than 0");
    assertFiniteNumber(maxDelayMs, "maxDelayMs", (number) => number > 0, "greater than 0");
    assertFiniteNumber(factor, "factor", (number) => number > 1, "greater than 1");
    if (maxDelayMs < initialDelayMs) {
        throw new RangeError(
            "initialConnectionRetry.maxDelayMs must be greater than or equal to initialDelayMs",
        );
    }
    if (signal !== undefined && !isAbortSignal(signal)) {
        throw new TypeError("initialConnectionRetry.signal must be an AbortSignal");
    }

    return { factor, initialDelayMs, maxDelayMs, signal, timeoutMs };
}

function remainingTime(startedAt, timeoutMs) {
    return Math.max(0, timeoutMs - (performance.now() - startedAt));
}

function raceAttempt(promise, remainingMs, timeoutMs, signal, cause) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (rejected, value) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            if (rejected) {
                reject(value);
            } else {
                resolve(value);
            }
        };
        const onAbort = () => finish(true, abortError(signal.reason));
        const timer = setTimeout(() => finish(true, timeoutError(timeoutMs, cause)), remainingMs);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => finish(false, value),
            (error) => finish(true, error),
        );
        if (signal.aborted) {
            onAbort();
        }
    });
}

function waitForRetry(delayMs, signal) {
    if (signal.aborted) {
        return Promise.reject(abortError(signal.reason));
    }
    if (delayMs <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };
        const onAbort = () => finish(abortError(signal.reason));
        const timer = setTimeout(() => finish(), delayMs);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
            onAbort();
        }
    });
}

/**
 * Repeats a Mongoose initial connection attempt with exponential backoff until
 * it succeeds, the total deadline expires, or cancellation is requested.
 * @param {object} args - Retry inputs.
 * @param {object} args.connection - Mongoose connection.
 * @param {string} args.uri - MongoDB URI.
 * @param {object} args.connectionOptions - Options forwarded to openUri().
 * @param {object} args.retry - Normalized retry policy.
 * @param {AbortSignal} args.signal - Combined shutdown/user signal.
 * @param {function(object): void} [args.onRetry] - Retry observation callback.
 * @returns {Promise<*>} Successful openUri() result.
 */
export async function connectWithRetry({
    connection,
    uri,
    connectionOptions,
    retry,
    signal,
    onRetry,
}) {
    const startedAt = performance.now();
    let attempt = 0;
    let lastError;

    while (true) {
        if (signal.aborted) {
            throw abortError(signal.reason);
        }
        const remainingMs = remainingTime(startedAt, retry.timeoutMs);
        if (remainingMs <= 0) {
            throw timeoutError(retry.timeoutMs, lastError);
        }

        ++attempt;
        try {
            const opening = Promise.resolve().then(() =>
                connection.openUri(uri, { ...connectionOptions }),
            );
            return await raceAttempt(opening, remainingMs, retry.timeoutMs, signal, lastError);
        } catch (error) {
            if (
                error?.code === "MONGOOSE_INITIAL_CONNECT_ABORTED" ||
                error?.code === "MONGOOSE_INITIAL_CONNECT_TIMEOUT"
            ) {
                throw error;
            }
            lastError = error;
        }

        const remainingAfterAttemptMs = remainingTime(startedAt, retry.timeoutMs);
        if (remainingAfterAttemptMs <= 0) {
            throw timeoutError(retry.timeoutMs, lastError);
        }
        const backoffMs = Math.min(
            retry.initialDelayMs * retry.factor ** Math.max(0, attempt - 1),
            retry.maxDelayMs,
        );
        const delayMs = Math.min(backoffMs, remainingAfterAttemptMs);
        onRetry?.({ attempt, delayMs, error: lastError });
        await waitForRetry(delayMs, signal);
    }
}

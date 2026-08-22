import { raceWithDeadline } from "./deadline.js";

const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 5_000;

/**
 * Converts an arbitrary error into a plain serializable descriptor.
 * @param {*} error - Error or rejection value.
 * @returns {{name: string, message: string, code: (string|number|undefined)}} Error details.
 */
function errorToObject(error) {
    if (!error || typeof error !== "object") {
        return { name: "Error", message: String(error) };
    }
    return {
        name: error.name ?? "Error",
        message: error.message ?? String(error),
        code: error.code,
    };
}

/**
 * Creates the stable timeout error used by healthcheck().
 * @param {number} timeoutMs - Exceeded deadline.
 * @returns {Error} Timeout error.
 */
function healthcheckTimeoutError(timeoutMs) {
    const error = new Error(`Mongoose healthcheck ping timed out after ${timeoutMs}ms`);
    error.code = "MONGOOSE_HEALTHCHECK_TIMEOUT";
    return error;
}

/**
 * Attaches synchronous readiness() and non-throwing healthcheck() helpers to a
 * Mongoose connection. healthcheck() issues a raw MongoDB ping and always
 * resolves with a serializable result bounded by a deadline.
 * @param {object} connection - Mongoose connection instance.
 */
export function attachHealth(connection) {
    function readiness() {
        const readyState = Number(connection.readyState);
        return { isReady: readyState === 1, readyState };
    }

    Object.defineProperty(connection, "readiness", {
        configurable: true,
        enumerable: false,
        value: readiness,
    });

    Object.defineProperty(connection, "healthcheck", {
        configurable: true,
        enumerable: false,
        value: async (options = {}) => {
            const requestedTimeoutMs = options?.timeoutMs;
            // This helper never throws; invalid overrides use the safe default.
            const timeoutMs =
                typeof requestedTimeoutMs === "number" &&
                Number.isFinite(requestedTimeoutMs) &&
                requestedTimeoutMs > 0
                    ? requestedTimeoutMs
                    : DEFAULT_HEALTHCHECK_TIMEOUT_MS;
            const startedAtMs = Date.now();
            try {
                if (typeof connection.db?.command !== "function") {
                    const error = new Error("MongoDB connection is not ready for commands");
                    error.code = "MONGOOSE_HEALTHCHECK_NOT_READY";
                    throw error;
                }
                const reply = await raceWithDeadline(
                    Promise.resolve(connection.db.command({ ping: 1 })),
                    timeoutMs,
                    () => healthcheckTimeoutError(timeoutMs),
                );
                return {
                    ...readiness(),
                    ok: reply?.ok === 1,
                    ping: reply?.ok,
                    latencyMs: Date.now() - startedAtMs,
                };
            } catch (error) {
                return {
                    ...readiness(),
                    ok: false,
                    latencyMs: Date.now() - startedAtMs,
                    error: errorToObject(error),
                };
            }
        },
    });
}

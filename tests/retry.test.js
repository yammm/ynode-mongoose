import assert from "node:assert";
import { mock, test } from "node:test";

import { connectWithRetry, normalizeInitialConnectionRetry } from "../src/retry.js";

test("normalizeInitialConnectionRetry is opt-in and applies bounded defaults", () => {
    assert.strictEqual(normalizeInitialConnectionRetry(undefined), null);
    assert.strictEqual(normalizeInitialConnectionRetry(false), null);
    assert.deepStrictEqual(normalizeInitialConnectionRetry(true), {
        factor: 2,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        signal: undefined,
        timeoutMs: 30000,
    });
});

test("normalizeInitialConnectionRetry rejects invalid policies deterministically", () => {
    assert.throws(() => normalizeInitialConnectionRetry(null), {
        name: "TypeError",
        message: "initialConnectionRetry must be a boolean or an options object",
    });
    assert.throws(() => normalizeInitialConnectionRetry({ typo: true }), {
        name: "TypeError",
        message: "initialConnectionRetry received unknown option: typo",
    });
    assert.throws(() => normalizeInitialConnectionRetry({ timeoutMs: 0 }), {
        name: "TypeError",
        message: "initialConnectionRetry.timeoutMs must be greater than 0",
    });
    assert.throws(() => normalizeInitialConnectionRetry({ initialDelayMs: 0 }), {
        name: "TypeError",
        message: "initialConnectionRetry.initialDelayMs must be greater than 0",
    });
    assert.throws(() => normalizeInitialConnectionRetry({ initialDelayMs: 10, maxDelayMs: 5 }), {
        name: "RangeError",
        message:
            "initialConnectionRetry.maxDelayMs must be greater than or equal to initialDelayMs",
    });
    assert.throws(() => normalizeInitialConnectionRetry({ factor: 1 }), {
        name: "TypeError",
        message: "initialConnectionRetry.factor must be greater than 1",
    });
    assert.throws(() => normalizeInitialConnectionRetry({ signal: {} }), {
        name: "TypeError",
        message: "initialConnectionRetry.signal must be an AbortSignal",
    });
});

test("connectWithRetry uses exponential backoff until initial connection succeeds", async () => {
    let attempt = 0;
    const connection = {
        openUri: mock.fn(async () => {
            ++attempt;
            if (attempt === 1) {
                return Promise.reject();
            }
            if (attempt < 5) {
                throw new Error(`failure ${attempt}`);
            }
            return "connected";
        }),
    };
    const retries = [];
    const connectionOptions = { driverInfo: { name: "test" }, maxPoolSize: 4 };
    const originalOptions = structuredClone(connectionOptions);
    const result = await connectWithRetry({
        connection,
        uri: "mongodb://localhost/test",
        connectionOptions,
        retry: normalizeInitialConnectionRetry({
            timeoutMs: 1000,
            initialDelayMs: 2,
            maxDelayMs: 5,
            factor: 2,
        }),
        signal: new AbortController().signal,
        onRetry: (event) => retries.push(event),
    });

    assert.strictEqual(result, "connected");
    assert.strictEqual(connection.openUri.mock.callCount(), 5);
    assert.deepStrictEqual(
        retries.map(({ attempt: retryAttempt, delayMs }) => ({
            attempt: retryAttempt,
            delayMs,
        })),
        [
            { attempt: 1, delayMs: 2 },
            { attempt: 2, delayMs: 4 },
            { attempt: 3, delayMs: 5 },
            { attempt: 4, delayMs: 5 },
        ],
    );
    for (const call of connection.openUri.mock.calls) {
        assert.deepStrictEqual(call.arguments, ["mongodb://localhost/test", originalOptions]);
        assert.notStrictEqual(call.arguments[1], connectionOptions);
    }
    assert.deepStrictEqual(connectionOptions, originalOptions);
});

test("connectWithRetry bounds a stalled initial attempt by the total deadline", async (t) => {
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => clearInterval(keepAlive));
    const connection = { openUri: mock.fn(() => new Promise(() => {})) };

    await assert.rejects(
        connectWithRetry({
            connection,
            uri: "mongodb://localhost/test",
            connectionOptions: {},
            retry: normalizeInitialConnectionRetry({
                timeoutMs: 20,
                initialDelayMs: 1,
                maxDelayMs: 2,
                factor: 2,
            }),
            signal: new AbortController().signal,
        }),
        {
            code: "MONGOOSE_INITIAL_CONNECT_TIMEOUT",
            message: "Mongoose initial connection retry timed out after 20ms",
        },
    );
});

test("connectWithRetry cancels pending exponential backoff", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled by caller");
    const connection = {
        openUri: mock.fn(async () => {
            throw new Error("not ready");
        }),
    };

    const connecting = connectWithRetry({
        connection,
        uri: "mongodb://localhost/test",
        connectionOptions: {},
        retry: normalizeInitialConnectionRetry({
            timeoutMs: 5000,
            initialDelayMs: 1000,
            maxDelayMs: 1000,
            factor: 2,
        }),
        signal: controller.signal,
        onRetry: () => controller.abort(reason),
    });

    await assert.rejects(connecting, (error) => {
        assert.strictEqual(error.name, "AbortError");
        assert.strictEqual(error.code, "MONGOOSE_INITIAL_CONNECT_ABORTED");
        assert.strictEqual(error.cause, reason);
        return true;
    });
    assert.strictEqual(connection.openUri.mock.callCount(), 1);
});

test("connectWithRetry aborts a never-settling initial attempt", async () => {
    const controller = new AbortController();
    const reason = new Error("deployment cancelled");
    const connection = { openUri: mock.fn(() => new Promise(() => {})) };
    const connecting = connectWithRetry({
        connection,
        uri: "mongodb://localhost/test",
        connectionOptions: {},
        retry: normalizeInitialConnectionRetry(true),
        signal: controller.signal,
    });

    setImmediate(() => controller.abort(reason));

    await assert.rejects(connecting, (error) => {
        assert.strictEqual(error.name, "AbortError");
        assert.strictEqual(error.code, "MONGOOSE_INITIAL_CONNECT_ABORTED");
        assert.strictEqual(error.cause, reason);
        return true;
    });
    assert.strictEqual(connection.openUri.mock.callCount(), 1);
});

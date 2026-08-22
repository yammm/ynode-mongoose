import assert from "node:assert";
import { mock, test } from "node:test";

import { attachHealth } from "../src/health.js";

test("readiness and healthcheck expose a successful MongoDB ping", async () => {
    const command = mock.fn(async () => ({ ok: 1 }));
    const connection = { db: { command }, readyState: 1 };
    attachHealth(connection);

    assert.deepStrictEqual(connection.readiness(), { isReady: true, readyState: 1 });
    const health = await connection.healthcheck({ timeoutMs: 100 });

    assert.strictEqual(health.ok, true);
    assert.strictEqual(health.ping, 1);
    assert.strictEqual(health.isReady, true);
    assert.strictEqual(health.readyState, 1);
    assert.ok(health.latencyMs >= 0);
    assert.deepStrictEqual(command.mock.calls[0].arguments, [{ ping: 1 }]);
    assert.strictEqual(Object.keys(connection).includes("healthcheck"), false);
    assert.strictEqual(Object.keys(connection).includes("readiness"), false);
});

test("healthcheck never throws when MongoDB rejects the ping", async () => {
    const pingError = Object.assign(new Error("server unavailable"), { code: "ECONNREFUSED" });
    const connection = {
        db: { command: mock.fn(async () => Promise.reject(pingError)) },
        readyState: 0,
    };
    attachHealth(connection);

    const health = await connection.healthcheck();

    assert.deepStrictEqual(connection.readiness(), { isReady: false, readyState: 0 });
    assert.strictEqual(health.ok, false);
    assert.deepStrictEqual(health.error, {
        name: "Error",
        message: "server unavailable",
        code: "ECONNREFUSED",
    });
});

test("healthcheck reports a disconnected connection without throwing", async () => {
    const connection = { db: undefined, readyState: 0 };
    attachHealth(connection);

    const health = await connection.healthcheck();

    assert.strictEqual(health.ok, false);
    assert.strictEqual(health.error.code, "MONGOOSE_HEALTHCHECK_NOT_READY");
});

test("healthcheck resolves unhealthy when a ping exceeds its deadline", async (t) => {
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => clearInterval(keepAlive));
    const connection = {
        db: { command: mock.fn(() => new Promise(() => {})) },
        readyState: 1,
    };
    attachHealth(connection);

    const health = await connection.healthcheck({ timeoutMs: 20 });

    assert.strictEqual(health.ok, false);
    assert.strictEqual(health.error.code, "MONGOOSE_HEALTHCHECK_TIMEOUT");
    assert.match(health.error.message, /20ms/);
});

test("healthcheck falls back to its default for invalid timeout overrides", async () => {
    const connection = {
        db: { command: mock.fn(async () => ({ ok: 1 })) },
        readyState: 1,
    };
    attachHealth(connection);

    await assert.doesNotReject(() => connection.healthcheck({ timeoutMs: Number.NaN }));
    await assert.doesNotReject(() => connection.healthcheck(null));
});

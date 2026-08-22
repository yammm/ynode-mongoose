import assert from "node:assert";
import { afterEach, describe, mock, test } from "node:test";

import Fastify from "fastify";
import mongoose from "mongoose";

import plugin, { redactMongoUri } from "../src/plugin.js";

afterEach(() => mock.restoreAll());

function makeMockConnection({ id = 1, readyState = 0, openUri, close } = {}) {
    return {
        on: mock.fn(),
        openUri: mock.fn(openUri ?? (async () => {})),
        close: mock.fn(close ?? (async () => {})),
        readyState,
        id,
    };
}

function getConnectionListener(conn, event) {
    return conn.on.mock.calls.find((call) => call.arguments[0] === event)?.arguments[1];
}

function capturePluginLog(fastify) {
    const log = {
        debug: mock.fn(),
        error: mock.fn(),
        info: mock.fn(),
        warn: mock.fn(),
    };
    mock.method(fastify.log, "child", () => log);
    return log;
}

describe("@ynode/mongoose", () => {
    test("should register the plugin", async () => {
        const fastify = Fastify();

        // Mock mongoose.createConnection
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => {}),
            close: mock.fn(async () => {}),
            readyState: 0,
            id: 1,
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test" });

        assert.ok(fastify.mongoose, "mongoose decorator should exist");
        assert.strictEqual(
            fastify.mongoose,
            mockConn,
            "mongoose decorator should be the connection object",
        );

        await fastify.close();
    });

    test("should support string option as uri", async () => {
        const fastify = Fastify();

        // Mock mongoose.createConnection
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => {}),
            close: mock.fn(async () => {}),
            readyState: 0,
            id: 2,
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, "mongodb://localhost:27017/test-string");
        await fastify.ready();

        assert.ok(fastify.mongoose, "mongoose decorator should exist");
        assert.strictEqual(
            fastify.mongoose,
            mockConn,
            "mongoose decorator should be the connection object",
        );

        const openUriCall = mockConn.openUri.mock.calls[0];
        assert.strictEqual(openUriCall.arguments[0], "mongodb://localhost:27017/test-string");
        assert.deepStrictEqual(openUriCall.arguments[1], {});

        await fastify.close();
    });

    test("should forward object connection options to openUri", async () => {
        const fastify = Fastify();
        const mockConn = makeMockConnection({ id: 8 });
        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-options",
            maxPoolSize: 12,
            serverSelectionTimeoutMS: 2500,
        });
        await fastify.ready();

        const openUriCall = mockConn.openUri.mock.calls[0];
        assert.strictEqual(openUriCall.arguments[0], "mongodb://localhost:27017/test-options");
        assert.deepStrictEqual(openUriCall.arguments[1], {
            maxPoolSize: 12,
            serverSelectionTimeoutMS: 2500,
        });

        await fastify.close();
    });

    test("should forward name option to openUri as driverInfo.name", async () => {
        const fastify = Fastify();
        const mockConn = makeMockConnection({ id: 13 });
        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-driver-info",
            name: "my-app",
            maxPoolSize: 3,
        });
        await fastify.ready();

        const openUriCall = mockConn.openUri.mock.calls[0];
        assert.deepStrictEqual(openUriCall.arguments[1], {
            driverInfo: { name: "my-app" },
            maxPoolSize: 3,
        });

        await fastify.close();
    });

    test("should merge name option into a caller-supplied driverInfo", async () => {
        const fastify = Fastify();
        const mockConn = makeMockConnection({ id: 14 });
        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-driver-info-merge",
            name: "my-app",
            driverInfo: { version: "1.2.3" },
        });
        await fastify.ready();

        const openUriCall = mockConn.openUri.mock.calls[0];
        assert.deepStrictEqual(openUriCall.arguments[1], {
            driverInfo: { version: "1.2.3", name: "my-app" },
        });

        await fastify.close();
    });

    test("should throw if name is not a non-empty string", async () => {
        const fastify = Fastify();
        const mockConn = makeMockConnection({ id: 15 });
        mock.method(mongoose, "createConnection", () => mockConn);

        await assert.rejects(
            async () => {
                await fastify.register(plugin, {
                    uri: "mongodb://localhost:27017/test",
                    name: 42,
                });
            },
            { message: "@ynode/mongoose requires options.name to be a non-empty string" },
        );
    });

    test("should fail ready when openUri rejects by default", async () => {
        const fastify = Fastify();

        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => {
                throw new Error("connect failed");
            }),
            close: mock.fn(async () => {}),
            readyState: 0,
            id: 3,
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test-reject" });

        await assert.rejects(async () => {
            await fastify.ready();
        });

        await fastify.close();
    });

    test("should not fail ready when openUri rejects and waitForConnection is false", async () => {
        const fastify = Fastify();

        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => {
                throw new Error("connect failed");
            }),
            close: mock.fn(async () => {}),
            readyState: 0,
            id: 7,
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-reject-nonblocking",
            waitForConnection: false,
        });

        await assert.doesNotReject(async () => {
            await fastify.ready();
        });
        await new Promise((resolve) => setImmediate(resolve));
        assert.strictEqual(mockConn.openUri.mock.callCount(), 1);

        await fastify.close();
    });

    test("should throw if uri is missing", async () => {
        const fastify = Fastify();

        try {
            await fastify.register(plugin, {});
            assert.fail("Should have thrown error");
        } catch (err) {
            assert.strictEqual(err.message, "@ynode/mongoose requires options.uri");
        }
    });

    test("should throw if waitForConnection is not a boolean", async () => {
        const fastify = Fastify();

        try {
            await fastify.register(plugin, {
                uri: "mongodb://localhost:27017/test",
                waitForConnection: "false",
            });
            assert.fail("Should have thrown error");
        } catch (err) {
            assert.strictEqual(
                err.message,
                "@ynode/mongoose requires options.waitForConnection to be a boolean",
            );
        }
    });

    test("should throw if registered twice", async () => {
        const fastify = Fastify();
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => {}),
            close: mock.fn(async () => {}),
            readyState: 0,
        };
        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test" });

        try {
            await fastify.register(plugin, { uri: "mongodb://localhost:27017/test" });
            assert.fail("Should have thrown error");
        } catch (err) {
            assert.strictEqual(err.message, "@ynode/mongoose has already been registered");
        }
    });

    test("should close active connection on fastify close", async () => {
        const fastify = Fastify();
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => {}),
            close: mock.fn(async () => {}),
            readyState: 1,
            id: 4,
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test-active-close" });
        await fastify.ready();
        await fastify.close();

        assert.strictEqual(mockConn.close.mock.callCount(), 1);
    });

    test("should close disconnected connection on fastify close", async () => {
        const fastify = Fastify();
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => {}),
            close: mock.fn(async () => {}),
            readyState: 0,
            id: 5,
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-disconnected-close",
        });
        await fastify.ready();
        await fastify.close();

        assert.strictEqual(mockConn.close.mock.callCount(), 1);
    });

    test("should await an already-disconnecting connection on fastify close", async () => {
        const fastify = Fastify();
        let finishClose = null;
        const closeGate = new Promise((resolve) => {
            finishClose = resolve;
        });
        const mockConn = makeMockConnection({
            id: 6,
            readyState: 3,
            close: () => closeGate,
        });

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-disconnecting-close",
        });
        await fastify.ready();
        let fastifyClosed = false;
        const closePromise = fastify.close().then(() => {
            fastifyClosed = true;
        });
        await new Promise((resolve) => setImmediate(resolve));

        assert.strictEqual(mockConn.close.mock.callCount(), 1);
        assert.strictEqual(fastifyClosed, false);

        finishClose();
        await closePromise;
        assert.strictEqual(fastifyClosed, true);
    });

    test("should close a still-connecting connection on fastify close", async () => {
        const fastify = Fastify();
        const mockConn = makeMockConnection({ id: 9, readyState: 2 });
        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-connecting-close",
        });
        await fastify.ready();
        await fastify.close();

        assert.strictEqual(mockConn.close.mock.callCount(), 1);
    });

    test("should log and absorb connection close failures", async () => {
        const fastify = Fastify();
        const closeError = new Error("close failed");
        const mockConn = makeMockConnection({
            id: 10,
            readyState: 1,
            close: async () => {
                throw closeError;
            },
        });
        const log = capturePluginLog(fastify);
        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test-close-error" });
        await fastify.ready();

        await assert.doesNotReject(() => fastify.close());
        assert.strictEqual(log.warn.mock.callCount(), 1);
        assert.deepStrictEqual(log.warn.mock.calls[0].arguments[0], { err: closeError });
    });

    test("should warn on unexpected disconnects but not intentional disconnects", async () => {
        const fastify = Fastify();
        const mockConn = makeMockConnection({ id: 11 });
        const log = capturePluginLog(fastify);
        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test-events" });

        const connecting = getConnectionListener(mockConn, "connecting");
        const disconnecting = getConnectionListener(mockConn, "disconnecting");
        const disconnected = getConnectionListener(mockConn, "disconnected");
        assert.strictEqual(typeof connecting, "function");
        assert.strictEqual(typeof disconnecting, "function");
        assert.strictEqual(typeof disconnected, "function");

        disconnected();
        assert.strictEqual(log.warn.mock.callCount(), 1);
        assert.match(log.warn.mock.calls[0].arguments[0], /disconnected/);

        disconnecting();
        disconnected();
        assert.strictEqual(log.warn.mock.callCount(), 1);

        connecting();
        disconnected();
        assert.strictEqual(log.warn.mock.callCount(), 2);

        await fastify.close();
    });

    test("should suppress pending connection errors during intentional shutdown", async () => {
        const fastify = Fastify();
        const connectionError = new Error("connect failed during shutdown");
        let rejectOpenUri;
        const openUriPending = new Promise((resolve, reject) => {
            rejectOpenUri = reject;
        });
        const mockConn = makeMockConnection({
            id: 12,
            openUri: () => openUriPending,
            close: async () => {
                emitConnectionError(connectionError);
                rejectOpenUri(connectionError);
                await new Promise((resolve) => setImmediate(resolve));
            },
        });
        const log = capturePluginLog(fastify);
        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-shutdown-error",
            waitForConnection: false,
        });
        await fastify.ready();

        const emitConnectionError = getConnectionListener(mockConn, "error");
        assert.strictEqual(typeof emitConnectionError, "function");

        await fastify.close();
        assert.strictEqual(log.error.mock.callCount(), 0);
    });
});

describe("redactMongoUri", () => {
    test("redacts user:password in the userinfo segment", () => {
        const out = redactMongoUri("mongodb://alice:s3cret@host:27017/db");
        assert.ok(out.startsWith("mongodb://***@host:27017/db"));
        assert.ok(!out.includes("alice"));
        assert.ok(!out.includes("s3cret"));
    });

    test("redacts username without password", () => {
        const out = redactMongoUri("mongodb://alice@host:27017/db");
        assert.strictEqual(out, "mongodb://***@host:27017/db");
    });

    test("redacts mongodb+srv URIs", () => {
        const out = redactMongoUri("mongodb+srv://alice:s3cret@cluster.mongodb.net/db");
        assert.strictEqual(out, "mongodb+srv://***@cluster.mongodb.net/db");
    });

    test("redacts password query-string parameter", () => {
        const out = redactMongoUri("mongodb://host:27017/db?authSource=admin&password=hunter2");
        assert.ok(out.includes("password=***"), `expected password=***, got: ${out}`);
        assert.ok(out.includes("authSource=admin"), "non-sensitive params preserved");
        assert.ok(!out.includes("hunter2"), "raw secret must not appear");
    });

    test("redacts both userinfo and sensitive query params", () => {
        const out = redactMongoUri(
            "mongodb://alice:s3cret@host:27017/db?password=hunter2&token=abc",
        );
        assert.ok(!out.includes("s3cret"), "userinfo password must not appear");
        assert.ok(!out.includes("hunter2"), "query password must not appear");
        assert.ok(!out.includes("abc"), "query token must not appear");
        assert.ok(out.includes("***@"), "userinfo redacted");
    });

    test("matches sensitive query keys case-insensitively", () => {
        const out = redactMongoUri("mongodb://host:27017/db?Password=hunter2&Token=abc");
        assert.ok(!out.includes("hunter2"));
        assert.ok(!out.includes("abc"));
    });

    test("leaves credentials-free URIs unchanged in substance", () => {
        const out = redactMongoUri("mongodb://host:27017/db?authSource=admin");
        assert.ok(out.startsWith("mongodb://host:27017/db"));
        assert.ok(out.includes("authSource=admin"));
    });

    test("falls back to coarse redaction on malformed URI", () => {
        const out = redactMongoUri(
            "not-a-uri-but-//alice:s3cret@somewhere?password=hunter2&safe=value",
        );
        assert.ok(!out.includes("alice:s3cret"));
        assert.ok(!out.includes("hunter2"));
        assert.ok(out.includes("safe=value"));
        assert.ok(out.includes("***"));
    });

    test("redacts query credentials in multi-host URIs with explicit ports", () => {
        const out = redactMongoUri(
            "mongodb://alice:s3cret@h1:27017,h2:27017,h3:27017/db?tlsCertificateKeyFilePassword=hunter2&replicaSet=rs0",
        );

        assert.ok(!out.includes("alice"));
        assert.ok(!out.includes("s3cret"));
        assert.ok(!out.includes("hunter2"));
        assert.ok(out.includes("h1:27017,h2:27017,h3:27017"));
        assert.ok(out.includes("replicaSet=rs0"));
    });

    test("redacts generic query credentials in multi-host URIs without userinfo", () => {
        const out = redactMongoUri(
            "mongodb://h1:27017,h2:27017/db?password=hunter2&authSource=admin",
        );

        assert.ok(!out.includes("hunter2"));
        assert.ok(out.includes("password=***"));
        assert.ok(out.includes("authSource=admin"));
    });

    test("redacts proxy credentials and authentication mechanism properties", () => {
        const out = redactMongoUri(
            "mongodb://host:27017/db?proxyUsername=alice&proxyPassword=s3cret&authMechanismProperties=AWS_SESSION_TOKEN:token123,SERVICE_NAME:mongodb",
        );

        assert.ok(!out.includes("alice"));
        assert.ok(!out.includes("s3cret"));
        assert.ok(!out.includes("token123"));
        assert.ok(out.includes("proxyUsername=***"));
        assert.ok(out.includes("proxyPassword=***"));
    });

    test("redacts percent-encoded sensitive query keys", () => {
        const out = redactMongoUri("mongodb://host:27017/db?pass%77ord=hunter2&safe=value");

        assert.ok(!out.includes("hunter2"));
        assert.ok(out.includes("password=***"));
        assert.ok(out.includes("safe=value"));
    });
});

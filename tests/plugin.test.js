import assert from "node:assert";
import { describe, mock, test } from "node:test";

import Fastify from "fastify";
import mongoose from "mongoose";

import plugin, { redactMongoUri } from "../src/plugin.js";

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

    test("should not close disconnected connection on fastify close", async () => {
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

        assert.strictEqual(mockConn.close.mock.callCount(), 0);
    });

    test("should not close disconnecting connection on fastify close", async () => {
        const fastify = Fastify();
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => {}),
            close: mock.fn(async () => {}),
            readyState: 3,
            id: 6,
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-disconnecting-close",
        });
        await fastify.ready();
        await fastify.close();

        assert.strictEqual(mockConn.close.mock.callCount(), 0);
    });
});

describe("redactMongoUri", () => {
    test("redacts user:password in the userinfo segment", () => {
        const out = redactMongoUri("mongodb://alice:s3cret@host:27017/db");
        assert.strictEqual(out, "mongodb://***:***@host:27017/db");
    });

    test("redacts username without password", () => {
        const out = redactMongoUri("mongodb://alice@host:27017/db");
        assert.strictEqual(out, "mongodb://***@host:27017/db");
    });

    test("redacts mongodb+srv URIs", () => {
        const out = redactMongoUri("mongodb+srv://alice:s3cret@cluster.mongodb.net/db");
        assert.strictEqual(out, "mongodb+srv://***:***@cluster.mongodb.net/db");
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
        assert.ok(out.includes("***:***@"), "userinfo redacted");
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
        const out = redactMongoUri("not-a-uri-but-//alice:s3cret@somewhere");
        assert.ok(!out.includes("alice:s3cret"));
        assert.ok(out.includes("***"));
    });
});

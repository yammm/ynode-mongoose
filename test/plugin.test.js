
import { test, describe, mock } from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import mongoose from "mongoose";
import plugin from "../src/plugin.js";

describe("@ynode/mongoose", () => {
    test("should register the plugin", async () => {
        const fastify = Fastify();

        // Mock mongoose.createConnection
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => { }),
            close: mock.fn(async () => { }),
            readyState: 0,
            id: 1
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test" });

        assert.ok(fastify.mongoose, "mongoose decorator should exist");
        assert.strictEqual(fastify.mongoose, mockConn, "mongoose decorator should be the connection object");

        await fastify.close();
    });

    test("should support string option as uri", async () => {
        const fastify = Fastify();

        // Mock mongoose.createConnection
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => { }),
            close: mock.fn(async () => { }),
            readyState: 0,
            id: 2
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, "mongodb://localhost:27017/test-string");
        await fastify.ready();

        assert.ok(fastify.mongoose, "mongoose decorator should exist");
        assert.strictEqual(fastify.mongoose, mockConn, "mongoose decorator should be the connection object");

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
            close: mock.fn(async () => { }),
            readyState: 0,
            id: 3
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
            close: mock.fn(async () => { }),
            readyState: 0,
            id: 7
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, {
            uri: "mongodb://localhost:27017/test-reject-nonblocking",
            waitForConnection: false
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
            await fastify.register(plugin, { uri: "mongodb://localhost:27017/test", waitForConnection: "false" });
            assert.fail("Should have thrown error");
        } catch (err) {
            assert.strictEqual(err.message, "@ynode/mongoose requires options.waitForConnection to be a boolean");
        }
    });

    test("should throw if registered twice", async () => {
        const fastify = Fastify();
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => { }),
            close: mock.fn(async () => { }),
            readyState: 0
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
            openUri: mock.fn(async () => { }),
            close: mock.fn(async () => { }),
            readyState: 1,
            id: 4
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
            openUri: mock.fn(async () => { }),
            close: mock.fn(async () => { }),
            readyState: 0,
            id: 5
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test-disconnected-close" });
        await fastify.ready();
        await fastify.close();

        assert.strictEqual(mockConn.close.mock.callCount(), 0);
    });

    test("should not close disconnecting connection on fastify close", async () => {
        const fastify = Fastify();
        const mockConn = {
            on: mock.fn(),
            openUri: mock.fn(async () => { }),
            close: mock.fn(async () => { }),
            readyState: 3,
            id: 6
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, { uri: "mongodb://localhost:27017/test-disconnecting-close" });
        await fastify.ready();
        await fastify.close();

        assert.strictEqual(mockConn.close.mock.callCount(), 0);
    });
});

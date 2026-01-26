
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
            id: 1,
            _connectionString: "mongodb://localhost:27017/test"
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
            id: 2,
            _connectionString: "mongodb://localhost:27017/test-string"
        };

        mock.method(mongoose, "createConnection", () => mockConn);

        await fastify.register(plugin, "mongodb://localhost:27017/test-string");
        await fastify.ready();

        assert.ok(fastify.mongoose, "mongoose decorator should exist");
        assert.strictEqual(fastify.mongoose, mockConn, "mongoose decorator should be the connection object");

        const openUriCall = mockConn.openUri.mock.calls[0];
        assert.strictEqual(openUriCall.arguments[0], "mongodb://localhost:27017/test-string");

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
});

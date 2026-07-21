import Fastify from "fastify";

import mongoosePlugin from "../src/plugin.js";

const app = Fastify({ logger: true });

// Register the Mongoose plugin and attach a global Mongoose connection to Fastify
await app.register(mongoosePlugin, {
    uri: "mongodb://127.0.0.1:27017/ynode_mongoose_example",
    serverSelectionTimeoutMS: 5000,
});

app.get("/", async function (_request, reply) {
    const { readyState } = this.mongoose;
    const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
    const connected = readyState === 1;

    reply.code(connected ? 200 : 503);

    return {
        status: connected ? "ok" : "degraded",
        database: states[readyState] || "unknown",
    };
});

let closing = false;
const shutdown = async (signal) => {
    if (closing) {
        return;
    }
    closing = true;
    app.log.info({ signal }, "Closing Fastify and Mongoose");
    try {
        await app.close();
    } catch (err) {
        app.log.error({ err }, "Shutdown failed");
        process.exitCode = 1;
    }
};

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        // Intentional fire-and-forget: shutdown handles and records its own errors.
        void shutdown(signal);
    });
}

try {
    await app.listen({ port: 3000 });
} catch (err) {
    app.log.error({ err }, "Startup failed");
    await shutdown("startup-error");
    process.exitCode = 1;
}

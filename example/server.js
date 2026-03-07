import Fastify from "fastify";
import mongoosePlugin from "../src/plugin.js";

const app = Fastify({ logger: true });

// Register the Mongoose plugin and attach a global Mongoose connection to Fastify
await app.register(mongoosePlugin, {
    uri: "mongodb://127.0.0.1:27017/ynode_mongoose_example",
    options: {
        serverSelectionTimeoutMS: 5000,
    },
});

app.get("/", async function (request, reply) {
    const readyState = this.mongoose.connection.readyState;
    const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };

    return {
        status: "ok",
        database: states[readyState] || "unknown"
    };
});

try {
    await app.listen({ port: 3000 });
} catch (err) {
    app.log.error(err);
    process.exit(1);
}

import fastifyMongoose, { redactMongoUri, type FastifyMongooseOptions } from "@ynode/mongoose";
import metadata from "@ynode/mongoose/package.json" with { type: "json" };
import Fastify from "fastify";
import type { Connection } from "mongoose";

const options = {
    driverInfo: { name: "overridden", version: "1.0.0" },
    maxPoolSize: 10,
    name: "mongoose-consumer",
    uri: "mongodb://127.0.0.1:27017/app",
    waitForConnection: false,
} satisfies FastifyMongooseOptions;

const app = Fastify();
await app.register(fastifyMongoose, options);

const connection: Connection = app.mongoose;
const redacted: string = redactMongoUri("mongodb://user:secret@127.0.0.1/app");

// @ts-expect-error The object form requires a MongoDB URI.
const missingUri: FastifyMongooseOptions = { maxPoolSize: 5 };

// @ts-expect-error The JavaScript-only string shortcut is intentionally not in the public types.
await app.register(fastifyMongoose, "mongodb://127.0.0.1:27017/app");

metadata.name satisfies string;
void connection;
void missingUri;
void redacted;

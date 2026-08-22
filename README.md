# @ynode/mongoose

Copyright (c) 2026 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/mongoose.svg)](https://www.npmjs.com/package/@ynode/mongoose) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A better [Mongoose](https://mongoosejs.com/) [Fastify](https://www.fastify.io/) plugin for connection sharing and useful logging

## Why?

A lightweight **Fastify** plugin that exposes a single **mongoose** client (`mongoose` package) on your Fastify instance and handles connection lifecycle (connect → ready → reconnect → close) for you.

- ✅ Uses the **official** [`mongoose`](https://www.npmjs.com/package/mongoose) client
- ✅ Clean Fastify integration with proper startup/shutdown hooks
- ✅ Simple API: `fastify.mongoose` everywhere in your app

## Installation

Requires Node.js 20.19.0 or newer, Fastify 5, and Mongoose 9. Install the package and its Mongoose peer dependency:

```sh
npm install @ynode/mongoose mongoose
```

## Usage

Register the plugin with your Fastify instance. You MUST provide a `uri` option. By default, startup waits for MongoDB (`waitForConnection: true`). The plugin consumes `uri`, `waitForConnection`, and `name`; all remaining options are passed to `connection.openUri(uri, options)`.

### Registering the Plugin

```javascript
import Fastify from "fastify";
import fastifyMongoose from "@ynode/mongoose";

const fastify = Fastify({
    logger: true,
});

// Register the plugin with options
await fastify.register(fastifyMongoose, {
    uri: "mongodb://localhost:27017/my_database",
    waitForConnection: true,
    // Merged into driverInfo.name; this is not the Mongoose connection name.
    name: "my-fastify-service",
    // Options below are passed to connection.openUri(uri, options)
    maxPoolSize: 10,
    driverInfo: { version: "1.0.0" },
});

// JavaScript also supports a runtime-only connection-string shortcut.
// TypeScript callers should use the object form above.
await fastify.register(fastifyMongoose, "mongodb://localhost:27017/my_database");

// For non-blocking startup behavior
await fastify.register(fastifyMongoose, {
    uri: "mongodb://localhost:27017/my_database",
    waitForConnection: false,
});
```

### Using the Connection

The Mongoose connection is available at `fastify.mongoose`. You should use this connection to create your models to ensure they are bound to this specific connection.

```javascript
// Define a schema
const UserSchema = new fastify.mongoose.base.Schema({
    name: String,
    email: String,
});

// Create a model attached to this connection
// Note: We use fastify.mongoose.model, NOT the global mongoose.model
const User = fastify.mongoose.model("User", UserSchema);

// Route example
fastify.get("/users", async (request, reply) => {
    const users = await User.find();
    return users;
});

const start = async () => {
    try {
        await fastify.listen({ port: 3000 });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
```

## Options

This plugin consumes `uri`, `waitForConnection`, and `name`. It forwards all remaining options to `connection.openUri(uri, options)` from the official `mongoose` library.

- `waitForConnection` (boolean, default: `true`): if `true`, `fastify.ready()` fails when initial MongoDB connection fails. If `false`, startup continues while one initial connection attempt runs in the background. The plugin does not retry a failed initial attempt; Mongoose reconnects automatically only after an initial connection succeeds.
- `name` (string, optional): MongoDB driver identifier merged into `driverInfo.name`. It overrides an existing `driverInfo.name`, preserves other `driverInfo` fields such as `version` and `platform`, and does not change the Mongoose connection name.

For a full list of available options, please see the **[official `mongoose` documentation](https://mongoosejs.com/docs/api/connection.html)**.

## Failure Behavior

- The plugin starts connecting during Fastify `onReady`.
- `waitForConnection: true` (default): startup fails if the initial connection attempt fails.
- `waitForConnection: false`: startup is non-blocking and one failed initial attempt is logged without retrying.
- Connection lifecycle events (`connected`, `disconnected`, `reconnected`, `error`, `close`) are logged. Intentional shutdown disconnects are not warned as outages.
- On shutdown, the plugin awaits `connection.close()`. Mongoose safely joins connections that are still connecting or already disconnecting.

## Health and Readiness

The decorated connection exposes non-throwing probe helpers without registering an HTTP route:

- `fastify.mongoose.readiness()` returns the current Mongoose `readyState` and whether it is connected.
- `fastify.mongoose.healthcheck()` sends a MongoDB `ping` and always resolves with status, latency, and a serializable error when unhealthy.

The ping is bounded to 5000 ms by default so a stalled connection cannot hang a probe. Override it per call with `healthcheck({ timeoutMs })`.

```javascript
const readiness = fastify.mongoose.readiness();
// { isReady: true, readyState: 1 }

const health = await fastify.mongoose.healthcheck({ timeoutMs: 1000 });
// { ok: true, ping: 1, latencyMs: 2, isReady: true, readyState: 1 }
```

## License

This project is licensed under the [MIT License](./LICENSE).

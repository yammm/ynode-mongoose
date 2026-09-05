# @ynode/mongoose

Copyright (c) 2026 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/mongoose.svg)](https://www.npmjs.com/package/@ynode/mongoose) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A better [Mongoose](https://mongoosejs.com/) [Fastify](https://www.fastify.io/) plugin for connection sharing and useful logging

## Why?

A lightweight **Fastify** plugin that exposes a single **mongoose** client (`mongoose` package) on your Fastify instance and handles connection lifecycle (connect → ready → reconnect → close) for you.

- ✅ Uses the **official** [`mongoose`](https://www.npmjs.com/package/mongoose) client
- ✅ Clean Fastify integration with proper startup/shutdown hooks
- ✅ Simple API: `fastify.mongoose` everywhere in your app

## Node.js support

This package requires Node.js 20.19.0 or newer. CI exercises the exact 20.19.0, 22.13.0, and 24.0.0 boundaries. Node.js 20 remains tested only to preserve the current major-version contract even though upstream support has ended; use Node.js 22 or 24 for supported production deployments. A newly released Node.js major is not considered supported until it is added to CI, even when the open `engines` range admits it.

## Installation

Requires Node.js 20.19.0 or newer, Fastify 5, and Mongoose 9. Install the package and its Mongoose peer dependency:

```sh
npm install @ynode/mongoose mongoose
```

## Usage

Register the plugin with your Fastify instance. You MUST provide a `uri` option. By default, startup waits for MongoDB (`waitForConnection: true`). The plugin consumes `uri`, `waitForConnection`, `name`, and `initialConnectionRetry`; all remaining options are passed to `connection.openUri(uri, options)`.

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
    initialConnectionRetry: {
        timeoutMs: 30_000,
        initialDelayMs: 100,
        maxDelayMs: 5_000,
        factor: 2,
    },
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

This plugin consumes `uri`, `waitForConnection`, `name`, and `initialConnectionRetry`. It forwards all remaining options to `connection.openUri(uri, options)` from the official `mongoose` library.

- `waitForConnection` (boolean, default: `true`): if `true`, `fastify.ready()` fails when initial MongoDB connection fails. If `false`, startup continues while the initial connection runs in the background. With the default retry-disabled policy, only one attempt is made; Mongoose reconnects automatically only after an initial connection succeeds.
- `name` (string, optional): MongoDB driver identifier merged into `driverInfo.name`. It overrides an existing `driverInfo.name`, preserves other `driverInfo` fields such as `version` and `platform`, and does not change the Mongoose connection name.
- `initialConnectionRetry` (boolean or object, default: `false`): opt in to retrying the initial connection with bounded exponential backoff. `true` uses a 30-second total deadline, 100 ms initial delay, 5-second maximum delay, and factor 2. The object form accepts `timeoutMs`, `initialDelayMs`, `maxDelayMs`, `factor`, and an external `signal`.

For a full list of available options, please see the **[official `mongoose` documentation](https://mongoosejs.com/docs/api/connection.html)**.

## Failure Behavior

- The plugin starts connecting during Fastify `onReady`.
- `waitForConnection: true` (default): startup fails if the initial connection attempt fails. With retry enabled, startup remains pending until a connection succeeds, the total deadline expires, or cancellation is requested.
- `waitForConnection: false`: startup is non-blocking. Without retry, one failed initial attempt is logged. With retry enabled, the bounded retry loop continues in the background.
- Retry is disabled by default, so existing startup behavior is unchanged. Deadline exhaustion uses error code `MONGOOSE_INITIAL_CONNECT_TIMEOUT`; cancellation uses an `AbortError` with code `MONGOOSE_INITIAL_CONNECT_ABORTED`.
- Fastify shutdown cancels any retry-enabled background attempt before awaiting `connection.close()`. Supplying `initialConnectionRetry.signal` allows application code to cancel independently without closing Fastify.
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

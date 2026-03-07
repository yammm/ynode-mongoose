# @ynode/mongoose

Copyright (c) 2026 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/mongoose.svg)](https://www.npmjs.com/package/@ynode/mongoose)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A better [Mongoose](https://mongoosejs.com/) [Fastify](https://www.fastify.io/) plugin for connection sharing and useful
logging

## Why?

A lightweight **Fastify** plugin that exposes a single **mongoose** client (`mongoose` package) on your Fastify instance
and handles connection lifecycle (connect → ready → reconnect → close) for you.

- ✅ Uses the **official** [`mongoose`](https://www.npmjs.com/package/mongoose) client
- ✅ Clean Fastify integration with proper startup/shutdown hooks
- ✅ Simple API: `fastify.mongoose` everywhere in your app

## Installation

Install the package and its required peer dependency, `mongoose`.

```sh
npm install @ynode/mongoose mongoose

```

## Basic Usage

```javascript
import mongoose from "@ynode/mongoose";

if (fastify.argv.mongoose) {
    // connect to mongoose
    await fastify.register(mongoose, { uri: fastify.argv.mongoose });
}
```

## Usage

Register the plugin with your Fastify instance. You MUST provide a `uri` option. By default, startup waits for MongoDB
(`waitForConnection: true`). Any other options you provide are passed directly to `connection.openUri(uri, options)`.

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
    // Options below are passed to connection.openUri(uri, options)
    maxPoolSize: 10,
});

// Or simply with a connection string
await fastify.register(fastifyMongoose, "mongodb://localhost:27017/my_database");

// For non-blocking startup behavior
await fastify.register(fastifyMongoose, {
    uri: "mongodb://localhost:27017/my_database",
    waitForConnection: false,
});
```

### Using the Connection

The Mongoose connection is available at `fastify.mongoose`. You should use this connection to create your models to
ensure they are bound to this specific connection.

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

This plugin passes all options directly to `connection.openUri(uri, options)` from the official `mongoose` library.

- `waitForConnection` (boolean, default: `true`): if `true`, `fastify.ready()` fails when initial MongoDB connection
  fails. If `false`, startup continues and failures are logged.

For a full list of available options, please see the
**[official `mongoose` documentation](https://mongoosejs.com/docs/api/connection.html)**.

## Failure Behavior

- The plugin starts connecting during Fastify `onReady`.
- `waitForConnection: true` (default): startup fails if the initial connection attempt fails.
- `waitForConnection: false`: startup is non-blocking and initial connection failures are logged.
- Connection lifecycle events (`connected`, `reconnected`, `error`, `close`) are logged.
- On shutdown, the plugin calls `connection.close()` only when the connection is active.

## License

This project is licensed under the [MIT License](./LICENSE).


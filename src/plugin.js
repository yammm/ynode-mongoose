/**
 *  A better mongoose Fastify plugin
 *
 * @module @ynode/mongoose
 */

/*
The MIT License (MIT)

Copyright (c) 2026 Michael Welter <me@mikinho.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import fp from "fastify-plugin";

import mongoose from "mongoose";

function redactMongoUri(uri) {
    // Redact credentials between `//` and `@` to avoid leaking secrets in logs.
    return uri.replace(/\/\/[^@/]+@/u, "//***@");
}

/**
 * This plugin adds a "mongoose" decorator to the Fastify server instance,
 * allowing for easy access to the mongoose connection.
 *
 * @param {FastifyInstance} fastify The Fastify instance.
 * @param {object} options Plugin options, directly passed to connection.openUri.
 * @param {String} options.uri mongodb URI to connect to
 * @param {string} [options.name] Optionally set a connection name. Useful for debugging
 */
export default fp(async function (fastify, options) {
    if (fastify.mongoose) {
        throw new Error("@ynode/mongoose has already been registered");
    }

    let uri = options;
    let opts = {};

    if (typeof options === "object") {
        // Destructure the 'uri' property and collect the rest into a new object 'opts'
        ({ uri, ...opts } = options);
    }

    if (!uri || typeof uri !== "string") {
        throw new Error("@ynode/mongoose requires options.uri");
    }

    const connectionLabel = redactMongoUri(uri);
    const conn = mongoose.createConnection();

    // sharing is caring
    fastify.decorate("mongoose", conn);

    // Initiating a connection to the MongoDB server
    conn.on("connecting", () => fastify.log.debug(`Initiating a connection to the MongoDB server`));

    // Initiating a connection to the MongoDB server
    conn.on("connected", async () => {
        // console.dir(conn, { depth: 1, colors: true });
        fastify.log.info(`Mongoose connection is ready to use [${conn.id}] ${connectionLabel}`);
    });

    // Connection has been closed (via .disconnect() / .close())
    conn.on("close", () =>
        fastify.log.info(
            `Mongoose connection to the MongoDB server has been closed [${conn.id}] ${connectionLabel}`,
        ),
    );

    // Always ensure there is a listener for errors in the client to prevent process crashes due to unhandled errors
    conn.on("error", (error) => fastify.log.error(`Mongoose connection error has occurred:`, error));

    // Initiating a connection to the MongoDB server
    conn.on("reconnected", () =>
        fastify.log.warn(
            `Mongoose reconnected to the MongoDB server [${conn.id}] ${connectionLabel}`,
        ),
    );

    fastify.addHook("onReady", async () => {
        conn.openUri(uri, { ...opts }).catch((error) => {
            fastify.log.error(
                { err: error },
                `Mongoose initial connection failed [${conn.id}] ${connectionLabel}`,
            );
        });
    });

    fastify.addHook("onClose", async () => {
        // Check if the connection readyState is not 'disconnected' (0) or 'disconnecting' (3)
        if (conn.readyState === 0 || conn.readyState === 3) {
            return;
        }
        fastify.log.debug(`Attempting to close our Mongoose connection [${conn.id}] ${connectionLabel}`);
        await conn.close();
    });
}, {
    fastify: "5.x",
    name: "@ynode/mongoose",
});

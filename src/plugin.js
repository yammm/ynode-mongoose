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

/**
 * Redacts credentials from a MongoDB connection URI to prevent secret leakage in logs.
 * Replaces the user:password segment between `//` and `@` with `***`.
 * @param {string} uri - MongoDB connection URI.
 * @returns {string} URI with credentials replaced by `***`.
 */
function redactMongoUri(uri) {
    return uri.replace(/\/\/[^@/]+@/u, "//***@");
}

/**
 * This plugin adds a "mongoose" decorator to the Fastify server instance,
 * allowing for easy access to the mongoose connection.
 *
 * @param {FastifyInstance} fastify The Fastify instance.
 * @param {object} options Plugin options, directly passed to connection.openUri.
 * @param {string} options.uri mongodb URI to connect to
 * @param {boolean} [options.waitForConnection=true] If true, startup fails when initial MongoDB connection fails.
 * @param {string} [options.name] Optionally set a connection name. Useful for debugging
 */
export default fp(
    async function (fastify, options) {
        if (fastify.mongoose) {
            throw new Error("@ynode/mongoose has already been registered");
        }

        let uri = options;
        let opts = {};
        let waitForConnection = true;

        if (options && typeof options === "object") {
            // Destructure the 'uri' property and collect the rest into a new object 'opts'
            ({ uri, waitForConnection = true, ...opts } = options);
        }

        if (!uri || typeof uri !== "string") {
            throw new Error("@ynode/mongoose requires options.uri");
        }
        if (typeof waitForConnection !== "boolean") {
            throw new Error("@ynode/mongoose requires options.waitForConnection to be a boolean");
        }

        const log = fastify.log.child({ name: "@ynode/mongoose" });

        const connectionLabel = redactMongoUri(uri);
        const conn = mongoose.createConnection();

        // sharing is caring
        fastify.decorate("mongoose", conn);

        // Initiating a connection to the MongoDB server
        conn.on("connecting", () => log.debug(`Initiating a connection to the MongoDB server`));

        // Connection established successfully
        conn.on("connected", () => {
            log.info(`Mongoose connection is ready to use [${conn.id}] ${connectionLabel}`);
        });

        // Connection has been closed (via .disconnect() / .close())
        conn.on("close", () =>
            log.info(
                `Mongoose connection to the MongoDB server has been closed [${conn.id}] ${connectionLabel}`,
            ),
        );

        // Always ensure there is a listener for errors in the client to prevent process crashes due to unhandled errors
        conn.on("error", (error) =>
            log.error(
                { err: error },
                `Mongoose connection error has occurred [${conn.id}] ${connectionLabel}`,
            ),
        );

        // Driver successfully reconnected after a transient failure
        conn.on("reconnected", () =>
            log.warn(`Mongoose reconnected to the MongoDB server [${conn.id}] ${connectionLabel}`),
        );

        fastify.addHook("onReady", async () => {
            if (!waitForConnection) {
                // Intentional fire-and-forget: connect in the background so server
                // starts immediately. Failures are logged but do not block startup.
                conn.openUri(uri, { ...opts }).catch((error) => {
                    log.error(
                        { err: error },
                        `Mongoose initial connection failed [${conn.id}] ${connectionLabel}`,
                    );
                });
                return;
            }

            try {
                await conn.openUri(uri, { ...opts });
            } catch (error) {
                log.error(
                    { err: error },
                    `Mongoose initial connection failed [${conn.id}] ${connectionLabel}`,
                );
                throw error;
            }
        });

        fastify.addHook("onClose", async () => {
            // readyState can transition between check and close(); guard with try-catch
            if (conn.readyState === 0 || conn.readyState === 3) {
                return;
            }
            log.debug(
                `Attempting to close our Mongoose connection [${conn.id}] ${connectionLabel}`,
            );
            try {
                await conn.close();
            } catch (error) {
                log.warn(
                    { err: error },
                    `Error closing Mongoose connection [${conn.id}] ${connectionLabel}`,
                );
            }
        });
    },
    {
        fastify: "5.x",
        name: "@ynode/mongoose",
    },
);

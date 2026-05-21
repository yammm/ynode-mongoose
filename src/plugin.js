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
 * Query-string parameter names whose values may carry credentials and must
 * be redacted before logging. Matched case-insensitively.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
    "password",
    "secret",
    "token",
    "apikey",
    "api_key",
    "tlscertificatekeyfilepassword",
]);

/**
 * Redacts credentials from a MongoDB connection URI to prevent secret leakage
 * in logs. Sanitizes both the userinfo segment (`mongodb://user:pass@host`)
 * and any sensitive query-string parameters (e.g. `?password=`). Falls back
 * to a coarse regex redaction of `//user:pass@` if the URI fails to parse,
 * so a malformed URI is never logged in raw form.
 * @param {string} uri - MongoDB connection URI.
 * @returns {string} URI with credentials replaced by `***`.
 */
export function redactMongoUri(uri) {
    try {
        const u = new URL(uri);
        if (u.username) {
            u.username = "***";
        }
        if (u.password) {
            u.password = "***";
        }
        const sensitiveKeys = [];
        for (const key of u.searchParams.keys()) {
            if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
                sensitiveKeys.push(key);
            }
        }
        for (const key of sensitiveKeys) {
            u.searchParams.set(key, "***");
        }
        return u.toString();
    } catch {
        return uri.replace(/\/\/[^@/]+@/u, "//***@");
    }
}

/**
 * This plugin adds a "mongoose" decorator to the Fastify server instance,
 * allowing for easy access to the Mongoose connection. The plugin also
 * accepts a plain string in place of the options object as a shortcut for
 * `{ uri }`.
 *
 * @param {FastifyInstance} fastify - The Fastify instance.
 * @param {object|string} options - Plugin options, or the URI string directly.
 *   All keys other than `uri` and `waitForConnection` are forwarded to
 *   `connection.openUri()` as Mongoose connection options.
 * @param {string} options.uri - MongoDB connection URI.
 * @param {boolean} [options.waitForConnection=true] - If true, startup fails
 *   when the initial MongoDB connection fails. If false, the connection is
 *   attempted in the background and errors are logged but do not block boot.
 * @returns {Promise<void>}
 */
export default fp(
    async function mongoosePlugin(fastify, options) {
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

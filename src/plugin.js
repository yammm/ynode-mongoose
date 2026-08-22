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
import { redactConnectionString } from "mongodb-connection-string-url";
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
    "authmechanismproperties",
    "proxypassword",
    "proxyusername",
    "tlscertificatekeyfilepassword",
]);

/**
 * Determines whether a raw query-parameter key names a sensitive credential.
 * Percent-encoded keys are decoded before matching so encoding cannot be used
 * to smuggle a credential past redaction.
 * @param {string} rawKey - Query-parameter key exactly as it appears in the URI.
 * @returns {boolean} True when the key matches a sensitive parameter name.
 */
function isSensitiveQueryParam(rawKey) {
    let key = rawKey;
    try {
        key = decodeURIComponent(rawKey);
    } catch {
        // Malformed percent-encoding: match against the raw key bytes instead.
    }
    return SENSITIVE_QUERY_PARAMS.has(key.toLowerCase());
}

/**
 * Redacts generic credential-like query parameters after the MongoDB driver's
 * own connection-string redactor has handled driver-specific credentials.
 * Sensitive values are replaced in place on the raw string, so duplicate keys,
 * parameter order, and the original percent-encoding of every other byte are
 * preserved byte-for-byte.
 * @param {string} uri - Partially redacted MongoDB connection URI.
 * @returns {string} URI with generic sensitive query values redacted.
 */
function redactSensitiveQueryParams(uri) {
    const queryIndex = uri.indexOf("?");
    if (queryIndex === -1) {
        return uri;
    }

    const fragmentIndex = uri.indexOf("#", queryIndex);
    const queryEnd = fragmentIndex === -1 ? uri.length : fragmentIndex;
    const query = uri.slice(queryIndex + 1, queryEnd);
    const redacted = query.replace(/([^&;=]+)=([^&;]*)/g, (match, rawKey) => {
        if (!isSensitiveQueryParam(rawKey)) {
            return match;
        }
        return `${rawKey}=***`;
    });

    return `${uri.slice(0, queryIndex + 1)}${redacted}${uri.slice(queryEnd)}`;
}

/**
 * Redacts credentials from a MongoDB connection URI to prevent secret leakage
 * in logs. Uses the MongoDB driver's connection-string redactor for userinfo
 * and driver-specific credentials, then redacts generic sensitive query
 * parameters such as `password`, `secret`, and `token`.
 * @param {string} uri - MongoDB connection URI.
 * @returns {string} URI with credentials replaced by `***`.
 */
export function redactMongoUri(uri) {
    const driverRedacted = redactConnectionString(uri, { replacementString: "***" });
    return redactSensitiveQueryParams(driverRedacted);
}

/**
 * This plugin adds a "mongoose" decorator to the Fastify server instance,
 * allowing for easy access to the Mongoose connection. The plugin also
 * accepts a plain string in place of the options object as a shortcut for
 * `{ uri }`.
 *
 * @param {FastifyInstance} fastify - The Fastify instance.
 * @param {object|string} options - Plugin options, or the URI string directly.
 *   All keys other than `uri`, `waitForConnection`, and `name` are forwarded
 *   to `connection.openUri()` as Mongoose connection options.
 * @param {string} options.uri - MongoDB connection URI.
 * @param {boolean} [options.waitForConnection=true] - If true, startup fails
 *   when the initial MongoDB connection fails. If false, one connection
 *   attempt runs in the background and errors are logged but do not block boot.
 * @param {string} [options.name] - Optional MongoDB driver identifier merged
 *   into the forwarded `driverInfo` object as `driverInfo.name`. It overrides
 *   an existing `driverInfo.name`, preserves other `driverInfo` fields, and
 *   does not change the Mongoose connection name.
 * @returns {Promise<void>}
 */
export default fp(
    async function mongoosePlugin(fastify, options) {
        if (fastify.hasDecorator("mongoose")) {
            throw new Error("@ynode/mongoose has already been registered");
        }

        let uri = options;
        let opts = {};
        let waitForConnection = true;
        let name;

        if (options && typeof options === "object") {
            // Destructure the 'uri' property and collect the rest into a new object 'opts'
            ({ uri, waitForConnection = true, name, ...opts } = options);
        }

        if (!uri || typeof uri !== "string") {
            throw new Error("@ynode/mongoose requires options.uri");
        }
        if (typeof waitForConnection !== "boolean") {
            throw new Error("@ynode/mongoose requires options.waitForConnection to be a boolean");
        }
        if (name !== undefined && (typeof name !== "string" || name === "")) {
            throw new Error("@ynode/mongoose requires options.name to be a non-empty string");
        }
        if (name !== undefined) {
            opts.driverInfo = { ...opts.driverInfo, name };
        }

        const log = fastify.log.child({ name: "@ynode/mongoose" });

        const connectionLabel = redactMongoUri(uri);
        const conn = mongoose.createConnection();
        let intentionalDisconnect = false;

        // sharing is caring
        fastify.decorate("mongoose", conn);

        // Initiating a connection to the MongoDB server
        conn.on("connecting", () => {
            intentionalDisconnect = false;
            log.debug(
                `Initiating a connection to the MongoDB server [${conn.id}] ${connectionLabel}`,
            );
        });

        // Connection established successfully
        conn.on("connected", () => {
            intentionalDisconnect = false;
            log.info(`Mongoose connection is ready to use [${conn.id}] ${connectionLabel}`);
        });

        // Track explicit close/disconnect calls so they do not look like outages.
        conn.on("disconnecting", () => {
            intentionalDisconnect = true;
        });

        // Topology loss does not necessarily emit an error event.
        conn.on("disconnected", () => {
            if (!intentionalDisconnect) {
                log.warn(
                    `Mongoose disconnected from the MongoDB server [${conn.id}] ${connectionLabel}`,
                );
            }
        });

        // Connection has been closed (via .disconnect() / .close())
        conn.on("close", () =>
            log.info(
                `Mongoose connection to the MongoDB server has been closed [${conn.id}] ${connectionLabel}`,
            ),
        );

        // Always ensure there is a listener for errors in the client to prevent process crashes due to unhandled errors
        conn.on("error", (error) => {
            if (intentionalDisconnect) {
                return;
            }
            log.error(
                { err: error },
                `Mongoose connection error has occurred [${conn.id}] ${connectionLabel}`,
            );
        });

        // Driver successfully reconnected after a transient failure
        conn.on("reconnected", () => {
            intentionalDisconnect = false;
            log.warn(`Mongoose reconnected to the MongoDB server [${conn.id}] ${connectionLabel}`);
        });

        fastify.addHook("onReady", async () => {
            if (!waitForConnection) {
                // Intentional fire-and-forget: connect in the background so server
                // starts immediately. This is a single attempt; Mongoose only
                // auto-reconnects after an initial connection succeeds.
                conn.openUri(uri, { ...opts }).catch((error) => {
                    if (intentionalDisconnect) {
                        return;
                    }
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
            intentionalDisconnect = true;
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

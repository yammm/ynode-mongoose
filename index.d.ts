import type { FastifyPluginAsync } from "fastify";
import type { Connection, ConnectOptions } from "mongoose";

declare module "fastify" {
    interface FastifyInstance {
        /**
         * The Mongoose connection instance.
         */
        mongoose: FastifyMongooseConnection;
    }
}

export interface MongooseReadinessStatus {
    isReady: boolean;
    readyState: number;
}

export interface MongooseHealthError {
    name: string;
    message: string;
    code?: string | number;
}

export interface MongooseHealthcheckOptions {
    /** Ping deadline in milliseconds. Defaults to 5000. */
    timeoutMs?: number;
}

export interface MongooseHealthcheckResult extends MongooseReadinessStatus {
    ok: boolean;
    ping?: number;
    latencyMs: number;
    error?: MongooseHealthError;
}

export interface MongooseConnectionHelpers {
    readiness(): MongooseReadinessStatus;
    healthcheck(options?: MongooseHealthcheckOptions): Promise<MongooseHealthcheckResult>;
}

export type FastifyMongooseConnection = Connection & MongooseConnectionHelpers;

export interface MongooseInitialConnectionRetryOptions {
    /** Total retry deadline in milliseconds. Default: 30000. */
    timeoutMs?: number;
    /** Delay after the first failed attempt in milliseconds. Default: 100. */
    initialDelayMs?: number;
    /** Maximum delay between attempts in milliseconds. Default: 5000. */
    maxDelayMs?: number;
    /** Exponential multiplier applied after each failed attempt. Default: 2. */
    factor?: number;
    /** Optional external cancellation signal. Fastify shutdown always cancels retries. */
    signal?: AbortSignal;
}

export type FastifyMongooseOptions = Partial<ConnectOptions> & {
    /**
     * The MongoDB URI to connect to.
     */
    uri: string;

    /**
     * If true (default), Fastify startup fails when initial MongoDB connection fails.
     */
    waitForConnection?: boolean;

    /**
     * Opt-in bounded retry for the initial MongoDB connection. Disabled by
     * default. `true` uses the default retry policy.
     */
    initialConnectionRetry?: boolean | MongooseInitialConnectionRetryOptions;

    /**
     * Optional MongoDB driver identifier forwarded as `driverInfo.name`.
     * This does not change the Mongoose connection name.
     */
    name?: string;
};

export type FastifyMongoosePluginOptions = FastifyMongooseOptions;

/**
 * Redacts credentials from a MongoDB connection URI before logging.
 */
export function redactMongoUri(uri: string): string;

/**
 * Fastify Mongoose Plugin
 *
 * TypeScript consumers should register the plugin with a FastifyMongooseOptions object.
 * The runtime-only string shortcut remains available to JavaScript consumers.
 */
declare const fastifyMongoose: FastifyPluginAsync<FastifyMongooseOptions>;

export default fastifyMongoose;

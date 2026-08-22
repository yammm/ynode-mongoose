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

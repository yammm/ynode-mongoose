import { FastifyPluginAsync } from "fastify";
import { Connection, ConnectOptions } from "mongoose";

declare module "fastify" {
    interface FastifyInstance {
        /**
         * The Mongoose connection instance.
         */
        mongoose: Connection;
    }
}

export interface FastifyMongooseOptions extends ConnectOptions {
    /**
     * The MongoDB URI to connect to.
     */
    uri: string;

    /**
     * If true (default), Fastify startup fails when initial MongoDB connection fails.
     */
    waitForConnection?: boolean;

    /**
     * Optionally set a connection name. Useful for debugging specific connections.
     */
    name?: string;
}

export type FastifyMongoosePluginOptions = FastifyMongooseOptions | string;

/**
 * Fastify Mongoose Plugin
 *
 * Accepts either a FastifyMongooseOptions object or a connection string.
 */
declare const fastifyMongoose: FastifyPluginAsync<FastifyMongoosePluginOptions>;

export default fastifyMongoose;

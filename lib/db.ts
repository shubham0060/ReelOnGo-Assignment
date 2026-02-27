import mongoose from "mongoose";
import { getEnv } from "./env";

declare global {
  var mongooseConnectionPromise: Promise<typeof mongoose> | undefined;
}

export async function connectToDatabase() {
  if (!global.mongooseConnectionPromise) {
    const { mongodbUri } = getEnv();

    global.mongooseConnectionPromise = mongoose.connect(mongodbUri, {
      maxPoolSize: 20,
      minPoolSize: 5,
    });
  }

  return global.mongooseConnectionPromise;
}

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memoryServer;

export const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return;

  const configuredUri = process.env.MONGODB_URI;
  if (configuredUri) {
    try {
      await mongoose.connect(configuredUri, {
        serverSelectionTimeoutMS: 10000,
        autoIndex: process.env.NODE_ENV !== 'production',
      });
      console.log('MongoDB connected successfully using configured URI');
      return;
    } catch (error) {
      console.error('Configured MongoDB URI failed:', error.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Production MongoDB connection failed. Refusing to start with ephemeral storage.');
      }
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI is required in production. Refusing to start with ephemeral storage.');
  }

  try {
    if (!memoryServer) {
      memoryServer = await MongoMemoryServer.create({
        binary: { version: '7.0.14' },
      });
    }
    await mongoose.connect(memoryServer.getUri('civicpulse'), { serverSelectionTimeoutMS: 10000 });
    console.warn('MongoDB connected using an ephemeral in-memory development database. Reports will be lost on restart.');
  } catch (error) {
    console.error('MongoDB unavailable in configured and fallback modes:', error.message);
    throw error;
  }
};

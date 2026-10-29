import http from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import app from './src/app.js';
import { connectDB } from './src/config/db.js';
import { registerSocketHandlers } from './src/socket/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const port = Number(process.env.PORT || 4000);

const start = async () => {
  // Do not accept reports until persistent storage is available.
  await connectDB();

  const server = http.createServer(app);
  const io = registerSocketHandlers(server);
  app.set('io', io);

  server.listen(port, () => {
    console.log(`CivicPulse backend is running on port ${port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down CivicPulse backend`);
    io.close(() => {
      server.close(async () => {
        const mongoose = await import('mongoose');
        await mongoose.default.disconnect();
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((error) => {
  console.error('CivicPulse backend startup failed:', error.message);
  process.exit(1);
});

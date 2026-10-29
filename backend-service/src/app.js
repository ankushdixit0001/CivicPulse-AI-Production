import express from 'express';
import cors from 'cors';
import ticketRoutes from './routes/tickets.js';
import chatRoutes from './routes/chat.js';

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Permit server-to-server and local health checks without an Origin header.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'CivicPulse backend' });
});

app.use('/api/tickets', ticketRoutes);
app.use('/api/chat', chatRoutes);

app.use((err, _req, res, _next) => {
  const status = Number(err.status || (err.name === 'MulterError' ? 400 : 500));
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 ? 'Server error. Please try again later.' : err.message || 'Request failed.',
  });
});

export default app;

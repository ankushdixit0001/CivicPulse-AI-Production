import { Server } from 'socket.io';

export const registerSocketHandlers = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    socket.on('join-zone', ({ zone }) => {
      if (zone) {
        socket.join(zone);
      }
    });

    socket.on('leave-zone', ({ zone }) => {
      if (zone) {
        socket.leave(zone);
      }
    });
  });

  return io;
};

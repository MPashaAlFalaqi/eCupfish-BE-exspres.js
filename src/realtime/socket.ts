import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next();
    try {
      const payload = jwt.verify(token, env.jwtSecret) as { id: number; role: string };
      socket.data.user = payload;
    } catch {
      // Koneksi tamu tetap diperbolehkan untuk memantau lelang publik
    }
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user?.id;
    if (userId) {
      socket.join(`user:${userId}`);
    }

    socket.on('auction:join', (auctionId: number | string) => {
      socket.join(`auction:${auctionId}`);
    });

    socket.on('auction:leave', (auctionId: number | string) => {
      socket.leave(`auction:${auctionId}`);
    });

    socket.on('chat:join', (conversationId: number | string) => {
      socket.join(`chat:${conversationId}`);
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}
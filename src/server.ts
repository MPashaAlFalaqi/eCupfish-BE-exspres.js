import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { UPLOAD_ROOT } from './middleware/upload';
import { initSocket } from './realtime/socket';
import { startAuctionWorker } from './realtime/auctionWorker';

import authRoutes from './routes/authRoutes';
import meRoutes from './routes/meRoutes';
import adminRoutes from './routes/adminRoutes';
import catalogRoutes from './routes/catalogRoutes';
import sellerRoutes from './routes/sellerRoutes';
import orderRoutes from './routes/orderRoutes';
import interactionRoutes from './routes/interactionRoutes';
import financeRoutes from './routes/financeRoutes';

const app = express();
const httpServer = http.createServer(app);
initSocket(httpServer);
startAuctionWorker();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.corsOrigins }));
app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' },
});

app.get('/', (_req, res) => {
  res.json({ message: 'Backend eCupFish + Socket.IO berjalan.' });
});

app.use('/uploads', express.static(UPLOAD_ROOT));
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', catalogRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api', orderRoutes);
app.use('/api', interactionRoutes);
app.use('/api', financeRoutes);

app.use((_req, res) => {
  res.status(404).json({ message: 'Endpoint tidak ditemukan.' });
});
app.use(errorHandler);

httpServer.listen(env.port, () => {
  console.log(`Server eCupFish berjalan di http://localhost:${env.port}`);
});
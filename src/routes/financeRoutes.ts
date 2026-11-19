import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as finance from '../controllers/financeController';
import * as notif from '../controllers/notificationController';

const router = Router();

// Keuangan & Laporan Seller
router.get('/seller/payouts', authenticate, requireRole('ADMIN'), finance.getSellerPayouts);
router.post('/seller/payouts/withdraw', authenticate, requireRole('ADMIN'), finance.withdrawPayouts);
router.get('/seller/reports', authenticate, requireRole('ADMIN'), finance.getSellerReport);

// Notifikasi Lintas Peran (Seller & Buyer)
router.get('/notifications', authenticate, notif.listNotifications);
router.patch('/notifications/:id/read', authenticate, notif.markNotificationRead);
router.patch('/notifications/read-all', authenticate, notif.markAllNotificationsRead);

export default router;
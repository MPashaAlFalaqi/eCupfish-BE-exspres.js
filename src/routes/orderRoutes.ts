import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as order from '../controllers/orderController';

const router = Router();

// Pembeli (BUYER)
router.post('/orders/checkout', authenticate, requireRole('BUYER'), order.checkoutDirect);
router.post('/orders/:id/pay', authenticate, requireRole('BUYER'), order.payOrder);
router.get('/orders', authenticate, requireRole('BUYER'), order.listBuyerOrders);
router.post('/orders/:id/confirm-delivery', authenticate, requireRole('BUYER'), order.confirmDelivery);

// Penjual (ADMIN)
router.get('/seller/orders', authenticate, requireRole('ADMIN'), order.listSellerOrders);
router.patch('/seller/orders/:id/status', authenticate, requireRole('ADMIN'), order.updateSellerOrderStatus);
router.post('/seller/orders/:id/ship', authenticate, requireRole('ADMIN'), order.shipOrder);

export default router;
// adminRoutes.ts
import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { createSeller, listUsers, updateUserStatus } from '../controllers/adminController';

const router = Router();
router.use(authenticate, requireRole('SUPERADMIN'));
router.post('/sellers', createSeller);
router.get('/users', listUsers);
router.patch('/users/:id/status', updateUserStatus);
export default router;
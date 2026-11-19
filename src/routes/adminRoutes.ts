import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as admin from '../controllers/adminController';

const router = Router();
router.use(authenticate, requireRole('SUPERADMIN'));

router.get('/users', admin.listUsers);
router.post('/users', admin.createUser);
router.post('/sellers', admin.createUser); // kompatibilitas mundur
router.get('/users/:id', admin.getUserDetail);
router.put('/users/:id', admin.updateUser);
router.patch('/users/:id/status', admin.updateUserStatus);
router.delete('/users/:id', admin.deleteUser);
router.get('/audit-logs', admin.listAuditLogs);

export default router;
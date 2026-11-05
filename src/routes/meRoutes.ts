// meRoutes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { changePassword, getMe, updateMe } from '../controllers/userController';

const router = Router();
router.use(authenticate);
router.get('/', getMe);
router.put('/', updateMe);
router.put('/password', changePassword);
export default router;
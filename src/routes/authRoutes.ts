// authRoutes.ts
import { Router } from 'express';
import * as c from '../controllers/authController';

const router = Router();
router.post('/register', c.register);
router.post('/login', c.login);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);
router.post('/forgot-password', c.forgotPassword);
router.post('/verify-otp', c.verifyOtp);
router.post('/reset-password', c.resetPassword);
export default router;
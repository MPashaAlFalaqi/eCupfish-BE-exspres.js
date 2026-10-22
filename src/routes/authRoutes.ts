import { Router } from 'express';
import { register, login, getProfile, requestPasswordReset, resetPassword } from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// rute login dan register
router.post('/register', register);
router.post('/login', login);

// rute untuk mendapatkan profil pengguna
router.get('/profile', authenticateToken, getProfile);
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);

export default router;
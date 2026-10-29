import { Router } from 'express';
import { register, login, getProfile, requestPasswordReset, resetPassword } from '../controllers/authController';
import { authenticateToken, isSuperAdmin, isAdmin } from '../middleware/authMiddleware';

const router = Router();

// Rute Publik (Tidak butuh token)
router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);

// Rute Terlindungi (Butuh token, berlaku untuk semua jenis akun)
router.get('/profile', authenticateToken, getProfile);

export default router;
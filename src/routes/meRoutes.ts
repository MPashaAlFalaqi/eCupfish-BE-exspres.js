import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as c from '../controllers/userController';

const router = Router();
router.use(authenticate);

// Route profil akun (/api/me)
router.get('/', c.getMe);
router.put('/', c.updateMe);
router.put('/password', c.changePassword);

// Route alamat pengguna (/api/me/addresses)
router.get('/addresses', c.listAddresses);
router.post('/addresses', c.addAddress);
router.delete('/addresses/:id', c.deleteAddress);

export default router;
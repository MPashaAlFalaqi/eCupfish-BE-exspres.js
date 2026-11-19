import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { uploadProduk } from '../middleware/upload';
import * as c from '../controllers/sellerProductController';
import { classifyBettaImage } from '../controllers/aiClassifyController';
import * as settings from '../controllers/sellerSettingsController';

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

router.get('/settings', settings.getSellerSettings);
router.put('/settings', settings.updateSellerProfile);
router.post('/bank-accounts', settings.addBankAccount);
router.delete('/bank-accounts/:id', settings.deleteBankAccount);
router.post('/products/ai-classify', uploadProduk.single('image'), classifyBettaImage);
router.get('/products', c.listMine);
router.post('/products', c.createProduct);
router.get('/products/:id', c.getMine);
router.put('/products/:id', c.updateProduct);
router.delete('/products/:id', c.deleteProduct);
router.patch('/products/:id/availability', c.setAvailability);
router.get('/products/:id/stock-logs', c.listStockLogs);
router.post('/products/:id/media', uploadProduk.array('files', 6), c.uploadMedia);

router.delete('/media/:mediaId', c.deleteMedia);
router.patch('/media/:mediaId/cover', c.setCover);

export default router;
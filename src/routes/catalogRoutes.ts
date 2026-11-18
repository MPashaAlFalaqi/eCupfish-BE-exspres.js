import { Router } from 'express';
import { getProduct, listCategories, listProducts } from '../controllers/productController';

const router = Router();
router.get('/categories', listCategories);
router.get('/products', listProducts);
router.get('/products/:id', getProduct);
export default router;
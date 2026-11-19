import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { uploadProduk } from '../middleware/upload';
import * as auction from '../controllers/auctionController';
import * as chat from '../controllers/chatController';
import * as claim from '../controllers/claimController';
import * as review from '../controllers/reviewController';

const router = Router();

// Lelang Publik & Terautentikasi
router.get('/auctions', auction.listAuctions);
router.get('/auctions/:id', auction.getAuction);
router.post('/seller/auctions', authenticate, requireRole('ADMIN'), auction.createAuction);
router.patch('/seller/auctions/:id/cancel', authenticate, requireRole('ADMIN'), auction.cancelAuction);
router.post('/auctions/:id/bids', authenticate, requireRole('BUYER'), auction.placeBid);

// Chat Real-Time (Buyer & Seller)
router.get('/conversations', authenticate, chat.listConversations);
router.post('/conversations', authenticate, requireRole('BUYER'), chat.startOrGetConversation);
router.get('/conversations/:id/messages', authenticate, chat.getMessages);
router.post('/conversations/:id/messages', authenticate, chat.sendMessage);

// Klaim Garansi Video Unboxing
router.post(
  '/claims',
  authenticate,
  requireRole('BUYER'),
  uploadProduk.single('video'),
  claim.createClaim
);
router.get('/seller/claims', authenticate, requireRole('ADMIN'), claim.listSellerClaims);
router.get('/claims/:id', authenticate, claim.getClaimDetail);
router.patch('/seller/claims/:id', authenticate, requireRole('ADMIN'), claim.resolveClaim);

// Ulasan & Rating
router.post('/reviews', authenticate, requireRole('BUYER'), review.createReview);
router.get('/seller/reviews', authenticate, requireRole('ADMIN'), review.listSellerReviews);
router.patch('/seller/reviews/:id/reply', authenticate, requireRole('ADMIN'), review.replyReview);

export default router;
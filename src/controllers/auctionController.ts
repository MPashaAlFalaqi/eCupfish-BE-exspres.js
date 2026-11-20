import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { getIO } from '../realtime/socket';

export const listAuctions = async (req: Request, res: Response) => {
  const sellerOnly = req.query.mine === 'true' && req.user;
  const rows = await prisma.auction.findMany({
    where: sellerOnly
      ? { sellerId: req.user!.id }
      : { status: { in: ['LIVE', 'SCHEDULED', 'ENDED'] } },
    orderBy: [{ status: 'asc' }, { endsAt: 'asc' }],
    include: {
      product: { include: { category: true, media: true } },
      seller: { select: { sellerProfile: { select: { businessName: true } } } },
      winner: { select: { id: true, name: true } },
      bids: {
        orderBy: { amount: 'desc' },
        take: 15,
        include: { bidder: { select: { id: true, name: true } } },
      },
    },
  });
  res.json({ data: rows });
};

export const getAuction = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const row = await prisma.auction.findUnique({
    where: { id },
    include: {
      product: { include: { category: true, media: true } },
      seller: { select: { sellerProfile: { select: { businessName: true } } } },
      winner: { select: { id: true, name: true } },
      bids: {
        orderBy: { amount: 'desc' },
        take: 30,
        include: { bidder: { select: { id: true, name: true } } },
      },
    },
  });
  if (!row) throw new AppError(404, 'Sesi lelang tidak ditemukan.');
  res.json({ data: row });
};

export const createAuction = async (req: Request, res: Response) => {
  const b = z
    .object({
      productId: z.number().int().positive(),
      quantity: z.number().int().positive().default(1),
      startPrice: z.number().int().min(1000),
      bidIncrement: z.number().int().min(1000),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      publishNow: z.boolean().default(true),
    })
    .parse(req.body);

  const product = await prisma.product.findFirst({
    where: { id: b.productId, sellerId: req.user!.id, deletedAt: null },
  });
  if (!product) throw new AppError(404, 'Produk tidak ditemukan.');
  if (product.stock < b.quantity) {
    throw new AppError(400, 'Stok produk tidak mencukupi untuk lelang.');
  }

  const start = new Date(b.startsAt);
  const end = new Date(b.endsAt);
  if (end <= start) {
    throw new AppError(400, 'Waktu selesai lelang harus setelah waktu mulai.');
  }

  const status = !b.publishNow
    ? 'DRAFT'
    : start <= new Date()
      ? 'LIVE'
      : 'SCHEDULED';

  const auction = await prisma.auction.create({
    data: {
      auctionCode: `LL-${Date.now().toString().slice(-5)}`,
      sellerId: req.user!.id,
      productId: product.id,
      quantity: b.quantity,
      startPrice: b.startPrice,
      bidIncrement: b.bidIncrement,
      currentPrice: b.startPrice,
      status,
      startsAt: start,
      endsAt: end,
    },
  });

  res.status(201).json({ data: auction });
};

export const placeBid = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { amount } = z.object({ amount: z.number().int().positive() }).parse(req.body);

  const result = await prisma.$transaction(async (tx) => {
    const auction = await tx.auction.findUnique({ where: { id } });
    if (!auction) throw new AppError(404, 'Sesi lelang tidak ditemukan.');
    if (auction.status !== 'LIVE') {
      throw new AppError(400, 'Sesi lelang belum dimulai atau sudah berakhir.');
    }
    if (auction.sellerId === req.user!.id) {
      throw new AppError(403, 'Penjual tidak dapat menawar lelang miliknya sendiri.');
    }

    const now = new Date();
    if (now >= auction.endsAt) {
      throw new AppError(400, 'Waktu lelang telah habis.');
    }

    const minBid =
      auction.winnerId === null
        ? auction.startPrice
        : auction.currentPrice + auction.bidIncrement;

    if (amount < minBid) {
      throw new AppError(
        400,
        `Penawaran minimal Rp ${minBid.toLocaleString('id-ID')}.`
      );
    }

    // Anti-sniping: perpanjang 60 detik bila bid masuk di 60 detik terakhir
    const sisaMs = auction.endsAt.getTime() - now.getTime();
    const nextEndsAt =
      sisaMs <= 60_000 ? new Date(auction.endsAt.getTime() + 60_000) : auction.endsAt;

    const bid = await tx.auctionBid.create({
      data: {
        auctionId: auction.id,
        bidderId: req.user!.id,
        amount,
      },
      include: { bidder: { select: { id: true, name: true } } },
    });

    const updated = await tx.auction.update({
      where: { id: auction.id },
      data: {
        currentPrice: amount,
        winnerId: req.user!.id,
        endsAt: nextEndsAt,
      },
    });

    return { updated, bid };
  });

  getIO()?.to(`auction:${id}`).emit('auction:bid', {
    auctionId: id,
    currentPrice: result.updated.currentPrice,
    endsAt: result.updated.endsAt,
    bid: result.bid,
  });
  getIO()?.emit('auction:bid', {
    auctionId: id,
    currentPrice: result.updated.currentPrice,
    endsAt: result.updated.endsAt,
    bid: result.bid,
  });

  res.status(201).json({ data: result });
};

export const cancelAuction = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const auction = await prisma.auction.findFirst({
    where: { id, sellerId: req.user!.id },
  });
  if (!auction) throw new AppError(404, 'Sesi lelang tidak ditemukan.');
  if (auction.winnerId !== null) {
    throw new AppError(400, 'Lelang yang sudah memiliki penawar tidak dapat dibatalkan.');
  }

  const updated = await prisma.auction.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });
  res.json({ data: updated });
};
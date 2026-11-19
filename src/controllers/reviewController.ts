import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';

export const createReview = async (req: Request, res: Response) => {
  const b = z
    .object({
      orderId: z.number().int().positive(),
      productId: z.number().int().positive(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().min(3),
      tags: z.array(z.string()).optional(),
    })
    .parse(req.body);

  const order = await prisma.order.findFirst({
    where: { id: b.orderId, buyerId: req.user!.id, status: 'COMPLETED' },
    include: { items: true },
  });
  if (!order) {
    throw new AppError(400, 'Ulasan hanya bisa dikirim setelah pesanan selesai.');
  }
  if (!order.items.some((i) => i.productId === b.productId)) {
    throw new AppError(400, 'Produk tidak ditemukan di dalam pesanan ini.');
  }

  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        orderId: order.id,
        productId: b.productId,
        buyerId: req.user!.id,
        sellerId: order.sellerId,
        rating: b.rating,
        comment: b.comment,
        tags: b.tags ?? [],
      },
    });

    const agg = await tx.review.aggregate({
      where: { productId: b.productId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await tx.product.update({
      where: { id: b.productId },
      data: {
        ratingAvg: Number((agg._avg.rating ?? b.rating).toFixed(2)),
        reviewCount: agg._count.rating,
      },
    });

    return created;
  });

  res.status(201).json({ data: review });
};

export const listSellerReviews = async (req: Request, res: Response) => {
  const rows = await prisma.review.findMany({
    where: { sellerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: {
      buyer: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
    },
  });
  res.json({ data: rows });
};

export const replyReview = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { sellerReply } = z.object({ sellerReply: z.string().trim().min(2) }).parse(req.body);

  const review = await prisma.review.findFirst({
    where: { id, sellerId: req.user!.id },
  });
  if (!review) throw new AppError(404, 'Ulasan tidak ditemukan.');

  const updated = await prisma.review.update({
    where: { id },
    data: { sellerReply, repliedAt: new Date() },
  });
  res.json({ data: updated });
};
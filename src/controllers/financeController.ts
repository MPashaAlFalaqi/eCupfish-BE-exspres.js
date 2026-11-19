import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';

export const getSellerPayouts = async (req: Request, res: Response) => {
  const sellerId = req.user!.id;

  const [payouts, bankAccounts] = await Promise.all([
    prisma.sellerPayout.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            orderCode: true,
            paymentMethod: true,
            source: true,
            buyer: { select: { name: true } },
          },
        },
      },
    }),
    prisma.bankAccount.findMany({
      where: { sellerId },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    }),
  ]);

  const summary = payouts.reduce(
    (acc, p) => {
      if (p.status === 'RELEASED') acc.released += p.netAmount;
      if (p.status === 'IN_ESCROW') acc.inEscrow += p.netAmount;
      acc.platformFee += p.platformFee;
      acc.gatewayFee += p.gatewayFee;
      return acc;
    },
    { released: 0, inEscrow: 0, platformFee: 0, gatewayFee: 0 }
  );

  res.json({ data: payouts, summary, bankAccounts });
};

export const withdrawPayouts = async (req: Request, res: Response) => {
  const sellerId = req.user!.id;
  const primaryBank = await prisma.bankAccount.findFirst({
    where: { sellerId },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
  });
  if (!primaryBank) {
    throw new AppError(400, 'Tambahkan rekening bank tujuan pencairan terlebih dahulu.');
  }

  const releasable = await prisma.sellerPayout.findMany({
    where: { sellerId, status: 'RELEASED', paidOutAt: null },
  });
  if (releasable.length === 0) {
    throw new AppError(400, 'Belum ada dana tersedia untuk ditarik.');
  }

  const totalDisbursed = releasable.reduce((n, p) => n + p.netAmount, 0);
  await prisma.sellerPayout.updateMany({
    where: { id: { in: releasable.map((r) => r.id) } },
    data: { paidOutAt: new Date() },
  });

  res.json({
    message: `Pencairan Rp ${totalDisbursed.toLocaleString('id-ID')} diproses ke ${primaryBank.bankName} (${primaryBank.accountNumber}).`,
    totalDisbursed,
  });
};

export const getSellerReport = async (req: Request, res: Response) => {
  const sellerId = req.user!.id;
  const { from, to } = z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .parse(req.query);

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (from) createdAtFilter.gte = new Date(from);
  if (to) createdAtFilter.lte = new Date(`${to}T23:59:59.999Z`);

  const orders = await prisma.order.findMany({
    where: {
      sellerId,
      status: { in: ['PAID', 'PACKING', 'SHIPPED', 'COMPLETED'] },
      ...(from || to ? { createdAt: createdAtFilter } : {}),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      items: {
        include: {
          product: { select: { category: { select: { name: true } } } },
        },
      },
      payout: true,
    },
  });

  const grossRevenue = orders.reduce((n, o) => n + o.subtotal, 0);
  const netRevenue = orders.reduce(
    (n, o) => n + (o.payout?.netAmount ?? o.subtotal),
    0
  );
  const totalOrders = orders.length;
  const totalFishSold = orders.reduce(
    (n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0),
    0
  );

  // Rincian per sumber (Beli Langsung vs Lelang)
  const bySource = {
    DIRECT: orders
      .filter((o) => o.source === 'DIRECT')
      .reduce((n, o) => n + o.subtotal, 0),
    AUCTION: orders
      .filter((o) => o.source === 'AUCTION')
      .reduce((n, o) => n + o.subtotal, 0),
  };

  // Rincian per kategori ikan
  const byCategoryMap: Record<string, number> = {};
  for (const o of orders) {
    for (const item of o.items) {
      const cat = item.product.category.name;
      byCategoryMap[cat] = (byCategoryMap[cat] ?? 0) + item.subtotal;
    }
  }

  res.json({
    data: {
      grossRevenue,
      netRevenue,
      totalOrders,
      totalFishSold,
      bySource,
      byCategory: Object.entries(byCategoryMap).sort((a, b) => b[1] - a[1]),
      orders,
    },
  });
};
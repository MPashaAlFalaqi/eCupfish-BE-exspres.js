import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';

export const createClaim = async (req: Request, res: Response) => {
  const b = z
    .object({
      orderId: z.coerce.number().int().positive(),
      affectedQty: z.coerce.number().int().positive().default(1),
      reason: z.string().trim().min(3),
    })
    .parse(req.body);

  const file = req.file;
  if (!file) {
    throw new AppError(400, 'Video unboxing tanpa jeda wajib diunggah.');
  }

  const order = await prisma.order.findFirst({
    where: { id: b.orderId, buyerId: req.user!.id },
    include: { items: true },
  });
  if (!order) throw new AppError(404, 'Pesanan tidak ditemukan.');
  if (!['SHIPPED', 'COMPLETED'].includes(order.status)) {
    throw new AppError(400, 'Klaim hanya dapat diajukan setelah pesanan dikirim.');
  }

  const unitPrice = order.items[0]?.unitPrice ?? order.subtotal;
  const claimValue = Math.min(order.subtotal, unitPrice * b.affectedQty);

  const claim = await prisma.$transaction(async (tx) => {
    const created = await tx.warrantyClaim.create({
      data: {
        claimCode: `KL-${Date.now().toString().slice(-5)}`,
        orderId: order.id,
        buyerId: req.user!.id,
        sellerId: order.sellerId,
        affectedQty: b.affectedQty,
        reason: b.reason,
        videoUrl: `/uploads/products/${file.filename}`,
        claimValue,
        deadlineAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    await tx.notification.create({
    data: {
      userId: order.sellerId,
      category: 'CLAIM',
      title: `Klaim Garansi Baru (${created.claimCode})`,
      body: `Alasan: ${b.reason}. Tanggapi dalam 24 jam.`,
      href: `/klaim/${created.id}`,
    },
  });

  return created;
});
  res.status(201).json({ data: claim });
};

export const listSellerClaims = async (req: Request, res: Response) => {
  const rows = await prisma.warrantyClaim.findMany({
    where: { sellerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: {
      buyer: { select: { id: true, name: true } },
      order: {
        select: {
          orderCode: true,
          items: { select: { productName: true, quantity: true } },
        },
      },
    },
  });
  res.json({ data: rows });
};

export const getClaimDetail = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const claim = await prisma.warrantyClaim.findFirst({
    where: {
      id,
      OR: [{ sellerId: req.user!.id }, { buyerId: req.user!.id }],
    },
    include: {
      buyer: { select: { id: true, name: true, phoneNumber: true } },
      order: { include: { items: true, shipment: true } },
    },
  });
  if (!claim) throw new AppError(404, 'Data klaim tidak ditemukan.');
  res.json({ data: claim });
};

export const resolveClaim = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const b = z
    .object({
      status: z.enum(['APPROVED', 'REJECTED']),
      resolutionType: z.enum(['REFUND_FULL', 'REFUND_PARTIAL', 'REPLACE_FISH']).optional(),
      approvedAmount: z.number().int().min(0).optional(),
      sellerNote: z.string().trim().optional(),
    })
    .parse(req.body);

  const claim = await prisma.warrantyClaim.findFirst({
    where: { id, sellerId: req.user!.id },
  });
  if (!claim) throw new AppError(404, 'Klaim tidak ditemukan.');
  if (claim.status !== 'PENDING') {
    throw new AppError(400, 'Klaim ini sudah ditinjau sebelumnya.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const resolved = await tx.warrantyClaim.update({
      where: { id },
      data: {
        status: b.status,
        resolutionType: b.status === 'APPROVED' ? b.resolutionType ?? 'REFUND_FULL' : null,
        approvedAmount:
          b.status === 'APPROVED' ? b.approvedAmount ?? claim.claimValue : 0,
        sellerNote: b.sellerNote,
      },
    });

    if (b.status === 'APPROVED' && b.resolutionType !== 'REPLACE_FISH') {
      await tx.sellerPayout.updateMany({
        where: { orderId: claim.orderId },
        data: { status: 'REFUNDED' },
      });
    }

    await tx.notification.create({
    data: {
        userId: claim.buyerId,
        category: 'CLAIM',
        title: `Klaim ${claim.claimCode} ${b.status === 'APPROVED' ? 'Disetujui' : 'Ditolak'}`,
        body: b.sellerNote ?? 'Penjual telah meninjau video unboxing Anda.',
        href: '/pesanan',
    },
    });

    return resolved;
  });

  res.json({ data: updated });
};
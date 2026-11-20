import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { resolveStatus } from '../utils/product';
import { getIO } from '../realtime/socket';

export const checkoutDirect = async (req: Request, res: Response) => {
  const body = z
    .object({
      recipientName: z.string().trim().min(2),
      recipientPhone: z.string().trim().min(8),
      shippingAddress: z.string().trim().min(5),
      paymentMethod: z.string().trim().min(2),
      shippingCost: z.number().int().min(0).default(35000),
      guaranteeFee: z.number().int().min(0).default(15000),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            quantity: z.number().int().positive(),
          })
        )
        .min(1),
    })
    .parse(req.body);

  const order = await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: {
        id: { in: body.items.map((i) => i.productId) },
        deletedAt: null,
        listed: true,
      },
    });

    if (products.length !== body.items.length) {
      throw new AppError(400, 'Sebagian produk tidak lagi tersedia.');
    }

    const sellerId = products[0].sellerId;
    if (products.some((p) => p.sellerId !== sellerId)) {
      throw new AppError(400, 'Checkout satu transaksi hanya untuk satu toko pembudidaya.');
    }

    let subtotal = 0;
    const orderItemsData: {
      productId: number;
      productName: string;
      gradeLabel: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }[] = [];

    for (const reqItem of body.items) {
      const p = products.find((x) => x.id === reqItem.productId)!;
      const maxBeli = p.strictThreshold
        ? Math.max(0, p.stock - p.lowStockThreshold)
        : p.stock;

      if (p.status === 'INACTIVE' || reqItem.quantity > maxBeli) {
        throw new AppError(
          400,
          `Stok "${p.name}" tidak mencukupi (tersedia ${maxBeli} ekor).`
        );
      }

      const newStock = p.stock - reqItem.quantity;
      const newStatus = resolveStatus(
        newStock,
        p.autoStatus,
        p.status,
        p.lowStockThreshold,
        p.strictThreshold
      );

      await tx.product.update({
        where: { id: p.id },
        data: { stock: newStock, status: newStatus },
      });

      await tx.stockLog.create({
        data: {
          productId: p.id,
          type: 'AUTO',
          oldStatus: p.status,
          newStatus,
          oldStock: p.stock,
          newStock,
          reason: 'Pengurangan otomatis dari pesanan pembeli',
          byUserId: req.user!.id,
        },
      });

      const lineTotal = p.price * reqItem.quantity;
      subtotal += lineTotal;
      orderItemsData.push({
        productId: p.id,
        productName: p.name,
        gradeLabel: `${p.grade}${p.tier ? ` (${p.tier})` : ''}`,
        quantity: reqItem.quantity,
        unitPrice: p.price,
        subtotal: lineTotal,
      });
    }

    const orderCode = `PS-${Date.now().toString().slice(-6)}`;
    const grandTotal = subtotal + body.shippingCost + body.guaranteeFee;

    const created = await tx.order.create({
      data: {
        orderCode,
        buyerId: req.user!.id,
        sellerId,
        source: 'DIRECT',
        status: 'PENDING_PAYMENT',
        recipientName: body.recipientName,
        recipientPhone: body.recipientPhone,
        shippingAddress: body.shippingAddress,
        subtotal,
        shippingCost: body.shippingCost,
        guaranteeFee: body.guaranteeFee,
        grandTotal,
        paymentMethod: body.paymentMethod,
        paymentDueAt: new Date(Date.now() + 24 * 3600 * 1000),
        items: { create: orderItemsData },
      },
      include: { items: true },
    });

    await tx.cartItem.deleteMany({
      where: {
        buyerId: req.user!.id,
        productId: { in: body.items.map((i) => i.productId) },
      },
    });

    return created;
  });

  try {
    getIO()?.emit('order:new', {
      orderCode: order.orderCode,
      recipientName: order.recipientName,
      shippingAddress: order.shippingAddress,
      items: order.items.map((it: any) => ({
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
      })),
      grandTotal: order.grandTotal,
      shippingCost: order.shippingCost,
      source: 'DIRECT',
      createdAt: order.createdAt,
    });
  } catch {}

  res.status(201).json({ data: order });
};

// POST /api/orders/:id/pay (BUYER)
export const payOrder = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);

  const existing = await prisma.order.findFirst({
    where: { id, buyerId: req.user!.id },
  });
  if (!existing) throw new AppError(404, 'Pesanan tidak ditemukan.');
  if (existing.status !== 'PENDING_PAYMENT') {
    throw new AppError(400, 'Status pesanan tidak valid untuk pembayaran.');
  }

  const platformFee = Math.round(existing.subtotal * 0.05);
  const gatewayFee = 2500;
  const netAmount = Math.max(0, existing.subtotal - platformFee - gatewayFee);

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id },
      data: { status: 'PAID', paidAt: new Date() },
      include: { items: true },
    });

    await tx.sellerPayout.upsert({
      where: { orderId: id },
      update: {},
      create: {
        sellerId: existing.sellerId,
        orderId: id,
        grossAmount: existing.subtotal,
        platformFee,
        gatewayFee,
        netAmount,
        status: 'IN_ESCROW',
      },
    });

    await tx.notification.create({
      data: {
        userId: existing.sellerId,
        category: 'ORDER',
        title: `Pesanan Baru Dibayar (${existing.orderCode})`,
        body: `Pembayaran sebesar Rp ${existing.grandTotal.toLocaleString('id-ID')} telah diterima. Segera kemas pesanan.`,
        href: '/pesanan',
      },
    });

    return order;
  });

  res.json({ data: updated });
};

// GET /api/orders (BUYER)
export const listBuyerOrders = async (req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { buyerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: {
      items: true,
      seller: { select: { id: true, name: true, sellerProfile: true } },
    },
  });

  res.json({ data: orders });
};

// GET /api/orders/:id (BUYER)
export const getBuyerOrderDetail = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const order = await prisma.order.findFirst({
    where: { id, buyerId: req.user!.id },
    include: {
      items: true,
      seller: { select: { id: true, name: true, sellerProfile: true } },
    },
  });
  if (!order) throw new AppError(404, 'Pesanan tidak ditemukan.');

  res.json({ data: order });
};

// POST /api/orders/:id/confirm-delivery (BUYER)
export const confirmDelivery = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);

  const existing = await prisma.order.findFirst({
    where: { id, buyerId: req.user!.id },
  });
  if (!existing) throw new AppError(404, 'Pesanan tidak ditemukan.');
  if (existing.status !== 'SHIPPED') {
    throw new AppError(400, 'Pesanan belum berstatus dikirim.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
      include: { items: true },
    });

    await tx.sellerPayout.updateMany({
      where: { orderId: id, status: 'IN_ESCROW' },
      data: { status: 'RELEASED' },
    });

    await tx.notification.create({
      data: {
        userId: existing.sellerId,
        category: 'ORDER',
        title: `Pesanan Selesai (${existing.orderCode})`,
        body: 'Pembeli telah mengonfirmasi paket tiba. Dana escrow siap dicairkan.',
        href: '/keuangan',
      },
    });

    return order;
  });

  res.json({ data: updated });
};

// GET /api/seller/orders (ADMIN)
export const listSellerOrders = async (req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { sellerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: {
      items: true,
      buyer: { select: { id: true, name: true, phoneNumber: true } },
    },
  });

  res.json({ data: orders });
};

// PATCH /api/seller/orders/:id/status (ADMIN)
export const updateSellerOrderStatus = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { status } = z
    .object({
      status: z.enum(['PACKING', 'CANCELLED']),
    })
    .parse(req.body);

  const existing = await prisma.order.findFirst({
    where: { id, sellerId: req.user!.id },
    include: { items: true },
  });
  if (!existing) throw new AppError(404, 'Pesanan tidak ditemukan.');

  const updated = await prisma.$transaction(async (tx) => {
    if (status === 'CANCELLED' && existing.status !== 'CANCELLED') {
      for (const item of existing.items) {
        const prod = await tx.product.findUnique({ where: { id: item.productId } });
        if (prod) {
          const restoredStock = prod.stock + item.quantity;
          const restoredStatus = resolveStatus(
            restoredStock,
            prod.autoStatus,
            prod.status,
            prod.lowStockThreshold,
            prod.strictThreshold
          );

          await tx.product.update({
            where: { id: prod.id },
            data: { stock: restoredStock, status: restoredStatus },
          });

          await tx.stockLog.create({
            data: {
              productId: prod.id,
              type: 'AUTO',
              oldStatus: prod.status,
              newStatus: restoredStatus,
              oldStock: prod.stock,
              newStock: restoredStock,
              reason: `Pengembalian stok otomatis karena pesanan ${existing.orderCode} dibatalkan`,
              byUserId: req.user!.id,
            },
          });
        }
      }

      await tx.sellerPayout.updateMany({
        where: { orderId: id },
        data: { status: 'REFUNDED' },
      });
    }

    const order = await tx.order.update({
      where: { id },
      data: { status },
      include: { items: true },
    });

    await tx.notification.create({
      data: {
        userId: existing.buyerId,
        category: 'ORDER',
        title:
          status === 'PACKING'
            ? `Pesanan Dikemas (${existing.orderCode})`
            : `Pesanan Dibatalkan (${existing.orderCode})`,
        body:
          status === 'PACKING'
            ? 'Penjual sedang mempersiapkan dan mengemas ikan pesanan Anda.'
            : 'Pesanan Anda telah dibatalkan oleh penjual.',
        href: '/pesanan',
      },
    });

    return order;
  });

  res.json({ data: updated });
};

// POST /api/seller/orders/:id/ship (ADMIN)
export const shipOrder = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { courier, trackingNumber } = z
    .object({
      courier: z.string().trim().min(2),
      trackingNumber: z.string().trim().min(3),
    })
    .parse(req.body);

  const existing = await prisma.order.findFirst({
    where: { id, sellerId: req.user!.id },
  });
  if (!existing) throw new AppError(404, 'Pesanan tidak ditemukan.');

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id },
      data: {
        status: 'SHIPPED',
        courier,
        trackingNumber,
        shippedAt: new Date(),
      },
      include: { items: true },
    });

    await tx.notification.create({
      data: {
        userId: existing.buyerId,
        category: 'ORDER',
        title: `Pesanan Dikirim (${existing.orderCode})`,
        body: `Paket dikirim melalui ${courier} dengan nomor resi ${trackingNumber}.`,
        href: '/pesanan',
      },
    });

    return order;
  });

  res.json({ data: updated });
};
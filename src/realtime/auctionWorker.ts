import prisma from '../config/prisma';
import { resolveStatus } from '../utils/product';
import { getIO } from './socket';

export function startAuctionWorker() {
  setInterval(async () => {
    const now = new Date();
    const io = getIO();

    try {
      // 1. Aktifkan sesi SCHEDULED yang waktunya sudah tiba
      const toStart = await prisma.auction.findMany({
        where: { status: 'SCHEDULED', startsAt: { lte: now }, endsAt: { gt: now } },
      });

      for (const a of toStart) {
        await prisma.auction.update({
          where: { id: a.id },
          data: { status: 'LIVE' },
        });
        io?.to(`auction:${a.id}`).emit('auction:started', { auctionId: a.id });
      }

      // 2. Tutup sesi LIVE yang waktu berakhirnya sudah lewat
      const expired = await prisma.auction.findMany({
        where: { status: 'LIVE', endsAt: { lte: now } },
        include: {
          product: true,
          winner: { include: { addresses: { where: { isDefault: true }, take: 1 } } },
        },
      });

      for (const a of expired) {
        await prisma.$transaction(async (tx) => {
          // Pastikan belum diproses oleh siklus sebelumnya
          const fresh = await tx.auction.findUnique({ where: { id: a.id } });
          if (!fresh || fresh.status !== 'LIVE') return;

          if (!a.winnerId || !a.winner) {
            await tx.auction.update({
              where: { id: a.id },
              data: { status: 'ENDED' },
            });
            return;
          }

          const alamat = a.winner.addresses[0];
          const shippingCost = 35000;
          const guaranteeFee = 15000;
          const grandTotal = a.currentPrice + shippingCost + guaranteeFee;
          const due = new Date(Date.now() + 24 * 3600 * 1000);

          const order = await tx.order.create({
            data: {
              orderCode: `LL-${Date.now().toString().slice(-6)}`,
              buyerId: a.winnerId,
              sellerId: a.sellerId,
              source: 'AUCTION',
              status: 'PENDING_PAYMENT',
              recipientName: alamat?.recipientName ?? a.winner.name,
              recipientPhone: alamat?.phoneNumber ?? a.winner.phoneNumber ?? '-',
              shippingAddress: alamat
                ? `${alamat.fullAddress}, ${alamat.city}, ${alamat.province} ${alamat.postalCode}`
                : 'Alamat belum diatur pembeli',
              subtotal: a.currentPrice,
              shippingCost,
              guaranteeFee,
              grandTotal,
              paymentDueAt: due,
              items: {
                create: {
                  productId: a.productId,
                  productName: a.product.name,
                  gradeLabel: `${a.product.grade}${a.product.tier ? ` (${a.product.tier})` : ''}`,
                  quantity: a.quantity,
                  unitPrice: Math.round(a.currentPrice / a.quantity),
                  subtotal: a.currentPrice,
                },
              },
            },
          });

          // Kurangi stok produk yang dimenangkan
          const newStock = Math.max(0, a.product.stock - a.quantity);
          const nextSt = resolveStatus(
            newStock,
            a.product.autoStatus,
            a.product.status,
            a.product.lowStockThreshold,
            a.product.strictThreshold
          );

          await tx.product.update({
            where: { id: a.productId },
            data: { stock: newStock, status: nextSt },
          });

          await tx.auction.update({
            where: { id: a.id },
            data: {
              status: 'ENDED',
              paymentDeadline: due,
              orderId: order.id,
            },
          });

          await tx.notification.createMany({
            data: [
              {
                userId: a.winnerId,
                category: 'AUCTION',
                title: `Selamat! Anda Memenangkan Lelang ${a.product.name}`,
                body: `Segera selesaikan pembayaran Rp ${grandTotal.toLocaleString('id-ID')} dalam 24 jam.`,
                href: '/pesanan',
              },
              {
                userId: a.sellerId,
                category: 'AUCTION',
                title: `Sesi Lelang ${a.auctionCode} Selesai`,
                body: `Dimenangkan oleh ${a.winner.name} seharga Rp ${a.currentPrice.toLocaleString('id-ID')}.`,
                href: '/lelang/sesi',
              },
            ],
          });
        });

        io?.to(`auction:${a.id}`).emit('auction:ended', {
          auctionId: a.id,
          winnerId: a.winnerId,
          finalPrice: a.currentPrice,
        });
      }
    } catch (err) {
      console.error('[AuctionWorker Error]', err);
    }
  }, 5000);
}
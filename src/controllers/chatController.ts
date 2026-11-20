import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { getIO } from '../realtime/socket';

export const listConversations = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const rows = await prisma.conversation.findMany({
    where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      buyer: { select: { id: true, name: true, photoUrl: true } },
      seller: {
        select: {
          id: true,
          name: true,
          sellerProfile: { select: { businessName: true } },
        },
      },
      product: { select: { id: true, name: true, price: true } },
      _count: {
        select: {
          messages: { where: { senderId: { not: userId }, readAt: null } },
        },
      },
    },
  });

  res.json({
    data: rows.map((c) => ({
      ...c,
      unreadCount: c._count.messages,
    })),
  });
};

export const startOrGetConversation = async (req: Request, res: Response) => {
  const b = z
    .object({
      sellerId: z.number().int().positive(),
      productId: z.number().int().positive().optional(),
    })
    .parse(req.body);

  const conv = await prisma.conversation.upsert({
    where: { buyerId_sellerId: { buyerId: req.user!.id, sellerId: b.sellerId } },
    update: { ...(b.productId ? { productId: b.productId } : {}) },
    create: {
      buyerId: req.user!.id,
      sellerId: b.sellerId,
      productId: b.productId,
    },
  });
  res.json({ data: conv });
};

export const getMessages = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const userId = req.user!.id;

  const conv = await prisma.conversation.findFirst({
    where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
  });
  if (!conv) throw new AppError(404, 'Percakapan tidak ditemukan.');

  await prisma.message.updateMany({
    where: { conversationId: id, senderId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  res.json({ data: messages });
};

export const sendMessage = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
  const userId = req.user!.id;

  const conv = await prisma.conversation.findFirst({
    where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
  });
  if (!conv) throw new AppError(404, 'Percakapan tidak ditemukan.');

  const msg = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: id,
        senderId: userId,
        body,
      },
    });

    await tx.conversation.update({
      where: { id },
      data: { lastMessage: body, lastMessageAt: created.createdAt },
    });

    return created;
  });

  const recipientId = conv.buyerId === userId ? conv.sellerId : conv.buyerId;
  getIO()?.to(`chat:${id}`).emit('chat:message', msg);
  getIO()?.emit('chat:global', { conversationId: id, message: msg });
  getIO()?.to(`user:${recipientId}`).emit('chat:notify', {
    conversationId: id,
    message: msg,
  });

  res.status(201).json({ data: msg });
};

export interface SharedChatMessage {
  id: string | number;
  sender: 'BUYER' | 'SELLER';
  senderName: string;
  body: string;
  createdAt: string;
}

let syncChatMessages: SharedChatMessage[] = [];

export const getSyncMessages = async (_req: Request, res: Response) => {
  res.json({ data: syncChatMessages });
};

export const sendSyncMessage = async (req: Request, res: Response) => {
  const { sender, senderName, body } = req.body || {};
  if (!body || !body.toString().trim()) {
    return res.status(400).json({ message: 'Pesan tidak boleh kosong.' });
  }

  const cleanBody = body.toString().trim();
  const msg: SharedChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    sender: sender === 'SELLER' ? 'SELLER' : 'BUYER',
    senderName:
      senderName?.toString().trim() ||
      (sender === 'SELLER' ? 'Betta King Jakarta (Penjual)' : 'Pembeli'),
    body: cleanBody,
    createdAt: new Date().toISOString(),
  };

  syncChatMessages.push(msg);

  // Broadcast realtime via Socket.IO ke semua browser / device terhubung
  try {
    getIO()?.emit('chat:relay', msg);
    getIO()?.emit('chat:global', {
      conversationId: 1,
      message: {
        id: msg.id,
        conversationId: 1,
        senderId: msg.sender === 'SELLER' ? 1 : 100,
        body: msg.body,
        createdAt: msg.createdAt,
      },
    });
  } catch {}

  res.status(201).json({ data: msg });
};

export const resetSyncMessages = async (_req: Request, res: Response) => {
  syncChatMessages = [];
  try {
    getIO()?.emit('chat:reset');
  } catch {}
  res.json({ message: 'Riwayat percakapan berhasil dibersihkan.' });
};
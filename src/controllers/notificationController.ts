import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';

export const listNotifications = async (req: Request, res: Response) => {
  const rows = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const unreadCount = rows.filter((n) => !n.isRead).length;
  res.json({ data: rows, unreadCount });
};

export const markNotificationRead = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  await prisma.notification.updateMany({
    where: { id, userId: req.user!.id },
    data: { isRead: true },
  });
  res.json({ message: 'Notifikasi ditandai dibaca.' });
};

export const markAllNotificationsRead = async (req: Request, res: Response) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ message: 'Semua notifikasi ditandai dibaca.' });
};
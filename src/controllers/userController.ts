import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { normalizePhone } from '../utils/normalize';
import { passwordSchema, publicUser } from './authController';

export const getMe = async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { sellerProfile: true },
  });
  if (!user) throw new AppError(404, 'Pengguna tidak ditemukan.');
  res.json({ user: { ...publicUser(user), sellerProfile: user.sellerProfile } });
};

export const updateMe = async (req: Request, res: Response) => {
  const body = z
    .object({
      name: z.string().trim().min(2).optional(),
      username: z
        .string()
        .trim()
        .min(3)
        .max(30)
        .regex(/^[a-zA-Z0-9_.]+$/, 'Username hanya boleh huruf, angka, titik, dan garis bawah.')
        .optional(),
      phoneNumber: z.string().trim().min(8).max(20).optional(),
    })
    .parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...body,
      phoneNumber: body.phoneNumber ? normalizePhone(body.phoneNumber) : undefined,
    },
  });
  res.json({ user: publicUser(user) });
};

export const changePassword = async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = z
    .object({ currentPassword: z.string().min(1), newPassword: passwordSchema })
    .parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
    throw new AppError(400, 'Kata sandi saat ini salah.');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(newPassword, 10) },
  });
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  res.json({ message: 'Kata sandi berhasil diubah. Silakan masuk kembali.' });
};
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
      sellerProfile: z
        .object({
          businessName: z.string().trim().min(2).optional(),
          description: z.string().nullable().optional(),
          location: z.string().nullable().optional(),
          originAddress: z.string().nullable().optional(),
          city: z.string().nullable().optional(),
          postalCode: z.string().nullable().optional(),
          openTime: z.string().nullable().optional(),
          closeTime: z.string().nullable().optional(),
          notifyNewOrder: z.boolean().optional(),
          notifyClaim: z.boolean().optional(),
          notifyLowStock: z.boolean().optional(),
        })
        .optional(),
    })
    .parse(req.body);

  const { sellerProfile, ...userData } = body;

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...userData,
      phoneNumber: userData.phoneNumber ? normalizePhone(userData.phoneNumber) : undefined,
      ...(sellerProfile
        ? {
            sellerProfile: {
              upsert: {
                create: {
                  businessName: sellerProfile.businessName ?? 'Betta Farm',
                  description: sellerProfile.description,
                  location: sellerProfile.location,
                  originAddress: sellerProfile.originAddress,
                  city: sellerProfile.city,
                  postalCode: sellerProfile.postalCode,
                  openTime: sellerProfile.openTime,
                  closeTime: sellerProfile.closeTime,
                  notifyNewOrder: sellerProfile.notifyNewOrder ?? true,
                  notifyClaim: sellerProfile.notifyClaim ?? true,
                  notifyLowStock: sellerProfile.notifyLowStock ?? true,
                },
                update: sellerProfile,
              },
            },
          }
        : {}),
    },
    include: { sellerProfile: true },
  });

  res.json({ user: { ...publicUser(user), sellerProfile: user.sellerProfile } });
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

// Manajemen Alamat Pengguna (/api/me/addresses)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export const listAddresses = async (req: Request, res: Response) => {
  const addresses = await db.userAddress.findMany({
    where: { userId: req.user!.id },
    orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
  });
  res.json({ data: addresses });
};

export const addAddress = async (req: Request, res: Response) => {
  const body = z
    .object({
      label: z.string().trim().min(1).default('Rumah'),
      recipientName: z.string().trim().min(2),
      phoneNumber: z.string().trim().min(8).max(20),
      addressLine: z.string().trim().min(5),
      city: z.string().trim().min(2),
      province: z.string().trim().optional(),
      postalCode: z.string().trim().min(4).max(10),
      isDefault: z.boolean().optional(),
    })
    .parse(req.body);

  if (body.isDefault) {
    await db.userAddress.updateMany({
      where: { userId: req.user!.id },
      data: { isDefault: false },
    });
  }

  const created = await db.userAddress.create({
    data: {
      ...body,
      phoneNumber: normalizePhone(body.phoneNumber),
      userId: req.user!.id,
    },
  });

  res.status(201).json({ data: created });
};

export const deleteAddress = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);

  const existing = await db.userAddress.findFirst({
    where: { id, userId: req.user!.id },
  });
  if (!existing) throw new AppError(404, 'Alamat tidak ditemukan.');

  await db.userAddress.delete({ where: { id } });
  res.json({ message: 'Alamat berhasil dihapus.' });
};
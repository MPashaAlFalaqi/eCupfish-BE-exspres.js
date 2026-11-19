import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { normalizePhone } from '../utils/normalize';

export const getSellerSettings = async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      phoneNumber: true,
      sellerProfile: true,
      bankAccounts: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
    },
  });
  if (!user) throw new AppError(404, 'Akun penjual tidak ditemukan.');
  res.json({ data: user });
};

export const updateSellerProfile = async (req: Request, res: Response) => {
  const b = z
    .object({
      name: z.string().trim().min(2).optional(),
      phoneNumber: z.string().trim().min(8).max(20).optional(),
      businessName: z.string().trim().min(2).optional(),
      description: z.string().trim().optional(),
      location: z.string().trim().optional(),
      originAddress: z.string().trim().optional(),
      city: z.string().trim().optional(),
      postalCode: z.string().trim().optional(),
      openTime: z.string().trim().optional(),
      closeTime: z.string().trim().optional(),
      notifyNewOrder: z.boolean().optional(),
      notifyClaim: z.boolean().optional(),
      notifyLowStock: z.boolean().optional(),
    })
    .parse(req.body);

  const { name, phoneNumber, ...profileData } = b;

  const updated = await prisma.$transaction(async (tx) => {
    if (name || phoneNumber) {
      await tx.user.update({
        where: { id: req.user!.id },
        data: {
          ...(name ? { name } : {}),
          ...(phoneNumber ? { phoneNumber: normalizePhone(phoneNumber) } : {}),
        },
      });
    }

    return tx.sellerProfile.upsert({
      where: { userId: req.user!.id },
      update: profileData,
      create: {
        userId: req.user!.id,
        businessName: profileData.businessName ?? 'Toko Cupang Baru',
        ...profileData,
      },
    });
  });

  res.json({ data: updated, message: 'Pengaturan toko berhasil disimpan.' });
};

export const addBankAccount = async (req: Request, res: Response) => {
  const b = z
    .object({
      bankName: z.string().trim().min(2),
      accountNumber: z.string().trim().min(5).max(30),
      accountHolder: z.string().trim().min(2),
      isPrimary: z.boolean().optional(),
    })
    .parse(req.body);

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { _count: { select: { bankAccounts: true } } },
  });
  const count = user?._count.bankAccounts ?? 0;
  const makePrimary = b.isPrimary || count === 0;

  const account = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: req.user!.id },
      data: {
        bankAccounts: {
          ...(makePrimary
            ? { updateMany: { where: { isPrimary: true }, data: { isPrimary: false } } }
            : {}),
          create: {
            bankName: b.bankName,
            accountNumber: b.accountNumber,
            accountHolder: b.accountHolder,
            isPrimary: makePrimary,
            sortOrder: count,
          },
        },
      },
      select: { bankAccounts: { orderBy: { sortOrder: 'asc' }, take: 1 } },
    });

    const bankAccounts = updated.bankAccounts;
    return bankAccounts[bankAccounts.length - 1] ?? bankAccounts[0];
  });

  res.status(201).json({ data: account });
};

export const deleteBankAccount = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { bankAccounts: { where: { id }, select: { id: true } } },
  });
  if (!user?.bankAccounts.length) {
    throw new AppError(404, 'Rekening tidak ditemukan.');
  }
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { bankAccounts: { deleteMany: { id } } },
  });
  res.json({ message: 'Rekening dihapus.' });
};
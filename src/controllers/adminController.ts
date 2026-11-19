import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { Prisma, Role } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { normalizePhone } from '../utils/normalize';
import { passwordSchema, publicUser } from './authController';

async function catatAudit(
  adminId: number,
  data: {
    actionType: string;
    title: string;
    detail: string;
    targetId?: number;
    targetName: string;
    targetRole: Role;
    variant: 'green' | 'red' | 'amber' | 'blue';
  }
) {
  await prisma.auditLog.create({ data: { adminId, ...data } });
}

// CREATE (ADMIN / Pembudidaya atau BUYER / Pembeli)
export const createUser = async (req: Request, res: Response) => {
  const body = z
    .object({
      role: z.enum(['ADMIN', 'BUYER']).default('ADMIN'),
      name: z.string().trim().min(2),
      username: z.string().trim().min(3).max(30).optional(),
      email: z.string().trim().toLowerCase().email(),
      phoneNumber: z.string().trim().min(8).max(20).optional(),
      password: passwordSchema,
      status: z.enum(['PENDING_VERIFICATION', 'ACTIVE']).default('ACTIVE'),
      businessName: z.string().trim().min(2).optional(),
      city: z.string().trim().optional(),
      location: z.string().trim().optional(),
    })
    .parse(req.body);

  if (body.role === 'ADMIN' && !body.businessName) {
    throw new AppError(400, 'Nama tambak/usaha wajib diisi untuk pembudidaya.');
  }

  const user = await prisma.user.create({
    data: {
      name: body.name,
      username: body.username,
      email: body.email,
      phoneNumber: body.phoneNumber ? normalizePhone(body.phoneNumber) : undefined,
      password: await bcrypt.hash(body.password, 10),
      role: body.role,
      status: body.status,
      createdById: req.user!.id,
      ...(body.role === 'ADMIN'
        ? {
            sellerProfile: {
              create: {
                businessName: body.businessName!,
                city: body.city,
                location: body.location,
              },
            },
          }
        : {}),
    },
    include: { sellerProfile: true },
  });

  await catatAudit(req.user!.id, {
    actionType: 'CREATE_USER',
    title: body.role === 'ADMIN' ? 'Penambahan Mitra Baru' : 'Penambahan Pembeli Baru',
    detail: `Super admin membuat akun ${user.name} (${user.email}).`,
    targetId: user.id,
    targetName: user.sellerProfile?.businessName ?? user.name,
    targetRole: user.role,
    variant: 'blue',
  });

  res.status(201).json({ data: { ...publicUser(user), sellerProfile: user.sellerProfile } });
};

// READ LIST
export const listUsers = async (req: Request, res: Response) => {
  const q = z
    .object({
      role: z.enum(['SUPERADMIN', 'ADMIN', 'BUYER']).optional(),
      status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'BLOCKED']).optional(),
      q: z.string().trim().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .parse(req.query);

  const where: Prisma.UserWhereInput = {};
  if (q.role) where.role = q.role;
  if (q.status) where.status = q.status;
  if (q.q) {
    where.OR = [
      { name: { contains: q.q } },
      { email: { contains: q.q } },
      { username: { contains: q.q } },
      { sellerProfile: { businessName: { contains: q.q } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: {
        sellerProfile: true,
        _count: { select: { products: true } },
      },
    }),
  ]);

  res.json({
    data: rows.map((u) => ({
      ...publicUser(u),
      status: u.status,
      statusReason: u.statusReason,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      sellerProfile: u.sellerProfile,
      productCount: u._count.products,
    })),
    meta: { total, page: q.page, limit: q.limit },
  });
};

// READ DETAIL
export const getUserDetail = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      sellerProfile: true,
      bankAccounts: true,
      addresses: true,
    },
  });
  if (!user) throw new AppError(404, 'Pengguna tidak ditemukan.');
  res.json({ data: { ...publicUser(user), status: user.status, sellerProfile: user.sellerProfile, bankAccounts: user.bankAccounts, addresses: user.addresses } });
};

// UPDATE DATA PENGGUNA (Edit Profil / Bisnis / Password)
export const updateUser = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const body = z
    .object({
      name: z.string().trim().min(2).optional(),
      username: z.string().trim().min(3).max(30).optional(),
      email: z.string().trim().toLowerCase().email().optional(),
      phoneNumber: z.string().trim().min(8).max(20).optional(),
      newPassword: passwordSchema.optional(),
      businessName: z.string().trim().min(2).optional(),
      city: z.string().trim().optional(),
      location: z.string().trim().optional(),
    })
    .parse(req.body);

  const existing = await prisma.user.findUnique({
    where: { id },
    include: { sellerProfile: true },
  });
  if (!existing) throw new AppError(404, 'Pengguna tidak ditemukan.');

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.username ? { username: body.username } : {}),
      ...(body.email ? { email: body.email } : {}),
      ...(body.phoneNumber ? { phoneNumber: normalizePhone(body.phoneNumber) } : {}),
      ...(body.newPassword ? { password: await bcrypt.hash(body.newPassword, 10) } : {}),
      ...(existing.role === 'ADMIN' && (body.businessName || body.city || body.location)
        ? {
            sellerProfile: {
              upsert: {
                update: {
                  ...(body.businessName ? { businessName: body.businessName } : {}),
                  ...(body.city ? { city: body.city } : {}),
                  ...(body.location ? { location: body.location } : {}),
                },
                create: {
                  businessName: body.businessName ?? existing.name,
                  city: body.city,
                  location: body.location,
                },
              },
            },
          }
        : {}),
    },
    include: { sellerProfile: true },
  });

  await catatAudit(req.user!.id, {
    actionType: 'UPDATE_USER',
    title: 'Perubahan Data Akun',
    detail: `Super admin memperbarui profil akun ${updated.name}.`,
    targetId: updated.id,
    targetName: updated.sellerProfile?.businessName ?? updated.name,
    targetRole: updated.role,
    variant: 'amber',
  });

  res.json({ data: { ...publicUser(updated), sellerProfile: updated.sellerProfile } });
};

// UPDATE STATUS (Approve, Reject, Suspend, Unblock)
export const updateUserStatus = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { status, reason } = z
    .object({
      status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'BLOCKED']),
      reason: z.string().trim().max(255).optional(),
    })
    .parse(req.body);

  if (id === req.user!.id) {
    throw new AppError(400, 'Anda tidak dapat mengubah status akun sendiri.');
  }

  const user = await prisma.user.update({
    where: { id },
    data: { status, statusReason: status === 'ACTIVE' ? null : reason ?? null },
    include: { sellerProfile: true },
  });

  await catatAudit(req.user!.id, {
    actionType: `STATUS_${status}`,
    title: `Status Akun Diubah ke ${status}`,
    detail: reason ? `Alasan: ${reason}` : `Status akun ${user.name} diperbarui.`,
    targetId: user.id,
    targetName: user.sellerProfile?.businessName ?? user.name,
    targetRole: user.role,
    variant: status === 'ACTIVE' ? 'green' : 'red',
  });

  res.json({ data: { ...publicUser(user), status: user.status, statusReason: user.statusReason } });
};

// DELETE PENGGUNA
export const deleteUser = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  if (id === req.user!.id) {
    throw new AppError(400, 'Anda tidak dapat menghapus akun sendiri.');
  }

  const target = await prisma.user.findUnique({
    where: { id },
    include: { sellerProfile: true },
  });
  if (!target) throw new AppError(404, 'Pengguna tidak ditemukan.');

  await prisma.user.delete({ where: { id } });

  await catatAudit(req.user!.id, {
    actionType: 'DELETE_USER',
    title: 'Penghapusan Akun Pengguna',
    detail: `Akun ${target.name} (${target.email}) telah dihapus permanen.`,
    targetName: target.sellerProfile?.businessName ?? target.name,
    targetRole: target.role,
    variant: 'red',
  });

  res.json({ message: 'Akun pengguna berhasil dihapus.' });
};

// LIST AUDIT LOGS
export const listAuditLogs = async (_req: Request, res: Response) => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { admin: { select: { name: true } } },
  });
  res.json({ data: logs });
};
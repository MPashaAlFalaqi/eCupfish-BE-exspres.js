import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { normalizePhone } from '../utils/normalize';
import { passwordSchema, publicUser } from './authController';

export const createSeller = async (req: Request, res: Response) => {
  const body = z
    .object({
      name: z.string().trim().min(2),
      email: z.string().trim().toLowerCase().email(),
      phoneNumber: z.string().trim().min(8).max(20).optional(),
      password: passwordSchema,
      businessName: z.string().trim().min(2),
      city: z.string().trim().optional(),
      location: z.string().trim().optional(),
    })
    .parse(req.body);

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      phoneNumber: body.phoneNumber ? normalizePhone(body.phoneNumber) : undefined,
      password: await bcrypt.hash(body.password, 10),
      role: 'ADMIN',
      createdById: req.user!.id,
      sellerProfile: {
        create: { businessName: body.businessName, city: body.city, location: body.location },
      },
    },
    include: { sellerProfile: true },
  });
  res.status(201).json({ user: { ...publicUser(user), sellerProfile: user.sellerProfile } });
};

export const listUsers = async (req: Request, res: Response) => {
  const q = z
    .object({
      role: z.enum(['SUPERADMIN', 'ADMIN', 'BUYER']).optional(),
      q: z.string().trim().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(req.query);

  const where: Prisma.UserWhereInput = {};
  if (q.role) where.role = q.role;
  if (q.q) where.OR = [{ name: { contains: q.q } }, { email: { contains: q.q } }];

  const userFindManyArgs = {
    where,
    orderBy: { createdAt: 'desc' },
    skip: (q.page - 1) * q.limit,
    take: q.limit,
    include: {
      sellerProfile: {
        select: { businessName: true, city: true },
      },
    },
  } satisfies Prisma.UserFindManyArgs;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany(userFindManyArgs as any),
  ]);
  res.json({
    data: rows.map((u) => ({
      ...publicUser(u),
      createdAt: u.createdAt,
      sellerProfile: u.sellerProfile,
    })),
    meta: { total, page: q.page, limit: q.limit },
  });
};

export const updateUserStatus = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { status } = z
    .object({ status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']) })
    .parse(req.body);
  if (id === req.user!.id) {
    throw new AppError(400, 'Anda tidak dapat mengubah status akun sendiri.');
  }
  const user = await prisma.user.update({ where: { id }, data: { status } });
  res.json({ user: { ...publicUser(user), status } });
};
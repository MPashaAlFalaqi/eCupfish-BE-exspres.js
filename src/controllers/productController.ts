import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { productInclude, toDto } from '../utils/product';

export const listCategories = async (_req: Request, res: Response) => {
  const data = await prisma.category.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ data });
};

const listQuery = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(), // slug, contoh: halfmoon
  grade: z.enum(['CONTEST', 'PLAYER', 'PET']).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'rating']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listProducts = async (req: Request, res: Response) => {
  const q = listQuery.parse(req.query);

  const where: Prisma.ProductWhereInput = { deletedAt: null, listed: true, status: 'AVAILABLE' };
  if (q.q) where.OR = [{ name: { contains: q.q } }, { category: { name: { contains: q.q } } }];
  if (q.category) where.category = { slug: q.category };
  if (q.grade) where.grade = q.grade;
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    where.price = { gte: q.minPrice, lte: q.maxPrice };
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    q.sort === 'price_asc'
      ? { price: 'asc' }
      : q.sort === 'price_desc'
        ? { price: 'desc' }
        : q.sort === 'rating'
          ? { ratingAvg: 'desc' }
          : { createdAt: 'desc' };

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: productInclude,
    }),
  ]);
  res.json({ data: rows.map(toDto), meta: { total, page: q.page, limit: q.limit } });
};

export const getProduct = async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const p = await prisma.product.findFirst({
    where: { id, deletedAt: null, listed: true },
    include: productInclude,
  });
  if (!p) throw new AppError(404, 'Produk tidak ditemukan.');
  res.json({ data: toDto(p) });
};
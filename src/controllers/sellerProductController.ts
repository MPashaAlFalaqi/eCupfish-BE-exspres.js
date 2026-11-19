import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/prisma';
import { AppError } from '../utils/appError';
import { hapusFile } from '../middleware/upload';
import { productInclude, resolveStatus as resolveStatusBase, toDto } from '../utils/product';

const resolveStatus = (
  stock: number,
  auto: boolean,
  current: Parameters<typeof resolveStatusBase>[2],
  _threshold?: number,
  _strictThreshold?: boolean,
) => resolveStatusBase(stock, auto, current);

const gradeEnum = z.enum(['CONTEST', 'PLAYER', 'PET']);
const statusEnum = z.enum(['AVAILABLE', 'LOW_STOCK', 'SOLD_OUT', 'INACTIVE']);
const idParam = (v: unknown) => z.coerce.number().int().positive().parse(v);

const productBody = z.object({
  name: z.string().trim().min(3, 'Nama minimal 3 karakter.'),
  categoryId: z.number().int().positive(),
  grade: gradeEnum,
  tier: z.enum(['S', 'A', 'B', 'C']).optional(),
  colorPattern: z.string().trim().max(100).optional(),
  aiConfidence: z.number().min(0).max(100).optional(),
  aiRawResult: z.any().optional(),
  ageMonths: z.number().int().min(0).max(60).optional(),
  price: z.number().int().min(1000, 'Harga minimal Rp 1.000.'),
  stock: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).optional(),
  strictThreshold: z.boolean().optional(),
  listed: z.boolean().optional(),
  tankLocation: z.string().trim().max(100).optional(),
  healthDescription: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

// Mengambil produk hanya bila milik seller yang sedang login
async function milikSaya(id: number, sellerId: number) {
  const p = await prisma.product.findFirst({
    where: { id, sellerId, deletedAt: null },
    include: productInclude,
  });
  if (!p) throw new AppError(404, 'Produk tidak ditemukan.');
  return p;
}

export const listMine = async (req: Request, res: Response) => {
  const q = z
    .object({
      q: z.string().trim().optional(),
      category: z.string().trim().optional(),
      grade: gradeEnum.optional(),
      status: statusEnum.optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(req.query);

  const base: Prisma.ProductWhereInput = { sellerId: req.user!.id, deletedAt: null };
  const where: Prisma.ProductWhereInput = { ...base };
  if (q.q) where.name = { contains: q.q };
  if (q.category) where.category = { slug: q.category };
  if (q.grade) where.grade = q.grade;
  if (q.status) where.status = q.status;

  const [total, rows, aktif, lowStockCount] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: productInclude,
    }),
    prisma.product.aggregate({
      where: { ...base, status: { in: ['AVAILABLE', 'LOW_STOCK'] } },
      _sum: { stock: true },
    }),
    prisma.product.count({
      where: { ...base, status: 'LOW_STOCK' },
    }),
  ]);

  res.json({
    data: rows.map(toDto),
    meta: { total, page: q.page, limit: q.limit },
    // untuk judul halaman: jumlah varian, total stok aktif, dan varian menipis
    summary: {
      variants: total,
      activeStock: aktif._sum.stock ?? 0,
      lowStockVariants: lowStockCount,
    },
  });
};

export const getMine = async (req: Request, res: Response) => {
  const p = await milikSaya(idParam(req.params.id), req.user!.id);
  res.json({ data: toDto(p) });
};

export const createProduct = async (req: Request, res: Response) => {
  const b = productBody.parse(req.body);
  const kategori = await prisma.category.findUnique({ where: { id: b.categoryId } });
  if (!kategori) throw new AppError(400, 'Kategori tidak ditemukan.');

  const threshold = b.lowStockThreshold ?? 5;
  const strict = b.strictThreshold ?? false;
  const initialStatus = resolveStatus(b.stock, true, 'AVAILABLE', threshold, strict);

  const p = await prisma.product.create({
    data: {
      ...b,
      lowStockThreshold: threshold,
      strictThreshold: strict,
      sellerId: req.user!.id,
      status: initialStatus,
    },
    include: productInclude,
  });
  res.status(201).json({ data: toDto(p) });
};

export const updateProduct = async (req: Request, res: Response) => {
  const id = idParam(req.params.id);
  const lama = await milikSaya(id, req.user!.id);
  const b = productBody.partial().parse(req.body);

  const stock = b.stock ?? lama.stock;
  const threshold = b.lowStockThreshold ?? lama.lowStockThreshold;
  const strict = b.strictThreshold ?? lama.strictThreshold;
  const status = resolveStatus(stock, lama.autoStatus, lama.status, threshold, strict);

  const p = await prisma.product.update({
    where: { id },
    data: { ...b, status },
    include: productInclude,
  });

  if (stock !== lama.stock || status !== lama.status) {
    await prisma.stockLog.create({
      data: {
        productId: id,
        type: 'MANUAL',
        oldStatus: lama.status,
        newStatus: status,
        oldStock: lama.stock,
        newStock: stock,
        reason: 'Perubahan lewat formulir edit',
        byUserId: req.user!.id,
      },
    });
  }
  res.json({ data: toDto(p) });
};

export const deleteProduct = async (req: Request, res: Response) => {
  const id = idParam(req.params.id);
  await milikSaya(id, req.user!.id);
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date(), listed: false } });
  res.json({ message: 'Produk dihapus.' });
};

export const setAvailability = async (req: Request, res: Response) => {
  const id = idParam(req.params.id);
  const b = z
    .object({
      status: statusEnum.optional(),
      autoStatus: z.boolean().optional(),
      stock: z.number().int().min(0).optional(),
      lowStockThreshold: z.number().int().min(0).optional(),
      strictThreshold: z.boolean().optional(),
      reason: z.string().trim().max(255).optional(),
    })
    .parse(req.body);
  const lama = await milikSaya(id, req.user!.id);

  const auto = b.autoStatus ?? lama.autoStatus;
  const stock = b.stock ?? lama.stock;
  const threshold = b.lowStockThreshold ?? lama.lowStockThreshold;
  const strict = b.strictThreshold ?? lama.strictThreshold;
  const status = resolveStatus(stock, auto, b.status ?? lama.status, threshold, strict);

  const p = await prisma.$transaction(async (tx) => {
    const baru = await tx.product.update({
      where: { id },
      data: {
        autoStatus: auto,
        stock,
        status,
        lowStockThreshold: threshold,
        strictThreshold: strict,
      },
      include: productInclude,
    });
    await tx.stockLog.create({
      data: {
        productId: id,
        type: 'MANUAL',
        oldStatus: lama.status,
        newStatus: status,
        oldStock: lama.stock,
        newStock: stock,
        reason: b.reason,
        byUserId: req.user!.id,
      },
    });
    return baru;
  });
  res.json({ data: toDto(p) });
};

export const listStockLogs = async (req: Request, res: Response) => {
  const id = idParam(req.params.id);
  await milikSaya(id, req.user!.id);
  const data = await prisma.stockLog.findMany({
    where: { productId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ data });
};

export const uploadMedia = async (req: Request, res: Response) => {
  const id = idParam(req.params.id);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const p = await milikSaya(id, req.user!.id);
    if (files.length === 0) {
      throw new AppError(400, 'Tidak ada berkas valid. Gunakan JPG, PNG, WEBP, atau MP4.');
    }
    if (p.media.length + files.length > 6) {
      throw new AppError(400, 'Maksimal 6 foto atau video per produk.');
    }
    const adaSampul = p.media.some((m) => m.isCover);
    await prisma.productMedia.createMany({
      data: files.map((f, i): Prisma.ProductMediaCreateManyInput => ({
        productId: id,
        type: f.mimetype.startsWith('video/') ? 'VIDEO' : 'PHOTO',
        url: `/uploads/products/${f.filename}`,
        isCover: !adaSampul && i === 0 && f.mimetype.startsWith('image/'),
        sortOrder: p.media.length + i,
      })),
    });
  } catch (err) {
    // Bersihkan berkas yang sudah terlanjur tersimpan di disk
    files.forEach((f) => hapusFile(`/uploads/products/${f.filename}`));
    throw err;
  }
  const baru = await milikSaya(id, req.user!.id);
  res.status(201).json({ data: toDto(baru) });
};

async function mediaMilikSaya(mediaId: number, sellerId: number) {
  const m = await prisma.productMedia.findFirst({
    where: { id: mediaId, product: { sellerId } },
  });
  if (!m) throw new AppError(404, 'Media tidak ditemukan.');
  return m;
}

export const deleteMedia = async (req: Request, res: Response) => {
  const m = await mediaMilikSaya(idParam(req.params.mediaId), req.user!.id);
  await prisma.productMedia.delete({ where: { id: m.id } });
  hapusFile(m.url);
  if (m.isCover) {
    const berikut = await prisma.productMedia.findFirst({
      where: { productId: m.productId, type: 'PHOTO' },
      orderBy: { sortOrder: 'asc' },
    });
    if (berikut) {
      await prisma.productMedia.update({ where: { id: berikut.id }, data: { isCover: true } });
    }
  }
  res.json({ message: 'Media dihapus.' });
};

export const setCover = async (req: Request, res: Response) => {
  const m = await mediaMilikSaya(idParam(req.params.mediaId), req.user!.id);
  if (m.type !== 'PHOTO') throw new AppError(400, 'Sampul harus berupa foto.');
  await prisma.$transaction([
    prisma.productMedia.updateMany({ where: { productId: m.productId }, data: { isCover: false } }),
    prisma.productMedia.update({ where: { id: m.id }, data: { isCover: true } }),
  ]);
  res.json({ message: 'Sampul diperbarui.' });
};
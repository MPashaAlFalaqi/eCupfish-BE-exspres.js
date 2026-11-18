import { Prisma, ProductStatus } from '@prisma/client';

export const productInclude = {
  category: true,
  media: { orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }] },
  seller: { select: { id: true, sellerProfile: { select: { businessName: true } } } },
} satisfies Prisma.ProductInclude;

export type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

// Status mengikuti stok bila autoStatus aktif. Produk nonaktif tidak diubah otomatis.
export function resolveStatus(stock: number, auto: boolean, current: ProductStatus): ProductStatus {
  if (current === 'INACTIVE') return current;
  if (!auto) return current;
  return stock > 0 ? 'AVAILABLE' : 'SOLD_OUT';
}

export const toDto = (p: ProductRow) => ({
  id: p.id,
  name: p.name,
  category: p.category.name,
  categorySlug: p.category.slug,
  categoryId: p.categoryId,
  grade: p.grade,
  tier: p.tier,
  ageMonths: p.ageMonths,
  price: p.price,
  stock: p.stock,
  lowStockThreshold: p.lowStockThreshold,
  autoStatus: p.autoStatus,
  status: p.status,
  listed: p.listed,
  tankLocation: p.tankLocation,
  healthDescription: p.healthDescription,
  notes: p.notes,
  ratingAvg: p.ratingAvg,
  reviewCount: p.reviewCount,
  seller: { id: p.seller.id, name: p.seller.sellerProfile?.businessName ?? null },
  media: p.media.map((m) => ({ id: m.id, type: m.type, url: m.url, isCover: m.isCover })),
  createdAt: p.createdAt,
});
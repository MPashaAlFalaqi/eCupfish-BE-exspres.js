import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD ?? 'Password123!';
  const hash = await bcrypt.hash(password, 10);

  const superadmin = await prisma.user.upsert({
    where: { email: 'superadmin@ecupfish.id' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'superadmin@ecupfish.id',
      password: hash,
      role: Role.SUPERADMIN,
      emailVerifiedAt: new Date(),
    },
  });

  const seller = await prisma.user.upsert({
    where: { email: 'pembudidaya@ecupfish.id' },
    update: {},
    create: {
      name: 'Budi Pembudidaya',
      email: 'pembudidaya@ecupfish.id',
      password: hash,
      role: Role.ADMIN,
      createdById: superadmin.id,
      sellerProfile: {
        create: { businessName: 'Betta King Jakarta', city: 'Jakarta', location: 'Jakarta Timur' },
      },
    },
  });

  await prisma.user.upsert({
    where: { email: 'pembeli@ecupfish.id' },
    update: {},
    create: { name: 'Rina Pembeli', email: 'pembeli@ecupfish.id', password: hash, role: Role.BUYER },
  });

  const kategori = ['Plakat', 'Halfmoon', 'Nemo', 'Crowntail'];
  const kategoriId: Record<string, number> = {};
  const categoryModel = (prisma as any).category ?? (prisma as any).categories;
  const productModel = (prisma as any).product ?? (prisma as any).products;

  for (const [i, name] of kategori.entries()) {
    const c = await categoryModel.upsert({
      where: { slug: name.toLowerCase() },
      update: {},
      create: { name, slug: name.toLowerCase(), sortOrder: i + 1 },
    });
    kategoriId[name] = c.id;
  }

  if ((await productModel.count()) === 0) {
    const contoh = [
      { name: 'Plakat Blue Rim', cat: 'Plakat', grade: 'CONTEST' as const, tier: 'A', price: 150000, stock: 24 },
      { name: 'Halfmoon Galaxy Koi', cat: 'Halfmoon', grade: 'CONTEST' as const, tier: 'S', price: 325000, stock: 12 },
      { name: 'Halfmoon Multi Blue Rim Pure', cat: 'Halfmoon', grade: 'PLAYER' as const, tier: 'A', price: 275000, stock: 18 },
      { name: 'Nemo Classic Multi', cat: 'Nemo', grade: 'PET' as const, tier: 'B', price: 85000, stock: 45 },
      { name: 'Crowntail Red Dragon', cat: 'Crowntail', grade: 'PLAYER' as const, tier: 'B', price: 120000, stock: 0 },
    ];
    for (const p of contoh) {
      await productModel.create({
        data: {
          sellerId: seller.id,
          categoryId: kategoriId[p.cat],
          name: p.name,
          grade: p.grade,
          tier: p.tier,
          ageMonths: 4,
          price: p.price,
          stock: p.stock,
          status: p.stock > 0 ? 'AVAILABLE' : 'SOLD_OUT',
          healthDescription: 'Sehat, aktif, sirip utuh.',
          tankLocation: 'Rak A1',
        },
      });
    }
  }
  console.log('Seed selesai. Kata sandi akun uji: ' + password);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';

export const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const PRODUK_DIR = path.join(UPLOAD_ROOT, 'products');
fs.mkdirSync(PRODUK_DIR, { recursive: true });

const TIPE_DIIZINKAN: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
};

export const uploadProduk = multer({
  storage: multer.diskStorage({
    destination: PRODUK_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + TIPE_DIIZINKAN[file.mimetype]),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in TIPE_DIIZINKAN),
});

// url berbentuk /uploads/products/nama.jpg
export function hapusFile(url: string) {
  const lokasi = path.join(process.cwd(), url.startsWith('/') ? url.slice(1) : url);
  if (!lokasi.startsWith(UPLOAD_ROOT)) return;
  fs.promises.unlink(lokasi).catch(() => {});
}
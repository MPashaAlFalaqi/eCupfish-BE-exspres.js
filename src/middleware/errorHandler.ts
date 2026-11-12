import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/appError';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      message: 'Data yang dikirim tidak valid.',
      errors: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  const kode = (err as { code?: string })?.code;
  if (kode === 'P2002') {
    res.status(409).json({ message: 'Data sudah terdaftar (duplikat).' });
    return;
  }
  if (kode === 'P2025') {
    res.status(404).json({ message: 'Data tidak ditemukan.' });
    return;
  }

    if ((err as { name?: string })?.name === 'MulterError') {
    const kode = (err as { code?: string }).code;
    const pesan =
      kode === 'LIMIT_FILE_SIZE' ? 'Ukuran berkas maksimal 20 MB.' : 'Berkas tidak dapat diunggah.';
    res.status(400).json({ message: pesan });
    return;
  }

  console.error(err);
  res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
};
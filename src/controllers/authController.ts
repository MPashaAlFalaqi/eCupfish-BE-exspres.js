import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User } from '@prisma/client';
import prisma from '../config/prisma';
import { env } from '../config/env';
import { AppError } from '../utils/appError';
import { normalizePhone, normalizeTarget } from '../utils/normalize';
import { randomOtp, randomToken, sha256, signAccessToken } from '../utils/tokens';

const DAY = 24 * 60 * 60 * 1000;
// Hash palsu agar waktu respons login sama baik email ada maupun tidak
const DUMMY_HASH = bcrypt.hashSync('kata-sandi-palsu', 10);

export const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
  phoneNumber: u.phoneNumber,
  photoUrl: u.photoUrl,
  role: u.role,
});

const emailSchema = z.string().trim().toLowerCase().email('Format email tidak valid.');
export const passwordSchema = z.string().min(8, 'Kata sandi minimal 8 karakter.');

async function createSession(user: User) {
  const refreshToken = randomToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + env.refreshDays * DAY),
    },
  });
  return { token: signAccessToken(user), refreshToken, user: publicUser(user) };
}

export const register = async (req: Request, res: Response) => {
  // Perhatikan: field role sengaja TIDAK ada di skema, sehingga diabaikan zod
  const body = z
    .object({
      name: z.string().trim().min(2, 'Nama minimal 2 karakter.'),
      email: emailSchema,
      phoneNumber: z.string().trim().min(8).max(20).optional(),
      password: passwordSchema,
    })
    .parse(req.body);

  const ada = await prisma.user.findUnique({ where: { email: body.email } });
  if (ada) throw new AppError(409, 'Email sudah terdaftar.');

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      phoneNumber: body.phoneNumber ? normalizePhone(body.phoneNumber) : undefined,
      password: await bcrypt.hash(body.password, 10),
      role: 'BUYER',
    },
  });
  res.status(201).json(await createSession(user));
};

export const login = async (req: Request, res: Response) => {
  const body = z
    .object({ email: emailSchema, password: z.string().min(1, 'Kata sandi wajib diisi.') })
    .parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const cocok = await bcrypt.compare(body.password, user ? user.password : DUMMY_HASH);
  if (!user || !cocok) throw new AppError(401, 'Email atau kata sandi salah.');
  if (user.status !== 'ACTIVE') {
    throw new AppError(403, 'Akun Anda tidak aktif. Hubungi admin eCupFish.');
  }

  const diperbarui = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  res.json(await createSession(diperbarui));
};

export const refresh = async (req: Request, res: Response) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
  const rec = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    include: { user: true },
  });
  if (!rec || rec.revokedAt || rec.expiresAt < new Date() || rec.user.status !== 'ACTIVE') {
    throw new AppError(401, 'Sesi berakhir, silakan login ulang.');
  }
  // Rotasi: token lama dicabut, token baru diterbitkan
  await prisma.refreshToken.update({ where: { id: rec.id }, data: { revokedAt: new Date() } });
  res.json(await createSession(rec.user));
};

export const logout = async (req: Request, res: Response) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  res.json({ message: 'Berhasil keluar.' });
};

export const forgotPassword = async (req: Request, res: Response) => {
  const { target } = z.object({ target: z.string().trim().min(5) }).parse(req.body);
  const key = normalizeTarget(target);
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: key }, { phoneNumber: key }] },
  });

  if (user) {
    const kode = randomOtp();
    // Matikan OTP lama yang belum terpakai
    await prisma.otpCode.updateMany({
      where: { target: key, purpose: 'RESET_PASSWORD', usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.otpCode.create({
      data: {
        userId: user.id,
        target: key,
        purpose: 'RESET_PASSWORD',
        codeHash: sha256(kode),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    // TODO: kirim lewat email (nodemailer) atau WhatsApp/SMS. Untuk pengembangan, tampilkan di terminal.
    if (env.nodeEnv !== 'production') console.log(`[OTP] ${key} -> ${kode}`);
  }
  // Jawaban selalu sama agar penyerang tidak bisa menebak akun yang terdaftar
  res.json({ message: 'Jika akun ditemukan, kode OTP telah dikirim.' });
};

export const verifyOtp = async (req: Request, res: Response) => {
  const { target, code } = z
    .object({ target: z.string().trim().min(5), code: z.string().length(6) })
    .parse(req.body);
  const key = normalizeTarget(target);

  const otp = await prisma.otpCode.findFirst({
    where: { target: key, purpose: 'RESET_PASSWORD', usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.attempts >= 5) {
    throw new AppError(400, 'Kode OTP tidak valid atau sudah kedaluwarsa.');
  }
  if (otp.codeHash !== sha256(code)) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new AppError(400, 'Kode OTP salah. Periksa lagi atau kirim ulang kode.');
  }
  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
  const resetToken = jwt.sign({ id: otp.userId, purpose: 'reset' }, env.jwtSecret + ':reset', {
    expiresIn: '10m',
  });
  res.json({ resetToken });
};

export const resetPassword = async (req: Request, res: Response) => {
  const { resetToken, newPassword } = z
    .object({ resetToken: z.string().min(10), newPassword: passwordSchema })
    .parse(req.body);
  let payload: { id: number };
  try {
    payload = jwt.verify(resetToken, env.jwtSecret + ':reset') as { id: number };
  } catch {
    throw new AppError(400, 'Sesi reset kedaluwarsa. Ulangi dari awal.');
  }
  await prisma.user.update({
    where: { id: payload.id },
    data: { password: await bcrypt.hash(newPassword, 10) },
  });
  // Semua sesi lama dicabut
  await prisma.refreshToken.updateMany({
    where: { userId: payload.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  res.json({ message: 'Kata sandi berhasil diubah. Silakan masuk.' });
};
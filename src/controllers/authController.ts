import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_ecupfish';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    // Frontend (Web/Mobile) harus mengirimkan 'role' saat mendaftar
    const { name, email, phoneNumber, password, role } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ message: 'Email sudah terdaftar.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        phoneNumber,
        password: hashedPassword,
        role: role || 'BUYER', // Default ke BUYER jika tidak dikirim
      },
    });

    res.status(201).json({ message: 'Pendaftaran berhasil!', user: { email: newUser.email, role: newUser.role } });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ message: 'Akun tidak ditemukan.' });
      return;
    }

    if (!user.password) {
      res.status(401).json({ message: 'Kata sandi salah.' });
      return;
    }

    const isPasswordValid = await Promise.resolve(bcrypt.compare(password, user.password));
    if (!isPasswordValid) {
      res.status(401).json({ message: 'Kata sandi salah.' });
      return;
    }

    // MASUKKAN ROLE KE DALAM TOKEN JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role // <-- BAGIAN INI WAJIB ADA
      }, 
      JWT_SECRET, 
      { expiresIn: '1d' }
    );

    res.status(200).json({
      message: 'Login berhasil!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role // Frontend butuh ini untuk validasi Route Guard
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
};

export const requestPasswordReset = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ message: 'Fitur minta reset password segera hadir.' });
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({ message: 'Fitur reset password segera hadir.' });
};

export const getProfile = async (req: any, res: Response): Promise<void> => {
  try {
    // req.user didapatkan dari middleware authenticateToken
    const userId = req.user?.id;

    if (!userId) {
      res.status(400).json({ message: 'ID Pengguna tidak ditemukan dalam token.' });
      return;
    }

    // Mencari data user di database berdasarkan ID dari token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        role: true,
        // Kita gunakan 'select' agar password TIDAK ikut terkirim ke frontend
      },
    });

    if (!user) {
      res.status(404).json({ message: 'Profil pengguna tidak ditemukan.' });
      return;
    }

    res.status(200).json({ message: 'Profil berhasil diambil', user });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan saat mengambil profil.' });
  }
};
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/authMiddleware';
import prisma from '../config/prisma';
import nodemailer from 'nodemailer';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, phoneNumber, password, role } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ message: 'Email sudah terdaftar!' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        phoneNumber,
        password: hashedPassword,
        role: role || 'BUYER', 
      },
    });


    // 4. Kirim respon sukses ke Frontend/Postman
    res.status(201).json({
      message: 'Registrasi berhasil!',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
      },
    });
  } catch (error) {
    console.error('[Error Register]:', error);
    res.status(500).json({ message: 'Terjadi kesalahan pada server' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // 1. Cari pengguna berdasarkan email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(404).json({ message: 'Email tidak ditemukan!' });
      return;
    }

    // 2. Cek apakah password cocok (karena password di database diacak)
    // Ingat: Pengguna Google Login mungkin tidak punya password
    if (!user.password) {
      res.status(400).json({ message: 'Silakan login menggunakan Google.' });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ message: 'Password salah!' });
      return;
    }

    // 3. Buat Token (JWT)
    const secretKey = process.env.JWT_SECRET || 'fallback_secret_key';
    const token = jwt.sign(
      { userId: user.id, role: user.role }, 
      secretKey, 
      { expiresIn: '7d' } // Token berlaku selama 7 hari
    );

    // 4. Kirim token ke Frontend
    res.status(200).json({
      message: 'Login berhasil!',
      token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('[Error Login]:', error);
    res.status(500).json({ message: 'Terjadi kesalahan pada server' });
  }
};

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // req.user didapatkan dari middleware authenticateToken
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      // select digunakan agar kita TIDAK mengirimkan password kembali ke frontend
      select: { 
        id: true, 
        name: true, 
        email: true, 
        phoneNumber: true, 
        role: true 
      }
    });

    if (!user) {
      res.status(404).json({ message: 'Pengguna tidak ditemukan' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('[Error Get Profile]:', error);
    res.status(500).json({ message: 'Terjadi kesalahan pada server' });
  }
};

export const requestPasswordReset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      res.status(404).json({ message: 'Email tidak terdaftar.' });
      return;
    }

    // Buat 6 digit OTP acak
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // Masa berlaku OTP (contoh: 15 menit dari sekarang)
    const expiry = new Date(Date.now() + 15 * 60 * 1000); 

    // Simpan OTP ke database
    await prisma.user.update({
      where: { email },
      data: {
        resetPasswordOtp: otp,
        resetPasswordExpiry: expiry,
      },
    });

    // Konfigurasi pengirim email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Kirim email
    await transporter.sendMail({
      from: '"eCupfish" <no-reply@ecupfish.com>',
      to: email,
      subject: 'Kode OTP Reset Password eCupfish',
      html: `<p>Kode OTP Anda adalah: <b>${otp}</b></p><p>Kode ini berlaku selama 15 menit.</p>`,
    });

    res.status(200).json({ message: 'Kode OTP telah dikirim ke email Anda.' });
  } catch (error) {
    console.error('[Error Request Reset]:', error);
    res.status(500).json({ message: 'Gagal mengirim email OTP' });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    // Cek apakah user ada, OTP cocok, dan belum kedaluwarsa
    if (!user || user.resetPasswordOtp !== otp) {
      res.status(400).json({ message: 'Kode OTP salah atau tidak ditemukan.' });
      return;
    }

    if (!user.resetPasswordExpiry || user.resetPasswordExpiry < new Date()) {
      res.status(400).json({ message: 'Kode OTP sudah kedaluwarsa.' });
      return;
    }

    // Acak password baru
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password dan hapus OTP dari database
    await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        resetPasswordOtp: null,
        resetPasswordExpiry: null,
      },
    });

    res.status(200).json({ message: 'Kata sandi berhasil diubah! Silakan login kembali.' });
  } catch (error) {
    console.error('[Error Reset Password]:', error);
    res.status(500).json({ message: 'Gagal mereset kata sandi' });
  }
};
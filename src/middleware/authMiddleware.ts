import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Memperluas tipe Request bawaan Express agar bisa menyimpan data user dari token
export interface AuthRequest extends Request {
  user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  // Mengambil token dari header 'Authorization'
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format yang dikirim: "Bearer <token>"

  if (!token) {
    res.status(401).json({ message: 'Akses ditolak. Token tidak ditemukan!' });
    return;
  }

  const secretKey = process.env.JWT_SECRET || 'fallback_secret_key';

  // Memverifikasi apakah token asli dan belum kedaluwarsa
  jwt.verify(token, secretKey, (err, decodedUser) => {
    if (err) {
      res.status(403).json({ message: 'Token tidak valid atau sudah kedaluwarsa!' });
      return;
    }
    
    // Jika valid, simpan data user ke dalam request agar bisa dipakai di controller
    req.user = decodedUser; 
    next(); // Izinkan masuk ke rute selanjutnya
  });
};
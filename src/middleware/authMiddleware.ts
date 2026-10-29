import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'rahasia_ecupfish';

export interface AuthRequest extends Request {
  user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.header('Authorization')?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ message: 'Akses ditolak. Token tidak ditemukan.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; 
    next();
  } catch (error) {
    res.status(403).json({ message: 'Token tidak valid.' });
  }
};

export const isSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'SUPERADMIN') {
    res.status(403).json({ message: 'Akses ditolak! Khusus Super Admin.' });
    return;
  }
  next();
};

export const isAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ message: 'Akses ditolak! Khusus Pembudidaya.' });
    return;
  }
  next();
};
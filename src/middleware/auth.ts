import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from '../utils/appError';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: Role };
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError(401, 'Silakan login terlebih dahulu.');
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { id: number; role: Role };
    req.user = { id: payload.id, role: payload.role };
  } catch {
    throw new AppError(401, 'Sesi berakhir atau token tidak valid.');
  }
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, 'Silakan login terlebih dahulu.');
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'Anda tidak memiliki akses ke fitur ini.');
    }
    next();
  };
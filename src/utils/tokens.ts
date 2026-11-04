import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';

export const signAccessToken = (user: { id: number; role: Role }) =>
  jwt.sign({ id: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: env.accessTtl as jwt.SignOptions['expiresIn'],
  });

export const sha256 = (nilai: string) =>
  crypto.createHash('sha256').update(nilai).digest('hex');

export const randomToken = () => crypto.randomBytes(48).toString('hex');

export const randomOtp = () =>
  String(crypto.randomInt(0, 1000000)).padStart(6, '0');
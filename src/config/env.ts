import 'dotenv/config';

function wajib(nama: string): string {
  const nilai = process.env[nama];
  if (!nilai) throw new Error(`Variabel ${nama} wajib diisi di file .env`);
  return nilai;
}

const jwtSecret = wajib('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET minimal 32 karakter. Buat dengan crypto.randomBytes.');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: wajib('DATABASE_URL'),
  jwtSecret,
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshDays: Number(process.env.REFRESH_TOKEN_DAYS ?? 7),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((s) => s.trim()),
};
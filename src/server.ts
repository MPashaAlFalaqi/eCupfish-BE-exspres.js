import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json()); 

// Daftarkan rute autentikasi di sini
app.use('/api/auth', authRoutes); // <-- Tambahkan baris ini

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'Server eCupfish berjalan dengan lancar!'
  });
});

app.listen(port, () => {
  console.log(`[Server]: Server berjalan di http://localhost:${port}`);
});
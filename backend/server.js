import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import documentsRouter from './src/routes/documents.js';
import mergeRouter from './src/routes/merge.js';
import { startCleanupSweeper } from './src/services/cleanup.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/documents', documentsRouter);
app.use('/api/merge', mergeRouter);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Paper Duet backend listening on port ${port}`);
  startCleanupSweeper();
});
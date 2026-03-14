import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { SERVER_CONFIG } from './config/datasources.js';
import damsRouter from './routes/dams.js';
import weatherRouter from './routes/weather.js';
import waterLevelsRouter from './routes/waterLevels.js';
import narukoHistoryRouter from './routes/naruko-history.js';
import damHistoryRouter from './routes/dam-history.js';

const app = express();

// セキュリティヘッダー
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://www.jma.go.jp"],
            connectSrc: ["'self'"],
        },
    },
}));

// レートリミット（15分あたり100リクエスト）
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'リクエスト数の上限に達しました。しばらく待ってから再試行してください。' },
});
app.use('/api', apiLimiter);

// CORS設定（本番では環境変数で許可オリジンを指定）
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
}));
app.use(express.json());

// リクエストログ
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.url.startsWith('/api')) {
            console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
        }
    });
    next();
});

// APIルート
app.use('/api/dams', damsRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/water-levels', waterLevelsRouter);
app.use('/api/naruko/history', narukoHistoryRouter);
app.use('/api/dam-history', damHistoryRouter);

// 静的ファイルの配信 (Production環境用)
import path from 'path';
import { fileURLToPath } from 'url';
const __distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist');
app.use(express.static(__distDir));

// SPAのルーティング対応 (API以外のリクエストをindex.htmlへ返す)
app.get('*', (req, res) => {
    if (!req.url.startsWith('/api')) {
        res.sendFile(path.join(__distDir, 'index.html'));
    }
});

// ヘルスチェック
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

// サーバー起動
const PORT = SERVER_CONFIG.port;
app.listen(PORT, () => {
    console.log(`🌊 渇水状況モニタリングサーバー起動: http://localhost:${PORT}`);
    console.log(`📡 APIエンドポイント: http://localhost:${PORT}/api/dams`);
});

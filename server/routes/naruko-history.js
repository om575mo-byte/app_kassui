import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

let cachedData = null;

function loadCsvData() {
    if (cachedData) return cachedData;

    const csvPath = path.join(__dirname, '../../docs/analysis_results/merged_naruko_dataset.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('[naruko-history] CSV not found:', csvPath);
        return null;
    }

    const raw = fs.readFileSync(csvPath, 'utf-8');
    const lines = raw.trim().split('\n');
    const header = lines[0].split(',');
    const storageLevelIdx = header.indexOf('StorageLevel');

    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const dateStr = cols[0];
        const level = parseFloat(cols[storageLevelIdx]);
        if (!isNaN(level) && dateStr) {
            const d = new Date(dateStr);
            data.push({
                month: d.getMonth() + 1,
                day: d.getDate(),
                level
            });
        }
    }

    cachedData = data;
    console.log(`[naruko-history] Loaded ${data.length} data points from CSV`);
    return data;
}

/**
 * GET /api/naruko/history
 * 今日の日付を基準に、今日〜90日後の各日について過去全年の平均・最大・最小を返す
 */
router.get('/', (req, res) => {
    const data = loadCsvData();
    if (!data) {
        return res.json({ error: 'CSV data not available' });
    }

    const today = new Date();
    const result = [];

    for (let offset = 0; offset <= 90; offset++) {
        const target = new Date(today);
        target.setDate(target.getDate() + offset);
        const m = target.getMonth() + 1;
        const d = target.getDate();

        const matching = data.filter(r => r.month === m && r.day === d);

        const year = target.getFullYear();
        const dateString = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        if (matching.length > 0) {
            const levels = matching.map(r => r.level);
            const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
            result.push({
                date: dateString,
                avg: Math.round(avg * 100) / 100,
                min: Math.round(Math.min(...levels) * 100) / 100,
                max: Math.round(Math.max(...levels) * 100) / 100,
                count: levels.length
            });
        } else {
            result.push({
                date: dateString,
                avg: null, min: null, max: null, count: 0
            });
        }
    }

    res.json({ history: result });
});

export default router;

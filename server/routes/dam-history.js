import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// ダムIDごとのCSVパスマッピング（英語ID + 日本語IDの両方に対応）
const DAM_CSV_MAP = {
    naruko: 'merged_naruko_dataset.csv',
    kamafusa: 'merged_kamafusa_sendai.csv',
    okura: 'merged_ookura_dataset.csv',
    isawa: 'merged_isawa_dataset.csv',
    '鳴子': 'merged_naruko_dataset.csv',
    '釜房': 'merged_kamafusa_sendai.csv',
    '大倉': 'merged_ookura_dataset.csv',
    '胆沢': 'merged_isawa_dataset.csv',
};

const dataCache = {};

function loadCsvData(damId) {
    if (dataCache[damId]) return dataCache[damId];

    const csvFile = DAM_CSV_MAP[damId];
    if (!csvFile) return null;

    const csvPath = path.join(__dirname, '../../docs/analysis_results', csvFile);
    if (!fs.existsSync(csvPath)) {
        console.error(`[dam-history] CSV not found for ${damId}:`, csvPath);
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
            data.push({ month: d.getMonth() + 1, day: d.getDate(), level });
        }
    }

    dataCache[damId] = data;
    console.log(`[dam-history] Loaded ${data.length} data points for ${damId}`);
    return data;
}

/**
 * GET /api/dam-history/:damId
 * 今日の日付を基準に、今日〜90日後の各日について過去全年の平均・最大・最小を返す
 */
router.get('/:damId', (req, res) => {
    const { damId } = req.params;
    const data = loadCsvData(damId);
    if (!data) {
        return res.json({ error: `No historical data for dam: ${damId}` });
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
            result.push({ date: dateString, avg: null, min: null, max: null, count: 0 });
        }
    }

    res.json({ history: result });
});

export default router;

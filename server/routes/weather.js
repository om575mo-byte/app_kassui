import { Router } from 'express';
import { DataAggregator } from '../services/DataAggregator.js';

const router = Router();
const aggregator = new DataAggregator();

/**
 * GET /api/weather/:prefCode?
 * 指定県（または宮城県）の気象予報を取得
 */
router.get('/:prefCode?', async (req, res) => {
    try {
        const prefCode = parseInt(req.params.prefCode) || 401;
        const weather = await aggregator.getWeather(prefCode);
        res.json(weather);
    } catch (error) {
        console.error('気象データ取得エラー:', error);
        res.status(500).json({ error: '気象データの取得に失敗しました' });
    }
});

export default router;

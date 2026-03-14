import { Router } from 'express';
import { WaterLevelScraper } from '../services/WaterLevelScraper.js';
import { CacheManager } from '../services/CacheManager.js';

const router = Router();
const scraper = new WaterLevelScraper();
const cache = new CacheManager(600); // 10分キャッシュ

/**
 * GET /api/water-levels
 * 全水位観測所のデータを取得
 */
router.get('/', async (req, res) => {
    try {
        const cached = cache.get('water-levels');
        if (cached) {
            return res.json(cached);
        }

        const stations = await scraper.fetchAllStations();
        const result = {
            stations,
            count: stations.length,
            lastUpdated: new Date().toISOString(),
        };

        cache.set('water-levels', result);
        res.json(result);
    } catch (error) {
        console.error('水位データ取得エラー:', error);
        res.status(500).json({ error: '水位データの取得に失敗しました' });
    }
});

export default router;

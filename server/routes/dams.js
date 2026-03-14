import { Router } from 'express';
import { DataAggregator } from '../services/DataAggregator.js';
import { TOHOKU_PREFECTURES } from '../services/KawabouApiService.js';

const router = Router();
const aggregator = new DataAggregator();

// サーバー起動時に川の防災情報マスタデータを初期化（非同期・バックグラウンド）
aggregator.initKawabou();

/**
 * GET /api/dams
 * 全ダムデータを取得（従来の宮城県データ + AI予測付き）
 */
router.get('/', async (req, res) => {
    try {
        const data = await aggregator.getAllDams();
        res.json(data);
    } catch (error) {
        console.error('ダムデータ取得エラー:', error);
        res.status(500).json({ error: 'ダムデータの取得に失敗しました' });
    }
});

/**
 * GET /api/dams/tohoku
 * 東北6県 全ダムデータを取得（マップ用: 全ダムのピン表示）
 */
router.get('/tohoku', async (req, res) => {
    try {
        const data = await aggregator.getAllTohokuDams();
        res.json(data);
    } catch (error) {
        console.error('東北ダムデータ取得エラー:', error);
        res.status(500).json({ error: '東北ダムデータの取得に失敗しました' });
    }
});

/**
 * GET /api/dams/pref/:prefCode
 * 指定県のダムデータを取得（サイドバー用: 県別のダムリスト）
 * 例: /api/dams/pref/401 → 宮城県
 */
router.get('/pref/:prefCode', async (req, res) => {
    try {
        const prefCode = parseInt(req.params.prefCode, 10);
        const validPref = TOHOKU_PREFECTURES.find(p => p.code === prefCode);
        if (!validPref) {
            return res.status(400).json({ error: '無効な都道府県コードです', validCodes: TOHOKU_PREFECTURES.map(p => ({ code: p.code, name: p.name })) });
        }
        const data = await aggregator.getDamsByPref(prefCode);
        res.json(data);
    } catch (error) {
        console.error('県別ダムデータ取得エラー:', error);
        res.status(500).json({ error: 'ダムデータの取得に失敗しました' });
    }
});

/**
 * GET /api/dams/prefectures
 * 利用可能な都道府県一覧を返す（フロントエンド用）
 */
router.get('/prefectures', (req, res) => {
    res.json({ prefectures: TOHOKU_PREFECTURES });
});

/**
 * GET /api/dams/summary
 * サマリーのみ取得
 */
router.get('/summary', async (req, res) => {
    try {
        const summary = await aggregator.getSummary();
        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: 'サマリーの取得に失敗しました' });
    }
});

/**
 * GET /api/dams/:id
 * 特定ダムのデータを取得
 */
router.get('/:id', async (req, res) => {
    try {
        const dam = await aggregator.getDamById(req.params.id);
        if (!dam) {
            return res.status(404).json({ error: 'ダムが見つかりません' });
        }
        res.json(dam);
    } catch (error) {
        res.status(500).json({ error: 'データの取得に失敗しました' });
    }
});

export default router;

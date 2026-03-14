/**
 * 宮城県河川流域情報システム ダム現況表スクレイパー
 * データソース: https://www.dobokusougou.pref.miyagi.jp/miyagi/servlet/Gamen42Servlet
 *
 * 取得データ: 貯水位, 貯水量, 空容量, 全流入量, 全放流量, 調整流量,
 *             流域雨量, 累加雨量, 利水貯水率, 有効容量貯水率
 */
import { MIYAGI_DAMS } from '../config/regions/miyagi.js';

// stationNoからダムIDへのマッピング
const STATION_TO_DAM = {};
MIYAGI_DAMS.forEach(dam => {
    if (dam.stationNo) {
        STATION_TO_DAM[dam.stationNo] = dam.id;
    }
});

// ダム名からダムIDへのマッピング（フォールバック用）
const NAME_TO_DAM = {};
MIYAGI_DAMS.forEach(dam => {
    NAME_TO_DAM[dam.name] = dam.id;
});

/**
 * テーブルカラムインデックス定義（12カラム/ダム）
 */
const COLUMNS = {
    DAM_NAME: 0,
    MANAGER: 1,
    WATER_LEVEL: 2,       // 貯水位 (ELm)
    STORAGE_VOLUME: 3,    // 貯水量 (10³m³)
    FREE_CAPACITY: 4,     // 空容量 (10³m³)
    INFLOW_RATE: 5,       // 全流入量 (m³/s)
    OUTFLOW_RATE: 6,      // 全放流量 (m³/s)
    ADJUSTED_FLOW: 7,     // 調整流量 (m³/s)
    HOURLY_RAIN: 8,       // 流域平均雨量 (mm)
    CUMUL_RAIN: 9,        // 累加雨量 (mm)
    USABLE_STORAGE_RATE: 10,   // 貯水率(利水容量) (%)
    EFFECTIVE_STORAGE_RATE: 11, // 貯水率(有効容量) (%)
};
const COLS_PER_DAM = 12;

export class MiyagiDamScraper {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || 'https://www.dobokusougou.pref.miyagi.jp';
        this.listPath = '/miyagi/servlet/Gamen42Servlet';
        this.requestDelay = config.requestDelay || 3000;
        this.lastFetchTime = null;
    }

    /**
     * ダム現況表HTMLを取得・デコード
     */
    async _fetchHtml() {
        // Node 18+ のfetchを使用（グローバル）。node-fetchがあればそちらを使用。
        const fetchFn = globalThis.fetch || (await import('node-fetch')).default;

        const url = `${this.baseUrl}${this.listPath}`;
        const res = await fetchFn(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; DamMonitor/1.0)',
            },
            // SSL証明書の検証を無効化（自治体サーバー用）
            ...(globalThis.fetch ? {} : { agent: null }),
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const buffer = await res.arrayBuffer();
        const decoder = new TextDecoder('shift_jis');
        return decoder.decode(buffer);
    }

    /**
     * HTMLからダムデータを抽出
     * @param {string} html - Shift-JISデコード済みHTML
     * @returns {Map<string, object>} ダム名→データのMap
     */
    _parseHtml(html) {
        const results = new Map();

        // HTML全体の<td>を全て抽出
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const allCells = [];
        let match;
        while ((match = tdRegex.exec(html)) !== null) {
            const text = match[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            allCells.push(text);
        }

        // ダム名マッチで12カラムずつ抽出
        // テーブルが複数ある（県管理 + 国交省管理）ため、
        // 全セルを走査してダム名が見つかったら12カラム分読み取る
        for (let i = 0; i < allCells.length; i++) {
            const cellValue = allCells[i];

            // マスタデータに存在するダム名か確認
            if (!NAME_TO_DAM[cellValue]) continue;

            // 12カラム分のデータが残っているか確認
            if (i + COLS_PER_DAM - 1 >= allCells.length) break;

            // 次のセルが管理区分（県/国）か確認（ヘッダー行との誤マッチ防止）
            const manager = allCells[i + COLUMNS.MANAGER];
            if (manager !== '県' && manager !== '国') continue;

            const damId = NAME_TO_DAM[cellValue];

            results.set(damId, {
                damName: cellValue,
                manager,
                waterLevel: this._parseNumber(allCells[i + COLUMNS.WATER_LEVEL]),
                storageVolume: this._parseNumber(allCells[i + COLUMNS.STORAGE_VOLUME]),
                freeCapacity: this._parseNumber(allCells[i + COLUMNS.FREE_CAPACITY]),
                inflowRate: this._parseNumber(allCells[i + COLUMNS.INFLOW_RATE]),
                outflowRate: this._parseNumber(allCells[i + COLUMNS.OUTFLOW_RATE]),
                adjustedFlow: this._parseNumber(allCells[i + COLUMNS.ADJUSTED_FLOW]),
                hourlyRain: this._parseNumber(allCells[i + COLUMNS.HOURLY_RAIN]),
                cumulRain: this._parseNumber(allCells[i + COLUMNS.CUMUL_RAIN]),
                usableStorageRate: this._parseNumber(allCells[i + COLUMNS.USABLE_STORAGE_RATE]),
                effectiveStorageRate: this._parseNumber(allCells[i + COLUMNS.EFFECTIVE_STORAGE_RATE]),
            });

            // 次のダム名は少なくとも12セル先
            i += COLS_PER_DAM - 1;
        }

        return results;
    }

    /**
     * 文字列を数値に変換（"-" や空文字はnull）
     */
    _parseNumber(str) {
        if (!str) return null;
        // 前後の空白（全角含む）を除去し、特定の記号をチェック
        let s = str.trim().replace(/^[　\s]+|[　\s]+$/g, '');
        if (s === '-' || s === '－' || s === '' || s === '　') return null;
        // カンマを除去
        s = s.replace(/,/g, '');
        const num = parseFloat(s);
        return isNaN(num) ? null : num;
    }

    /**
     * スクレイピング結果をアプリのデータ形式に変換
     * @param {Map<string, object>} scraped - スクレイピング結果
     * @returns {Array} アプリ用ダムデータ配列
     */
    _transformData(scraped) {
        const now = new Date();
        const month = now.getMonth() + 1;
        const isFloodSeason = month >= 6 && month <= 10;

        return MIYAGI_DAMS.map(dam => {
            const liveData = scraped.get(dam.id);

            // 季節に応じた利水容量を選択
            const usableCapacity = isFloodSeason
                ? (dam.usableCapacityFlood ?? null)
                : (dam.usableCapacityNonFlood ?? dam.usableCapacityFlood ?? null);

            if (!liveData) {
                // スクレイピングデータがないダムはnullデータ
                return {
                    ...dam,
                    usableCapacity,
                    storageRate: null,
                    effectiveStorageRate: null,
                    storageVolume: null,
                    inflowRate: null,
                    outflowRate: null,
                    waterLevel: null,
                    adjustedFlow: null,
                    hourlyRain: null,
                    cumulRain: null,
                    freeCapacity: null,
                    // アプリ内部計算値
                    _calcStorageRate: null,
                    dataTimestamp: now.toISOString(),
                    isLiveData: false,
                };
            }

            // サーバー側の利水貯水率を渇水判定に使用
            const storageRate = liveData.usableStorageRate;

            // アプリ内部計算値（利水容量ベース）
            const _calcStorageRate = (liveData.storageVolume !== null && usableCapacity)
                ? Math.round((liveData.storageVolume / usableCapacity) * 1000) / 10
                : null;

            return {
                ...dam,
                usableCapacity,
                // 渇水判定用: サーバー側の利水貯水率
                storageRate,
                // 有効容量貯水率
                effectiveStorageRate: liveData.effectiveStorageRate,
                // リアルタイム計測値
                storageVolume: liveData.storageVolume,
                inflowRate: liveData.inflowRate,
                outflowRate: liveData.outflowRate,
                waterLevel: liveData.waterLevel,
                adjustedFlow: liveData.adjustedFlow,
                hourlyRain: liveData.hourlyRain,
                cumulRain: liveData.cumulRain,
                freeCapacity: liveData.freeCapacity,
                // アプリ内部計算値（参考）
                _calcStorageRate,
                dataTimestamp: now.toISOString(),
                isLiveData: true,
            };
        });
    }

    /**
     * 全ダムのリアルタイムデータを取得
     * @returns {Array} ダムデータ配列
     */
    async fetchAllDams() {
        console.log('📡 宮城県ダム現況表からデータ取得中...');
        const startTime = Date.now();

        const html = await this._fetchHtml();
        const scraped = this._parseHtml(html);

        console.log(`✅ ${scraped.size}ダムのデータを取得 (${Date.now() - startTime}ms)`);
        this.lastFetchTime = new Date();

        return this._transformData(scraped);
    }
}

import * as cheerio from 'cheerio';

/**
 * 川渡アメダスの気象データスクレイパー
 * 気象庁「過去の気象データ検索」から降水量・気温・積雪深・降雪量を取得
 * 
 * URL: https://www.data.jma.go.jp/stats/etrn/view/daily_h1.php
 * params: prec_no=34 (宮城県), block_no=00 (川渡)
 * view: p1=降水量, p2=平均気温, p9=最深積雪, p7=積雪差合計(≒降雪量)
 */

const BASE_URL = 'https://www.data.jma.go.jp/stats/etrn/view/daily_h1.php';
const PREC_NO = '34';   // 宮城県
const BLOCK_NO = '00';  // 川渡

// 各ビューと川渡の列位置（table#tablefix1 内の td の順序）
const VIEWS = {
    precipitation: { view: 'p1', colIndex: 1 },  // 降水量合計(mm)
    avgTemp: { view: 'p2', colIndex: 1 },  // 平均気温(℃)
    snowDepth: { view: 'p9', colIndex: 1 },  // 最深積雪(cm)
    snowfall: { view: 'p7', colIndex: 1 },  // 積雪差合計≒降雪量(cm)
};

export class KawatabiWeatherScraper {
    constructor() {
        this.cache = null;
        this.cacheExpiry = null;
        this.cacheTTL = 6 * 60 * 60 * 1000; // 6時間
    }

    /**
     * 気象庁のページから1ヶ月分のデータを取得
     * @param {number} year
     * @param {number} month
     * @param {string} view - p1, p2, p7, p9
     * @param {number} colIndex - 川渡の列インデックス（0始まり、日を除いた列）
     * @returns {Map<string, number|null>} 日付文字列→値のMap
     */
    async _fetchMonthlyData(year, month, view, colIndex) {
        const url = `${BASE_URL}?prec_no=${PREC_NO}&block_no=${BLOCK_NO}&year=${year}&month=${month}&day=&view=${view}`;
        const results = new Map();

        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`[KawatabiScraper] HTTP error ${response.status} for ${url}`);
                return results;
            }

            const html = await response.text();
            const $ = cheerio.load(html);

            // table#tablefix1 内の全行を走査
            const rows = $('table#tablefix1 tr.mtx');
            rows.each((_, row) => {
                const cells = $(row).find('td');
                if (cells.length === 0) return;

                // 1列目が日（数値）
                const dayText = $(cells[0]).text().trim();
                const day = parseInt(dayText);
                if (isNaN(day) || day < 1 || day > 31) return;

                // 川渡の列（colIndex列目）の値を取得
                const valueCell = cells[colIndex];
                if (!valueCell) return;

                let valueText = $(valueCell).text().trim();
                // 品質情報の記号（), ], * 等）を除去し数値のみ抽出
                valueText = valueText.replace(/[)\]]/g, '').replace(/\s+/g, '').trim();

                let value = null;
                if (valueText === '--' || valueText === '×' || valueText === '' || valueText === '///') {
                    value = null; // 欠測
                } else {
                    const parsed = parseFloat(valueText);
                    value = isNaN(parsed) ? null : parsed;
                }

                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                results.set(dateStr, value);
            });

            console.log(`[KawatabiScraper] ${view}: ${year}/${month} → ${results.size}日分取得`);
        } catch (error) {
            console.error(`[KawatabiScraper] Fetch error for ${view} ${year}/${month}:`, error.message);
        }

        return results;
    }

    /**
     * 直近N日間のデータを取得するため、当月+前月のデータを結合
     * @param {string} view
     * @param {number} colIndex
     * @returns {Map<string, number|null>}
     */
    async _fetchRecentData(view, colIndex) {
        const now = new Date();
        const thisYear = now.getFullYear();
        const thisMonth = now.getMonth() + 1;

        // 前月
        const prevDate = new Date(now);
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevYear = prevDate.getFullYear();
        const prevMonth = prevDate.getMonth() + 1;

        const [thisMonthData, prevMonthData] = await Promise.all([
            this._fetchMonthlyData(thisYear, thisMonth, view, colIndex),
            this._fetchMonthlyData(prevYear, prevMonth, view, colIndex),
        ]);

        // 結合（前月 + 当月）
        const combined = new Map([...prevMonthData, ...thisMonthData]);
        return combined;
    }

    /**
     * 直近N日間の値の配列を返す（日付降順→昇順にソートして最新N日分）
     */
    _getRecentValues(dataMap, days) {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        const values = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const val = dataMap.get(dateStr);
            if (val !== null && val !== undefined) {
                values.push(val);
            }
        }
        return values;
    }

    /**
     * 全気象データを取得し、AIモデルの特徴量として整形して返す
     * @returns {object} 特徴量オブジェクト
     */
    async fetchWeatherFeatures() {
        // キャッシュチェック
        if (this.cache && this.cacheExpiry && Date.now() < this.cacheExpiry) {
            console.log('[KawatabiScraper] キャッシュから返却');
            return this.cache;
        }

        console.log('[KawatabiScraper] 川渡アメダスデータ取得開始...');

        try {
            const [precipData, tempData, snowDepthData, snowfallData] = await Promise.all([
                this._fetchRecentData(VIEWS.precipitation.view, VIEWS.precipitation.colIndex),
                this._fetchRecentData(VIEWS.avgTemp.view, VIEWS.avgTemp.colIndex),
                this._fetchRecentData(VIEWS.snowDepth.view, VIEWS.snowDepth.colIndex),
                this._fetchRecentData(VIEWS.snowfall.view, VIEWS.snowfall.colIndex),
            ]);

            // 当日の値（当月の最新日のデータ。まだ更新されていなければ前日）
            const todayPrecipValues = this._getRecentValues(precipData, 1);
            const todayTempValues = this._getRecentValues(tempData, 1);
            const todaySnowDepthValues = this._getRecentValues(snowDepthData, 1);
            const todaySnowfallValues = this._getRecentValues(snowfallData, 1);

            // 集計特徴量
            const precip7d = this._getRecentValues(precipData, 7);
            const precip30d = this._getRecentValues(precipData, 30);
            const temp7d = this._getRecentValues(tempData, 7);
            const snowDepth30d = this._getRecentValues(snowDepthData, 30);
            const snowfall7d = this._getRecentValues(snowfallData, 7);

            const result = {
                precipitation: todayPrecipValues[0] ?? 0,
                avgTemp: todayTempValues[0] ?? 4.0,
                snowDepth: todaySnowDepthValues[0] ?? 0,
                snowfall: todaySnowfallValues[0] ?? 0,
                precip7dSum: precip7d.length > 0 ? precip7d.reduce((a, b) => a + b, 0) : 20,
                precip30dSum: precip30d.length > 0 ? precip30d.reduce((a, b) => a + b, 0) : 80,
                temp7dAvg: temp7d.length > 0 ? temp7d.reduce((a, b) => a + b, 0) / temp7d.length : 4.0,
                snowDepth30dAvg: snowDepth30d.length > 0 ? snowDepth30d.reduce((a, b) => a + b, 0) / snowDepth30d.length : 0,
                snowfall7dSum: snowfall7d.length > 0 ? snowfall7d.reduce((a, b) => a + b, 0) : 0,
                dataPoints: {
                    precip: precip30d.length,
                    temp: temp7d.length,
                    snowDepth: snowDepth30d.length,
                    snowfall: snowfall7d.length,
                },
                fetchedAt: new Date().toISOString(),
            };

            console.log(`[KawatabiScraper] ✅ 取得完了: 積雪深=${result.snowDepth}cm, 降雪量=${result.snowfall}cm, 降水量=${result.precipitation}mm, 気温=${result.avgTemp}℃`);
            console.log(`[KawatabiScraper]    集計: Precip_7d=${result.precip7dSum}mm, SnowDepth_30d_avg=${result.snowDepth30dAvg.toFixed(1)}cm, Snowfall_7d=${result.snowfall7dSum}cm`);

            // キャッシュに保存
            this.cache = result;
            this.cacheExpiry = Date.now() + this.cacheTTL;

            return result;
        } catch (error) {
            console.error('[KawatabiScraper] ❌ データ取得エラー:', error.message);
            // フォールバック値を返す
            return this._getFallbackValues();
        }
    }

    /**
     * フォールバック値（スクレイピング失敗時）
     */
    _getFallbackValues() {
        const month = new Date().getMonth() + 1;
        // 季節に応じた典型的な値
        const isWinter = month >= 11 || month <= 3;
        return {
            precipitation: 0,
            avgTemp: isWinter ? 0 : 15,
            snowDepth: isWinter ? 30 : 0,
            snowfall: isWinter ? 5 : 0,
            precip7dSum: 20,
            precip30dSum: 80,
            temp7dAvg: isWinter ? 0 : 15,
            snowDepth30dAvg: isWinter ? 30 : 0,
            snowfall7dSum: isWinter ? 30 : 0,
            dataPoints: { precip: 0, temp: 0, snowDepth: 0, snowfall: 0 },
            fetchedAt: new Date().toISOString(),
            isFallback: true,
        };
    }
}

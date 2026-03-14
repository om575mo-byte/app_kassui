import * as cheerio from 'cheerio';

/**
 * 新川（Nikkawa）アメダスの気象データスクレイパー（大倉ダム用）
 * 
 * prec_no=34 (宮城県)
 * block_no=0300 (新川) - 過去データURL(例: /stats/etrn/view/daily_a1.php?prec_no=34&block_no=0300&year=2023&month=1&day=&view=)より推測
 * 
 * アメダス(daily_a1.php)の列構成 (例):
 * 日, 降水量合計, 最大1時間, 最大10分, 平均気温, 最高, 最低, 平均風速, 最大風速, 最大風向, 最大瞬間風速, 最大瞬間風向, 最多風向, 日照時間, 降雪量合計, 最深積雪
 * 
 * col1: 降水量合計
 * col4: 平均気温
 * col14: 降雪量合計
 * col15: 最深積雪
 */

const BASE_URL = 'https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php';
const PREC_NO = '34';       // 宮城県
const BLOCK_NO = '0251';    // 新川

const VIEWS = {
    precipitation: { colIndex: 1 }, // 降水量合計
    avgTemp: { colIndex: 4 },       // 平均気温
    snowfall: { colIndex: 14 },     // 降雪量合計
    snowDepth: { colIndex: 15 },    // 最深積雪
};

export class NikkawaWeatherScraper {
    constructor() {
        this.cache = null;
        this.cacheExpiry = null;
        this.cacheTTL = 6 * 60 * 60 * 1000; // 6時間
    }

    async _fetchMonthlyData(year, month) {
        const url = `${BASE_URL}?prec_no=${PREC_NO}&block_no=${BLOCK_NO}&year=${year}&month=${month}&day=&view=`;
        const results = new Map();

        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`[NikkawaScraper] HTTP error ${response.status}`);
                return results;
            }

            const html = await response.text();
            const $ = cheerio.load(html);

            const rows = $('table#tablefix1 tr.mtx');
            rows.each((_, row) => {
                const cells = $(row).find('td');
                if (cells.length === 0) return;

                const dayText = $(cells[0]).text().trim();
                const day = parseInt(dayText);
                if (isNaN(day) || day < 1 || day > 31) return;

                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                const record = {};
                for (const [key, conf] of Object.entries(VIEWS)) {
                    const cell = cells[conf.colIndex];
                    if (!cell) {
                        record[key] = null;
                        continue;
                    }
                    let txt = $(cell).text().trim().replace(/[)\]]/g, '').replace(/\s+/g, '').trim();
                    if (txt === '--' || txt === '×' || txt === '' || txt === '///') {
                        record[key] = null;
                    } else {
                        const v = parseFloat(txt);
                        record[key] = isNaN(v) ? null : v;
                    }
                }

                // 積雪深・降雪量がnullの場合、夏場などは0と見なす
                if (record.snowDepth === null) record.snowDepth = 0;
                if (record.snowfall === null) record.snowfall = 0;
                if (record.precipitation === null) record.precipitation = 0;

                results.set(dateStr, record);
            });

            console.log(`[NikkawaScraper] ${year}/${month} -> ${results.size} days`);
        } catch (error) {
            console.error(`[NikkawaScraper] Fetch error ${year}/${month}:`, error.message);
        }

        return results;
    }

    _getRecentValues(dataMap, key, days) {
        const today = new Date();
        const values = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const record = dataMap.get(dateStr);
            if (record && record[key] !== null && record[key] !== undefined) {
                values.push(record[key]);
            }
        }
        return values;
    }

    async fetchWeatherFeatures() {
        if (this.cache && this.cacheExpiry && Date.now() < this.cacheExpiry) {
            console.log('[NikkawaScraper] cache hit');
            return this.cache;
        }

        console.log('[NikkawaScraper] fetching Nikkawa weather data...');

        try {
            const now = new Date();
            const thisYear = now.getFullYear(), thisMonth = now.getMonth() + 1;
            const prevDate = new Date(now);
            prevDate.setMonth(prevDate.getMonth() - 1);
            const prevYear = prevDate.getFullYear(), prevMonth = prevDate.getMonth() + 1;

            const [thisMonthData, prevMonthData] = await Promise.all([
                this._fetchMonthlyData(thisYear, thisMonth),
                this._fetchMonthlyData(prevYear, prevMonth),
            ]);

            const combined = new Map([...prevMonthData, ...thisMonthData]);

            const todayPrecip = this._getRecentValues(combined, 'precipitation', 1);
            const todayTemp = this._getRecentValues(combined, 'avgTemp', 1);
            const todaySnowDepth = this._getRecentValues(combined, 'snowDepth', 1);
            const todaySnowfall = this._getRecentValues(combined, 'snowfall', 1);

            const precip7d = this._getRecentValues(combined, 'precipitation', 7);
            const precip30d = this._getRecentValues(combined, 'precipitation', 30);
            const temp7d = this._getRecentValues(combined, 'avgTemp', 7);
            const snowDepth30d = this._getRecentValues(combined, 'snowDepth', 30);
            const snowfall7d = this._getRecentValues(combined, 'snowfall', 7);

            const result = {
                precipitation: todayPrecip[0] ?? 0,
                avgTemp: todayTemp[0] ?? 4.0,  // 新川は山間部なので少し低めをデフォに
                snowDepth: todaySnowDepth[0] ?? 0,
                snowfall: todaySnowfall[0] ?? 0,
                precip7dSum: precip7d.length > 0 ? precip7d.reduce((a, b) => a + b, 0) : 20,
                precip30dSum: precip30d.length > 0 ? precip30d.reduce((a, b) => a + b, 0) : 80,
                temp7dAvg: temp7d.length > 0 ? temp7d.reduce((a, b) => a + b, 0) / temp7d.length : 4.0,
                snowDepth30dAvg: snowDepth30d.length > 0 ? snowDepth30d.reduce((a, b) => a + b, 0) / snowDepth30d.length : 0,
                snowfall7dSum: snowfall7d.length > 0 ? snowfall7d.reduce((a, b) => a + b, 0) : 0,
                fetchedAt: new Date().toISOString(),
            };

            console.log(`[NikkawaScraper] OK: precip=${result.precipitation}mm, temp=${result.avgTemp}C, snow=${result.snowDepth}cm`);
            console.log(`[NikkawaScraper]    Precip_7d=${result.precip7dSum}mm, SnowDepth_30d=${result.snowDepth30dAvg.toFixed(1)}cm`);

            this.cache = result;
            this.cacheExpiry = Date.now() + this.cacheTTL;
            return result;
        } catch (error) {
            console.error('[NikkawaScraper] error:', error.message);
            return this._getFallbackValues();
        }
    }

    _getFallbackValues() {
        const month = new Date().getMonth() + 1;
        const isWinter = month >= 11 || month <= 4;
        return {
            precipitation: 0, avgTemp: isWinter ? 1 : 12,
            snowDepth: isWinter ? 15 : 0, snowfall: isWinter ? 3 : 0,
            precip7dSum: 20, precip30dSum: 80,
            temp7dAvg: isWinter ? 1 : 12,
            snowDepth30dAvg: isWinter ? 10 : 0,
            snowfall7dSum: isWinter ? 15 : 0,
            fetchedAt: new Date().toISOString(), isFallback: true,
        };
    }
}

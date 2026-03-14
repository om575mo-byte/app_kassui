import * as cheerio from 'cheerio';

/**
 * 仙台アメダスの気象データスクレイパー（釜房ダム用）
 * 川渡スクレイパーと同じ構造で、仙台観測所のデータを取得する。
 * 
 * 仙台: prec_no=34 (宮城県), block_no=47590 (仙台)
 * view: s1=降水量, s1=平均気温（気象台なので daily_s1.php）
 */

const BASE_URL = 'https://www.data.jma.go.jp/stats/etrn/view/daily_s1.php';
const PREC_NO = '34';       // 宮城県
const BLOCK_NO = '47590';   // 仙台（気象台）

// 仙台は気象台（daily_s1）なので列位置が川渡（アメダス daily_h1）とは異なる
// daily_s1: 降水量合計=col8, 平均気温=col11, 最深積雪=col18, 降雪合計=col17
const VIEWS = {
    precipitation: { view: 's1', colIndex: 8 },   // 降水量合計(mm)
    avgTemp: { view: 's1', colIndex: 11 },   // 平均気温(℃)
    snowDepth: { view: 's1', colIndex: 18 },   // 最深積雪(cm)
    snowfall: { view: 's1', colIndex: 17 },   // 降雪合計(cm)
};

export class SendaiWeatherScraper {
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
                console.error(`[SendaiScraper] HTTP error ${response.status}`);
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
                results.set(dateStr, record);
            });

            console.log(`[SendaiScraper] ${year}/${month} -> ${results.size} days`);
        } catch (error) {
            console.error(`[SendaiScraper] Fetch error ${year}/${month}:`, error.message);
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
            console.log('[SendaiScraper] cache hit');
            return this.cache;
        }

        console.log('[SendaiScraper] fetching Sendai weather data...');

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
                avgTemp: todayTemp[0] ?? 4.0,
                snowDepth: todaySnowDepth[0] ?? 0,
                snowfall: todaySnowfall[0] ?? 0,
                precip7dSum: precip7d.length > 0 ? precip7d.reduce((a, b) => a + b, 0) : 20,
                precip30dSum: precip30d.length > 0 ? precip30d.reduce((a, b) => a + b, 0) : 80,
                temp7dAvg: temp7d.length > 0 ? temp7d.reduce((a, b) => a + b, 0) / temp7d.length : 4.0,
                snowDepth30dAvg: snowDepth30d.length > 0 ? snowDepth30d.reduce((a, b) => a + b, 0) / snowDepth30d.length : 0,
                snowfall7dSum: snowfall7d.length > 0 ? snowfall7d.reduce((a, b) => a + b, 0) : 0,
                fetchedAt: new Date().toISOString(),
            };

            console.log(`[SendaiScraper] OK: precip=${result.precipitation}mm, temp=${result.avgTemp}C, snow=${result.snowDepth}cm`);
            console.log(`[SendaiScraper]    Precip_7d=${result.precip7dSum}mm, SnowDepth_30d=${result.snowDepth30dAvg.toFixed(1)}cm`);

            this.cache = result;
            this.cacheExpiry = Date.now() + this.cacheTTL;
            return result;
        } catch (error) {
            console.error('[SendaiScraper] error:', error.message);
            return this._getFallbackValues();
        }
    }

    _getFallbackValues() {
        const month = new Date().getMonth() + 1;
        const isWinter = month >= 11 || month <= 3;
        return {
            precipitation: 0, avgTemp: isWinter ? 2 : 15,
            snowDepth: isWinter ? 5 : 0, snowfall: isWinter ? 2 : 0,
            precip7dSum: 20, precip30dSum: 80,
            temp7dAvg: isWinter ? 2 : 15,
            snowDepth30dAvg: isWinter ? 5 : 0,
            snowfall7dSum: isWinter ? 10 : 0,
            fetchedAt: new Date().toISOString(), isFallback: true,
        };
    }
}

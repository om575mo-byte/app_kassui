import * as cheerio from 'cheerio';

/**
 * 胆沢ダム用 気象データスクレイパー (北上と湯田の平均値を算出)
 * 北上: prec_no=33, block_no=0411 (daily_a1.php)
 * 湯田: prec_no=33, block_no=0171 (daily_a1.php)
 */

const BASE_URL_A1 = 'https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php';
// 北上有人の場合は daily_s1.php の可能性もあるが、アメダスの場合は a1
const PREC_NO = '33'; // 岩手県
const STATIONS = {
    kitakami: { name: '北上', block_no: '0230' },
    yuda: { name: '湯田', block_no: '0229' }
};

// daily_a1.php の列インデックス。降水, 気温, 降雪, 積雪
const VIEWS = {
    precipitation: { colIndex: 1 }, // 降水量合計
    avgTemp: { colIndex: 4 },       // 平均気温
    snowfall: { colIndex: 14 },     // 降雪量合計
    snowDepth: { colIndex: 15 },    // 最深積雪
};

export class IsawaWeatherScraper {
    constructor() {
        this.cache = null;
        this.cacheExpiry = null;
        this.cacheTTL = 6 * 60 * 60 * 1000; // 6時間
    }

    async _fetchMonthlyData(blockNo, year, month) {
        const url = `${BASE_URL_A1}?prec_no=${PREC_NO}&block_no=${blockNo}&year=${year}&month=${month}&day=&view=`;
        const results = new Map();

        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`[IsawaScraper] HTTP error ${response.status} for block_no=${blockNo}`);
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
                
                // ページの列数が20未満の場合は daily_h1 の可能性などがあるが、まずは a1 の前提
                const isShortFormat = cells.length < 10;
                // daily_h1.php の場合の列位置フォールバックは省略し、a1専用とする
                
                const record = {};
                for (const [key, conf] of Object.entries(VIEWS)) {
                    let cell = cells[conf.colIndex];
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

                if (record.snowDepth === null) record.snowDepth = 0;
                if (record.snowfall === null) record.snowfall = 0;
                if (record.precipitation === null) record.precipitation = 0;

                results.set(dateStr, record);
            });
            console.log(`[IsawaScraper] block_no=${blockNo} ${year}/${month} -> ${results.size} days`);
        } catch (error) {
            console.error(`[IsawaScraper] Fetch error block_no=${blockNo} ${year}/${month}:`, error.message);
        }
        return results;
    }

    async _fetchRecentDataForStation(blockNo) {
        const now = new Date();
        const thisYear = now.getFullYear(), thisMonth = now.getMonth() + 1;
        const prevDate = new Date(now);
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevYear = prevDate.getFullYear(), prevMonth = prevDate.getMonth() + 1;

        const [thisMonthData, prevMonthData] = await Promise.all([
            this._fetchMonthlyData(blockNo, thisYear, thisMonth),
            this._fetchMonthlyData(blockNo, prevYear, prevMonth)
        ]);
        return new Map([...prevMonthData, ...thisMonthData]);
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
            return this.cache;
        }

        console.log('[IsawaScraper] fetching Isawa(Kitakami & Yuda) weather data...');

        try {
            const [kitakamiMap, yudaMap] = await Promise.all([
                this._fetchRecentDataForStation(STATIONS.kitakami.block_no),
                this._fetchRecentDataForStation(STATIONS.yuda.block_no)
            ]);

            // 北上と湯田の平均値を取る
            const mergedMap = new Map();
            for (const [dateStr, kRecord] of kitakamiMap.entries()) {
                const yRecord = yudaMap.get(dateStr);
                const record = {};
                for (const key of Object.keys(VIEWS)) {
                    const kv = kRecord[key];
                    const yv = yRecord ? yRecord[key] : null;
                    if (kv !== null && yv !== null) record[key] = (kv + yv) / 2;
                    else if (kv !== null) record[key] = kv;
                    else if (yv !== null) record[key] = yv;
                    else record[key] = null;
                }
                mergedMap.set(dateStr, record);
            }

            const todayPrecip = this._getRecentValues(mergedMap, 'precipitation', 1);
            const todayTemp = this._getRecentValues(mergedMap, 'avgTemp', 1);
            const todaySnowDepth = this._getRecentValues(mergedMap, 'snowDepth', 1);
            const todaySnowfall = this._getRecentValues(mergedMap, 'snowfall', 1);

            const precip7d = this._getRecentValues(mergedMap, 'precipitation', 7);
            const precip30d = this._getRecentValues(mergedMap, 'precipitation', 30);
            const temp7d = this._getRecentValues(mergedMap, 'avgTemp', 7);
            const snowDepth30d = this._getRecentValues(mergedMap, 'snowDepth', 30);
            const snowfall7d = this._getRecentValues(mergedMap, 'snowfall', 7);

            const result = {
                precipitation: todayPrecip[0] ?? 0,
                avgTemp: todayTemp[0] ?? 5.0,
                snowDepth: todaySnowDepth[0] ?? 0,
                snowfall: todaySnowfall[0] ?? 0,
                precip7dSum: precip7d.length > 0 ? precip7d.reduce((a, b) => a + b, 0) : 15,
                precip30dSum: precip30d.length > 0 ? precip30d.reduce((a, b) => a + b, 0) : 60,
                temp7dAvg: temp7d.length > 0 ? temp7d.reduce((a, b) => a + b, 0) / temp7d.length : 5.0,
                snowDepth30dAvg: snowDepth30d.length > 0 ? snowDepth30d.reduce((a, b) => a + b, 0) / snowDepth30d.length : 0,
                snowfall7dSum: snowfall7d.length > 0 ? snowfall7d.reduce((a, b) => a + b, 0) : 0,
                fetchedAt: new Date().toISOString(),
            };

            this.cache = result;
            this.cacheExpiry = Date.now() + this.cacheTTL;
            return result;
        } catch (error) {
            console.error('[IsawaScraper] error:', error.message);
            return this._getFallbackValues();
        }
    }

    _getFallbackValues() {
        return {
            precipitation: 0, avgTemp: 5.0, snowDepth: 10, snowfall: 0,
            precip7dSum: 15, precip30dSum: 60, temp7dAvg: 4.5,
            snowDepth30dAvg: 12, snowfall7dSum: 5,
            isFallback: true, fetchedAt: new Date().toISOString()
        };
    }
}

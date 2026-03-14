/**
 * 宮城県 水位観測所スクレイパー
 * 水文水質データベース (www1.river.go.jp) から
 * 各観測所のリアルタイム水位データを取得する。
 *
 * データ取得フロー:
 *   1. DspWaterData.exe で観測所ページにアクセス
 *   2. iframe URL を抽出
 *   3. iframe 内のHTMLテーブルから10分間隔の水位データを取得
 *   4. 最新行（最上行）の水位を抽出
 *
 * HTMLテーブル構造 (iframe内):
 *   <TR>
 *     <TD>2026/02/22</TD>   ← 日付
 *     <TD>00:30</TD>        ← 時刻
 *     <TD><FONT color="#0000ff">-0.07</FONT></TD> ← 水位(m)
 *   </TR>
 */
import { MIYAGI_STATIONS } from '../config/regions/miyagi_stations.js';

export class WaterLevelScraper {
    constructor() {
        this.baseUrl = 'https://www1.river.go.jp/cgi-bin/DspWaterData.exe';
        this.lastFetchTime = null;
    }

    /**
     * 全観測所の最新水位データを取得
     * @returns {Array} 水位データ配列
     */
    async fetchAllStations() {
        console.log('📡 水文水質DBから水位データ取得中...');
        const startTime = Date.now();

        const results = await Promise.all(
            MIYAGI_STATIONS.map(station => this._fetchStation(station))
        );

        const liveCount = results.filter(r => r.isLiveData).length;
        console.log(`✅ ${liveCount}/${results.length}観測所のデータを取得 (${Date.now() - startTime}ms)`);
        this.lastFetchTime = new Date();
        return results;
    }

    /**
     * 個別観測所のデータを取得
     */
    async _fetchStation(station) {
        try {
            const { default: fetch } = await import('node-fetch');

            // Step 1: メインページからiframe URLを取得
            const mainUrl = `${this.baseUrl}?KIND=9&ID=${station.waterDbId}`;
            const mainRes = await fetch(mainUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 10000,
            });
            const mainHtml = await mainRes.text();

            // iframe URLを抽出
            const iframeMatch = mainHtml.match(/src="([^"]*WaterFree[^"]*)"/i);
            if (!iframeMatch) {
                throw new Error('iframe URL not found');
            }

            // Step 2: iframe内の水位テーブルデータを取得
            const iframeUrl = `https://www1.river.go.jp${iframeMatch[1]}`;
            const iframeRes = await fetch(iframeUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 10000,
            });
            const iframeHtml = await iframeRes.text();

            return this._parseIframeData(iframeHtml, station);
        } catch (err) {
            console.warn(`⚠ ${station.name} データ取得失敗: ${err.message}`);
            return this._createFallbackData(station);
        }
    }

    /**
     * iframe内HTMLテーブルから最新の水位データを抽出
     *
     * テーブル行は新しい順に並んでいる。
     * 各行: 日付 | 時刻 | 水位(m)
     * 水位は <FONT> タグ内に格納、"−" は欠測を示す。
     */
    _parseIframeData(html, station) {
        let waterLevel = null;
        let observedAt = null;

        // テーブル行から水位データを抽出
        // パターン: 日付(YYYY/MM/DD) + 時刻(HH:MM) + 水位(数値 or '-')
        const rowPattern = /<TR>\s*<TD[^>]*>(\d{4}\/\d{2}\/\d{2})<\/TD>\s*<TD[^>]*>([\d:]+)<\/TD>\s*<TD[^>]*>(?:<FONT[^>]*>)?([-\d.]+|-)(?:<\/FONT>)?<\/TD>\s*<\/TR>/gi;

        let match;
        while ((match = rowPattern.exec(html)) !== null) {
            const dateStr = match[1];
            const timeStr = match[2];
            const valueStr = match[3].trim();

            // 最初の有効な水位データ（最新）を取得
            if (valueStr !== '-' && valueStr !== '') {
                const val = parseFloat(valueStr);
                if (!isNaN(val)) {
                    waterLevel = val;
                    observedAt = `${dateStr} ${timeStr}`;
                    break; // 最新のデータが見つかった
                }
            }
        }

        const droughtFlow = station.droughtFlow ?? station.normalFlow;

        return {
            id: station.id,
            name: station.name,
            river: station.river,
            waterSystem: station.waterSystem,
            lat: station.lat,
            lng: station.lng,
            waterLevel,
            observedAt,
            normalFlow: station.normalFlow,
            droughtFlow,
            isLiveData: waterLevel !== null,
            lastUpdated: new Date().toISOString(),
        };
    }

    /**
     * フォールバック用データ
     */
    _createFallbackData(station) {
        const droughtFlow = station.droughtFlow ?? station.normalFlow;
        return {
            id: station.id,
            name: station.name,
            river: station.river,
            waterSystem: station.waterSystem,
            lat: station.lat,
            lng: station.lng,
            waterLevel: null,
            observedAt: null,
            normalFlow: station.normalFlow,
            droughtFlow,
            isLiveData: false,
            lastUpdated: new Date().toISOString(),
        };
    }
}

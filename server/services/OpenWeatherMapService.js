/**
 * OpenWeatherMap One Call API 3.0 サービス
 * 
 * セキュリティ要件:
 *   - APIキーは .env ファイルから process.env 経由で読み込む
 *   - ソースコードへのハードコーディング厳禁
 * 
 * API利用制限対策:
 *   - 6時間のメモリキャッシュにより、1日最大4回のAPIコールに抑制
 *   - 無料枠 (1,000回/日) を安全に守る設計
 * 
 * フォールバック:
 *   - APIキー未設定・APIエラー時は null を返し、
 *     呼び出し元が気象庁の疑似予報にフォールバックする
 */

// 川渡アメダス付近の緯度・経度（鳴子ダム集水域）
const LAT = 38.74;
const LON = 140.71;

// キャッシュ有効期限: 6時間 (ミリ秒)
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export class OpenWeatherMapService {
    constructor() {
        this._cacheMap = new Map(); // 地点ごとのキャッシュ (key: 'lat,lon')
    }

    /**
     * APIキーが設定されているかチェック
     * @returns {boolean}
     */
    isConfigured() {
        return !!(process.env.OPENWEATHERMAP_API_KEY && process.env.OPENWEATHERMAP_API_KEY.trim());
    }

    /**
     * OpenWeatherMap One Call API 3.0 から7日間の予報を取得し、
     * AI特徴量として必要な値を返す
     * 
     * @param {number} [lat=38.74] - 緯度（デフォルト: 鳴子ダム付近）
     * @param {number} [lon=140.71] - 経度（デフォルト: 鳴子ダム付近）
     * @returns {Promise<{Forecast_Precip_7d_sum: number, Forecast_Temp_7d_avg: number} | null>}
     *   成功時: 予報値オブジェクト、失敗時: null
     */
    async fetchForecast(lat = LAT, lon = LON) {
        // APIキーが未設定の場合はスキップ（フォールバックへ）
        if (!this.isConfigured()) {
            console.log('[OWM] APIキー未設定 → フォールバックを使用');
            return null;
        }

        // 地点ごとのキャッシュチェック
        const cacheKey = `${lat},${lon}`;
        const cached = this._cacheMap.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
            console.log(`[OWM] キャッシュヒット (${cacheKey}, 残り${Math.round((cached.expiry - Date.now()) / 60000)}分)`);
            return cached.data;
        }

        const apiKey = process.env.OPENWEATHERMAP_API_KEY.trim();
        const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,hourly,alerts&units=metric&appid=${apiKey}`;

        try {
            console.log('[OWM] One Call API 3.0 にリクエスト送信...');
            const response = await fetch(url);

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                console.error(`[OWM] API エラー: ${response.status} ${response.statusText} - ${errorText}`);
                return null;
            }

            const data = await response.json();

            if (!data.daily || data.daily.length < 2) {
                console.error('[OWM] レスポンスに daily データが不足');
                return null;
            }

            // daily[0] は今日、daily[1]〜daily[7] が明日以降7日間
            // 向こう7日間（明日〜7日後）の降水量合計と平均気温を計算
            const forecastDays = data.daily.slice(1, 8); // 最大7日分
            let totalPrecip = 0;
            let totalTemp = 0;
            let dayCount = 0;

            for (const day of forecastDays) {
                // 降水量: rain (mm) が存在すればそれを使用、なければ 0
                const rain = day.rain || 0;
                // 降雪量: snow (mm水当量) も加算（融雪を考慮）
                const snow = day.snow || 0;
                totalPrecip += rain + snow;

                // 気温: day.temp.day（日中平均気温）を使用
                if (day.temp && typeof day.temp.day === 'number') {
                    totalTemp += day.temp.day;
                    dayCount++;
                }
            }

            const forecastList = forecastDays.map(day => {
                const dateObj = new Date(day.dt * 1000);
                const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                const dd = String(dateObj.getDate()).padStart(2, '0');
                const weatherStr = (day.weather && day.weather[0]) ? day.weather[0].main : 'Clear';

                // OWMの天気をJMAライクなアイコンコードと文字列にマッピング
                const weatherMap = {
                    'Clear': '晴',
                    'Clouds': '曇',
                    'Rain': '雨',
                    'Snow': '雪',
                    'Drizzle': '雨',
                    'Thunderstorm': '雷雨'
                };

                let iconCode = '100'; // 晴
                if (weatherStr === 'Clouds') iconCode = '200';
                else if (['Rain', 'Drizzle', 'Extreme', 'Thunderstorm'].includes(weatherStr)) iconCode = '300';
                else if (weatherStr === 'Snow') iconCode = '400';

                return {
                    date: `${mm}/${dd}`,
                    weather: weatherMap[weatherStr] || '晴',
                    icon: iconCode,
                    tempMin: day.temp && day.temp.min !== undefined ? Math.round(day.temp.min) : null,
                    tempMax: day.temp && day.temp.max !== undefined ? Math.round(day.temp.max) : null,
                    precip: Math.round((day.rain || 0) + (day.snow || 0)),
                    pop: day.pop !== undefined ? Math.round(day.pop * 100) : 0
                };
            });

            const result = {
                Forecast_Precip_7d_sum: Math.round(totalPrecip * 10) / 10,
                Forecast_Temp_7d_avg: dayCount > 0 ? Math.round((totalTemp / dayCount) * 10) / 10 : null,
                forecast: forecastList
            };

            console.log(`[OWM] OK (${lat},${lon}) -> Precip_7d=${result.Forecast_Precip_7d_sum}mm, Temp_7d=${result.Forecast_Temp_7d_avg}C`);

            // 地点ごとにキャッシュ保存（6時間）
            this._cacheMap.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL_MS });

            return result;

        } catch (error) {
            console.error(`[OWM] 通信エラー: ${error.message}`);
            return null;
        }
    }
}

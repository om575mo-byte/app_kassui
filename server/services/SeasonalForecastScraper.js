/**
 * 気象庁1ヶ月予報スクレイパー（東北地方）
 * 
 * API: https://www.jma.go.jp/bosai/season/data/P1M/010200.json
 * 更新頻度: 毎週木曜日 14:30
 * 
 * 降水量・気温の3階級確率（below/normal/above）を取得し、
 * AIモデルの特徴量としてそのまま渡す。
 */

export class SeasonalForecastScraper {
    constructor() {
        this.cache = null;
        this.cacheExpiry = null;
        this.cacheTTL = 24 * 60 * 60 * 1000; // 24時間（予報更新は週1回）
        this.apiUrl = 'https://www.jma.go.jp/bosai/season/data/P1M/010200.json';
    }

    async fetchSeasonalForecast() {
        if (this.cache && this.cacheExpiry && Date.now() < this.cacheExpiry) {
            console.log('[SeasonalForecast] cache hit');
            return this.cache;
        }

        console.log('[SeasonalForecast] fetching 1-month forecast for Tohoku...');

        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) {
                console.error(`[SeasonalForecast] HTTP error ${response.status}`);
                return this._getFallbackValues();
            }

            const data = await response.json();

            // metInfos[0].items から1ヶ月全体の確率を抽出
            // 構造: metInfos[0].items[] に type, kind, below, normal, above がある
            const probabilities = { precip: null, temp: null };

            if (data.metInfos && Array.isArray(data.metInfos)) {
                for (const metInfo of data.metInfos) {
                    if (!metInfo.items || !Array.isArray(metInfo.items)) continue;
                    for (const item of metInfo.items) {
                        if (item.type === '地域・期間平均平年偏差各階級の確率') {
                            const below = parseInt(item.below) || 33;
                            const normal = parseInt(item.normal) || 34;
                            const above = parseInt(item.above) || 33;

                            if (item.kind === '降水量') {
                                probabilities.precip = { below, normal, above };
                            } else if (item.kind === '気温') {
                                probabilities.temp = { below, normal, above };
                            }
                        }
                    }
                }
            }

            const result = {
                Forecast_1M_Precip_Below: probabilities.precip?.below ?? 33,
                Forecast_1M_Precip_Normal: probabilities.precip?.normal ?? 34,
                Forecast_1M_Precip_Above: probabilities.precip?.above ?? 33,
                Forecast_1M_Temp_Below: probabilities.temp?.below ?? 33,
                Forecast_1M_Temp_Normal: probabilities.temp?.normal ?? 34,
                Forecast_1M_Temp_Above: probabilities.temp?.above ?? 33,
                reportDatetime: data.reportDatetime || null,
                fetchedAt: new Date().toISOString(),
            };

            console.log(`[SeasonalForecast] OK: Precip=[${result.Forecast_1M_Precip_Below}/${result.Forecast_1M_Precip_Normal}/${result.Forecast_1M_Precip_Above}], Temp=[${result.Forecast_1M_Temp_Below}/${result.Forecast_1M_Temp_Normal}/${result.Forecast_1M_Temp_Above}]`);

            this.cache = result;
            this.cacheExpiry = Date.now() + this.cacheTTL;
            return result;
        } catch (error) {
            console.error('[SeasonalForecast] error:', error.message);
            return this._getFallbackValues();
        }
    }

    _getFallbackValues() {
        return {
            Forecast_1M_Precip_Below: 33,
            Forecast_1M_Precip_Normal: 34,
            Forecast_1M_Precip_Above: 33,
            Forecast_1M_Temp_Below: 33,
            Forecast_1M_Temp_Normal: 34,
            Forecast_1M_Temp_Above: 33,
            isFallback: true,
            fetchedAt: new Date().toISOString(),
        };
    }
}

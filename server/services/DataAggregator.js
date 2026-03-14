import { MIYAGI_DAMS } from '../config/regions/miyagi.js';
import { CacheManager } from './CacheManager.js';
import { DroughtAnalyzer } from './DroughtAnalyzer.js';
import { MiyagiDamScraper } from './MiyagiDamScraper.js';
import { KawabouApiService, TOHOKU_PREFECTURES } from './KawabouApiService.js';
import { KawatabiWeatherScraper } from './KawatabiWeatherScraper.js';
import { SendaiWeatherScraper } from './SendaiWeatherScraper.js';
import { NikkawaWeatherScraper } from './NikkawaWeatherScraper.js';
import { IsawaWeatherScraper } from './IsawaWeatherScraper.js';
import { SeasonalForecastScraper } from './SeasonalForecastScraper.js';
import { OpenWeatherMapService } from './OpenWeatherMapService.js';
import { generateMockDamData } from '../../data/mock/mockDams.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * データ集約サービス
 * リアルタイムスクレイピング + フォールバック(モック)
 */
export class DataAggregator {
    constructor() {
        this.cache = new CacheManager();
        this.analyzer = new DroughtAnalyzer();
        this.scraper = new MiyagiDamScraper();
        this.kawabouService = new KawabouApiService();
        this.kawatabiScraper = new KawatabiWeatherScraper();
        this.sendaiScraper = new SendaiWeatherScraper();
        this.nikkawaScraper = new NikkawaWeatherScraper();
        this.isawaScraper = new IsawaWeatherScraper();
        this.owmService = new OpenWeatherMapService();
        this.seasonalForecastScraper = new SeasonalForecastScraper();
        this.lastFetchTime = null;
        this._fetchPromises = {}; // 実行中リクエストの共有（Cache Stampede対策）
    }

    /**
     * Promise deduplicator helper
     */
    async _deduplicate(key, fetcher) {
        if (this._fetchPromises[key]) {
            return this._fetchPromises[key];
        }
        this._fetchPromises[key] = fetcher().finally(() => {
            delete this._fetchPromises[key];
        });
        return this._fetchPromises[key];
    }

    /**
     * 全ダムデータを取得（キャッシュ付き）
     */
    async getAllDams() {
        const cacheKey = 'dams:all';
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        return this._deduplicate(cacheKey, async () => {
            let rawData;
            let dataSource = 'live';

            try {
                // 川の防災情報から宮城県のデータを取得（失敗時は内部でフォールバックされる）
                const prefData = await this.getDamsByPref(401);
                rawData = prefData.dams; // 既に分析済みのデータだが、下で再度分析しても問題ない
                dataSource = prefData.dataSource;
            } catch (error) {
                console.error('⚠️ データ取得エラー、フォールバックに切替:', error.message);
                rawData = generateMockDamData(MIYAGI_DAMS);
                dataSource = 'fallback';
            }

            let forecastData = null;
            try {
                forecastData = await this.getWeather();
            } catch (e) {
                console.error('天気予報取得エラー:', e.message);
            }

            try {
                const analyzedData = this.analyzer.analyzeDams(rawData);

                await this._applyAllAIPredictions(analyzedData, forecastData);

                const result = {
                    dams: analyzedData,
                    summary: this.analyzer.getSummary(analyzedData),
                    region: 'miyagi',
                    lastUpdated: new Date().toISOString(),
                    dataSource,
                };

                // キャッシュTTL: 10分（600秒）
                this.cache.set(cacheKey, result, 600);
                this.lastFetchTime = new Date();
                return result;
            } catch (error) {
                console.error('データ処理エラー:', error);
                // 完全フォールバック
                const fallbackData = generateMockDamData(MIYAGI_DAMS);
                const analyzedFallback = this.analyzer.analyzeDams(fallbackData);
                return {
                    dams: analyzedFallback,
                    summary: this.analyzer.getSummary(analyzedFallback),
                    region: 'miyagi',
                    lastUpdated: new Date().toISOString(),
                    dataSource: 'fallback',
                    error: 'データ取得に失敗しました。フォールバックデータを表示しています。',
                };
            }
        });
    }

    /**
     * 川の防災情報APIの初期化（サーバー起動時に呼び出し）
     */
    async initKawabou() {
        try {
            await this.kawabouService.initMasterData();
        } catch (e) {
            console.error('[Kawabou] 初期化エラー:', e.message);
        }
    }

    /**
     * 指定県のダムデータを取得（川の防災情報APIメイン＋宮城県フォールバック）
     * @param {number} prefCode - 都道府県コード (例: 401)
     */
    async getDamsByPref(prefCode) {
        const cacheKey = `dams:pref:${prefCode}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        return this._deduplicate(cacheKey, async () => {
            let dams = [];
            let dataSource = 'kawabou';

            try {
                dams = await this.kawabouService.fetchDamsByPref(prefCode);
            } catch (e) {
                console.error(`[Kawabou] ${prefCode} 取得失敗:`, e.message);
            }

            // 宮城県(401)の場合、独自スクレイパーでの補完を試みる
            if (prefCode === 401) {
                const { dams: mergedDams, dataSource: newSource } = await this._mergeMiyagiData(dams);
                dams = mergedDams;
                dataSource = newSource;
            }

            // 渇水レベル分析を適用
            const analyzedData = this.analyzer.analyzeDams(dams);

            await this._applyAllAIPredictions(analyzedData, null);

            const result = {
                dams: analyzedData,
                summary: this.analyzer.getSummary(analyzedData),
                prefCode,
                prefName: TOHOKU_PREFECTURES.find(p => p.code === prefCode)?.name || '不明',
                lastUpdated: new Date().toISOString(),
                dataSource,
            };

            this.cache.set(cacheKey, result, 600); // 10分キャッシュ
            return result;
        });
    }

    /**
     * 東北6県全ダムのデータを取得（マップ用: 全ピン表示）
     */
    async getAllTohokuDams() {
        const cacheKey = 'dams:tohoku:all:v2';
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        return this._deduplicate(cacheKey, async () => {
            let allDams = [];
            try {
                allDams = await this.kawabouService.fetchAllTohokuDams();
                
                // 宮城県のダムのみハイブリッドマージを適用
                const nonMiyagiDams = allDams.filter(d => d.prefCode != 401);
                const miyagiDamsFromKawabou = allDams.filter(d => d.prefCode == 401);
                console.log(`[getAllTohokuDams] Found ${miyagiDamsFromKawabou.length} Miyagi dams in Kawabou set`);
                
                if (miyagiDamsFromKawabou.length > 0) {
                    const { dams: mergedMiyagiDams } = await this._mergeMiyagiData(miyagiDamsFromKawabou);
                    // 全体配列を更新（宮城県分をマージ済みのものに差し替え）
                    allDams = [...nonMiyagiDams, ...mergedMiyagiDams];
                }
            } catch (e) {
                console.error('[Kawabou] 東北全ダム取得失敗:', e.message);
            }

            // マスタだけでも座標情報を返す（実況が取れなくてもピンは立てる）
            if (allDams.length === 0) {
                const masterData = this.kawabouService.getAllMasterData();
                allDams = masterData.map(m => ({
                    obsFcd: m.obsFcd,
                    id: m.name.replace(/ダム$/, '').replace(/\s/g, ''),
                    name: m.name,
                    lat: m.lat,
                    lng: m.lon,
                    prefCode: m.prefCode,
                    prefName: m.prefName,
                    river: m.river,
                    waterSystem: m.waterSystem,
                    dataSource: 'master_only',
                    isLiveData: false,
                }));
            }

            // 渇水レベル分析を適用
            const analyzedData = this.analyzer.analyzeDams(allDams);

            await this._applyAllAIPredictions(analyzedData, null);

            const result = {
                dams: analyzedData,
                summary: this.analyzer.getSummary(analyzedData),
                region: 'tohoku',
                lastUpdated: new Date().toISOString(),
            };

            this.cache.set(cacheKey, result, 600);
            return result;
        });
    }

    /**
     * 特定ダムのデータを取得
     */
    async getDamById(damId) {
        const all = await this.getAllDams();
        return all.dams.find((d) => d.id === damId) || null;
    }

    /**
     * サマリーのみ取得
     */
    async getSummary() {
        const all = await this.getAllDams();
        return all.summary;
    }

    /**
     * 都道府県コード(Kawabou API基準)からJMAの地域コードに変換する
     */
    _getJmaCode(prefCode) {
        const mapping = {
            201: '020000', // 青森
            301: '030000', // 岩手
            401: '040000', // 宮城
            501: '050000', // 秋田
            601: '060000', // 山形
            701: '070000', // 福島
        };
        return mapping[prefCode] || '040000';
    }

    /**
     * 気象情報を取得
     */
    async getWeather(prefCode = 401) {
        const jmaCode = this._getJmaCode(prefCode);
        const cacheKey = `weather:${jmaCode}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        return this._deduplicate(cacheKey, async () => {
            try {
                const response = await fetch(
                    `https://www.jma.go.jp/bosai/forecast/data/forecast/${jmaCode}.json`
                );
                if (!response.ok) throw new Error(`JMA API error: ${response.status}`);
                const data = await response.json();

                const weather = this._parseJmaForecast(data);
                this.cache.set(cacheKey, weather, 1800); // 30分キャッシュ
                return weather;
            } catch (error) {
                console.error('気象データ取得エラー:', error);
                return {
                    forecast: '取得できませんでした',
                    precipitation: null,
                    lastUpdated: new Date().toISOString(),
                    error: error.message,
                };
            }
        });
    }

    /**
     * JMA予報データをパース
     */
    _parseJmaForecast(data) {
        try {
            const timeSeries = data[0]?.timeSeries;
            const weekTimeSeries = data[1]?.timeSeries; // 週間予報データ

            if (!timeSeries || timeSeries.length === 0) {
                return { error: true, forecast: 'データなし', lastUpdated: new Date().toISOString() };
            }

            const weatherTs = timeSeries[0];
            const precipTs = timeSeries.find((ts) => ts.areas?.[0]?.pops);

            // 週間予報データの準備
            const weekWeatherTs = weekTimeSeries?.[0]; // 天気・降水確率
            const weekTempTs = weekTimeSeries?.[1]; // 気温

            const regions = [];
            if (weatherTs && weatherTs.areas) {
                for (let i = 0; i < weatherTs.areas.length; i++) {
                    const wArea = weatherTs.areas[i];
                    const areaName = wArea.area.name;

                    // 基本は同じエリア名、特例ルール（宮城の東部＝仙台、西部＝白石など）
                    let tempAreaName = areaName;
                    if (areaName === '東部') tempAreaName = '仙台';
                    if (areaName === '西部') tempAreaName = '白石';

                    // 降水確率・週間天気のエリア取得（名前一致またはインデックスフォールバック）
                    const pArea = precipTs?.areas?.find((a) => a.area?.name?.includes(areaName)) || precipTs?.areas?.[i];
                    const wwArea = weekWeatherTs?.areas?.find((a) => a.area?.name?.includes(areaName)) || weekWeatherTs?.areas?.[i];

                    // 気温のエリア取得
                    let wtArea = weekTempTs?.areas?.find((a) => a.area?.name?.includes(tempAreaName));
                    if (!wtArea && weekTempTs?.areas?.length > 0) {
                        wtArea = weekTempTs.areas[i] || weekTempTs.areas[0];
                    }

                    const weekly = [];
                    if (wwArea && wtArea && weekWeatherTs.timeDefines) {
                        for (let j = 0; j < weekWeatherTs.timeDefines.length; j++) {
                            weekly.push({
                                date: weekWeatherTs.timeDefines[j],
                                weatherCode: wwArea.weatherCodes?.[j] || '',
                                pop: wwArea.pops?.[j] || '',
                                minTemp: wtArea.tempsMin?.[j] || '',
                                maxTemp: wtArea.tempsMax?.[j] || ''
                            });
                        }
                    }

                    regions.push({
                        name: areaName,
                        weathers: wArea.weathers || [],
                        weatherCodes: wArea.weatherCodes || [],
                        pops: pArea?.pops || [],
                        weekly: weekly,
                    });
                }
            }

            return {
                reportDatetime: data[0]?.reportDatetime,
                popTimeDefines: precipTs?.timeDefines || [],
                regions,
                lastUpdated: new Date().toISOString(),
            };
        } catch (e) {
            console.error('JMAデータパースエラー:', e);
            return { error: true, forecast: 'パースエラー', lastUpdated: new Date().toISOString() };
        }
    }

    /**
     * Python AIモデルを呼び出して鳴子ダムの渇水予測を取得する
     * @param {object} damData - 現在のダムデータ
     * @param {object} forecastData - fetchJmaForecast() の結果 (ダッシュボード表示用と同じもの)
     */
    async getNarukoAiPrediction(damData, forecastData) {
        const cacheKey = 'ai:naruko';
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        // --- 予報データの取得: OWM → 気象庁フォールバック ---
        let forecastPrecip7d = 20.0; // 最終フォールバック
        let forecastTemp7d = 4.0;    // 最終フォールバック
        const month = new Date().getMonth() + 1;
        let forecastSource = 'default';

        // 優先1: OpenWeatherMap One Call API 3.0
        let dailyForecast = null;
        try {
            const owmData = await this.owmService.fetchForecast();
            if (owmData && owmData.Forecast_Precip_7d_sum !== null && owmData.Forecast_Temp_7d_avg !== null) {
                forecastPrecip7d = owmData.Forecast_Precip_7d_sum;
                forecastTemp7d = owmData.Forecast_Temp_7d_avg;
                dailyForecast = owmData.forecast;
                forecastSource = 'OpenWeatherMap';
            }
        } catch (e) {
            console.error('[AI Prediction] OWMエラー:', e.message);
        }

        // フォールバック: 気象庁の降水確率×季節係数で疑似算出
        if (forecastSource === 'default' && forecastData && forecastData.regions && forecastData.regions.length > 0) {
            const weekly = forecastData.regions[0].weekly || [];
            if (weekly.length > 0) {
                dailyForecast = weekly;
                let tempSum = 0, precipSum = 0, validDays = 0;
                let precipFactor = 10;
                if (month >= 3 && month <= 5) precipFactor = 20;
                else if (month >= 6 && month <= 8) precipFactor = 50;
                else if (month >= 9 && month <= 11) precipFactor = 40;

                for (let i = 0; i < Math.min(7, weekly.length); i++) {
                    const day = weekly[i];
                    if (day.maxTemp && day.minTemp) {
                        const t = (parseInt(day.maxTemp) + parseInt(day.minTemp)) / 2;
                        if (!isNaN(t)) { tempSum += t; validDays++; }
                    }
                    if (day.pop) {
                        const prob = parseInt(day.pop);
                        if (!isNaN(prob)) precipSum += (prob / 100) * precipFactor;
                    }
                }
                if (validDays > 0) forecastTemp7d = tempSum / validDays;
                if (precipSum > 0) forecastPrecip7d = precipSum;
                forecastSource = 'JMA(疑似)';
            }
        }
        console.log(`[AI Prediction] 予報ソース: ${forecastSource}`);
        // --------------------------------------------------------------------------

        // 川渡アメダスからリアルタイム気象データを取得
        const weekTemp = 4.0;   // フォールバック用デフォルト気温
        const weekPrecip = 20.0; // フォールバック用デフォルト降水量
        let kawatabiData;
        try {
            kawatabiData = await this.kawatabiScraper.fetchWeatherFeatures();
        } catch (e) {
            console.error('[AI Prediction] KawatabiScraper error, using fallback:', e.message);
            kawatabiData = null;
        }

        // 1ヶ月予報（季節予報）の確率データ取得
        let seasonalData;
        try {
            seasonalData = await this.seasonalForecastScraper.fetchSeasonalForecast();
        } catch (e) {
            console.error('[AI Prediction] SeasonalForecast error, using fallback:', e.message);
            seasonalData = null;
        }

        const features = {
            StorageLevel: damData.waterLevel ?? 230,
            Inflow: damData.inflowRate ?? 5,
            Outflow: damData.outflowRate ?? 5,
            AvgTemp: kawatabiData ? kawatabiData.avgTemp : weekTemp,
            Precipitation: kawatabiData ? kawatabiData.precipitation : 0,
            SnowDepth: kawatabiData ? kawatabiData.snowDepth : 0,
            Snowfall: kawatabiData ? kawatabiData.snowfall : 0,
            Precip_7d_sum: kawatabiData ? kawatabiData.precip7dSum : weekPrecip,
            Precip_30d_sum: kawatabiData ? kawatabiData.precip30dSum : weekPrecip * 4,
            Temp_7d_avg: kawatabiData ? kawatabiData.temp7dAvg : weekTemp,
            SnowDepth_30d_avg: kawatabiData ? kawatabiData.snowDepth30dAvg : 0,
            Snowfall_7d_sum: kawatabiData ? kawatabiData.snowfall7dSum : 0,
            Month: month,
            Forecast_Precip_7d_sum: forecastPrecip7d,
            Forecast_Temp_7d_avg: forecastTemp7d,
            Forecast_1M_Precip_Below: seasonalData?.Forecast_1M_Precip_Below ?? 33,
            Forecast_1M_Precip_Normal: seasonalData?.Forecast_1M_Precip_Normal ?? 34,
            Forecast_1M_Precip_Above: seasonalData?.Forecast_1M_Precip_Above ?? 33,
            Forecast_1M_Temp_Below: seasonalData?.Forecast_1M_Temp_Below ?? 33,
            Forecast_1M_Temp_Normal: seasonalData?.Forecast_1M_Temp_Normal ?? 34,
            Forecast_1M_Temp_Above: seasonalData?.Forecast_1M_Temp_Above ?? 33,
        };

        console.log(`[AI Prediction] Features: StorageLevel=${features.StorageLevel}, Forecast_Precip_7d=${features.Forecast_Precip_7d_sum.toFixed(1)}mm, Forecast_Temp_7d=${features.Forecast_Temp_7d_avg.toFixed(1)}℃`);

        const scriptPath = path.join(__dirname, '../../scripts/predict_naruko.py');
        const pythonExe = process.env.PYTHON_CMD || 'python3';
        return new Promise((resolve) => {
            const py = spawn(pythonExe, [scriptPath]);
            let out = '';
            let err = '';
            py.stdout.on('data', d => out += d.toString());
            py.stderr.on('data', d => err += d.toString());
            py.on('close', code => {
                if (code !== 0) {
                    console.error(`[AI Prediction] Python script exited with code ${code}. Stderr: ${err}`);
                    console.error(`[AI Prediction] Stdout was: ${out}`);
                    return resolve(null);
                }
                try {
                    console.log(`[AI Prediction] Raw Python Output: ${out.substring(0, 200)}...`);
                    const jsonStart = out.indexOf('{');
                    if (jsonStart !== -1) {
                        const result = JSON.parse(out.substring(jsonStart));
                        if (result.success && result.predictions) {
                            console.log('[AI Prediction] Success! Caching result.');
                            if (dailyForecast) {
                                result.predictions.forecast = dailyForecast;
                            }
                            this.cache.set(cacheKey, result.predictions, 3600); // 1時間キャッシュ
                            resolve(result.predictions);
                        } else {
                            console.error('[AI Prediction] Python script returned error:', result.error || result);
                            resolve(null);
                        }
                    } else {
                        console.error('[AI Prediction] No JSON found in Python output.');
                        resolve(null);
                    }
                } catch (e) {
                    console.error("AI Parse Error:", e, "Output was:", out);
                    resolve(null);
                }
            });
            py.stdin.write(JSON.stringify(features));
            py.stdin.end();
        });
    }

    /**
     * 釜房ダムのAI予測を取得する
     */
    async getKamafusaAiPrediction(damData, forecastData) {
        const cacheKey = 'ai:kamafusa';
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        // --- OWM → JMA フォールバック ---
        let forecastPrecip7d = 20.0;
        let forecastTemp7d = 6.0;
        const month = new Date().getMonth() + 1;

        // 釜房ダム付近の緯度・経度
        const KAMAFUSA_LAT = 38.20;
        const KAMAFUSA_LON = 140.70;

        let dailyForecast = null;
        try {
            const owmData = await this.owmService.fetchForecast(KAMAFUSA_LAT, KAMAFUSA_LON);
            if (owmData && owmData.Forecast_Precip_7d_sum !== null && owmData.Forecast_Temp_7d_avg !== null) {
                forecastPrecip7d = owmData.Forecast_Precip_7d_sum;
                forecastTemp7d = owmData.Forecast_Temp_7d_avg;
                dailyForecast = owmData.forecast;
            }
        } catch (e) {
            console.error('[Kamafusa AI] OWM error:', e.message);
        }

        // 仙台アメダスからリアルタイム気象データを取得
        let sendaiData;
        try {
            sendaiData = await this.sendaiScraper.fetchWeatherFeatures();
        } catch (e) {
            console.error('[Kamafusa AI] SendaiScraper error:', e.message);
            sendaiData = null;
        }

        const features = {
            StorageLevel: damData.waterLevel ?? 143,
            Inflow: damData.inflowRate ?? 5,
            Outflow: damData.outflowRate ?? 5,
            AvgTemp: sendaiData ? sendaiData.avgTemp : 10,
            Precipitation: sendaiData ? sendaiData.precipitation : 0,
            SnowDepth: sendaiData ? sendaiData.snowDepth : 0,
            Snowfall: sendaiData ? sendaiData.snowfall : 0,
            Precip_7d_sum: sendaiData ? sendaiData.precip7dSum : 20,
            Precip_30d_sum: sendaiData ? sendaiData.precip30dSum : 80,
            Temp_7d_avg: sendaiData ? sendaiData.temp7dAvg : 10,
            SnowDepth_30d_avg: sendaiData ? sendaiData.snowDepth30dAvg : 0,
            Snowfall_7d_sum: sendaiData ? sendaiData.snowfall7dSum : 0,
            Month: month,
            Forecast_Precip_7d_sum: forecastPrecip7d,
            Forecast_Temp_7d_avg: forecastTemp7d
        };

        console.log(`[Kamafusa AI] Features: StorageLevel=${features.StorageLevel}, Forecast_Precip_7d=${forecastPrecip7d.toFixed(1)}mm`);

        const scriptPath = path.join(__dirname, '../../scripts/predict_kamafusa.py');
        const pythonExe = process.env.PYTHON_CMD || 'python3';
        return new Promise((resolve) => {
            const py = spawn(pythonExe, [scriptPath]);
            let out = '';
            let err = '';
            py.stdout.on('data', d => out += d.toString());
            py.stderr.on('data', d => err += d.toString());
            py.on('close', code => {
                if (code !== 0) {
                    console.error(`[Kamafusa AI] Python exited ${code}: ${err}`);
                    return resolve(null);
                }
                try {
                    console.log(`[Kamafusa AI] Output: ${out.substring(0, 200)}...`);
                    const jsonStart = out.indexOf('{');
                    if (jsonStart !== -1) {
                        const result = JSON.parse(out.substring(jsonStart));
                        if (result.success && result.predictions) {
                            console.log('[Kamafusa AI] Success!');
                            if (dailyForecast) {
                                result.predictions.forecast = dailyForecast;
                            }
                            this.cache.set(cacheKey, result.predictions, 3600);
                            resolve(result.predictions);
                        } else {
                            console.error('[Kamafusa AI] Error:', result.error);
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    console.error('[Kamafusa AI] Parse error:', e);
                    resolve(null);
                }
            });
            py.stdin.write(JSON.stringify(features));
            py.stdin.end();
        });
    }

    async getOokuraAiPrediction(ookuraData, weatherResult) {
        if (ookuraData.waterLevel == null || ookuraData.inflowRate == null || ookuraData.outflowRate == null) {
            return null;
        }

        const cacheKey = 'ookura_ai_prediction';
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const realtimeWeather = await this.nikkawaScraper.fetchWeatherFeatures();

            // --- OWM → JMA フォールバック ---
            let forecast7dPrecip = 0;
            let forecast7dTemp = realtimeWeather.avgTemp;
            const currentMonth = new Date().getMonth() + 1;

            // 大倉ダムの緯度・経度
            const OOKURA_LAT = 38.32;
            const OOKURA_LON = 140.71;

            let dailyForecast = null;
            try {
                const owmData = await this.owmService.fetchForecast(OOKURA_LAT, OOKURA_LON);
                if (owmData && owmData.Forecast_Precip_7d_sum !== null && owmData.Forecast_Temp_7d_avg !== null) {
                    forecast7dPrecip = owmData.Forecast_Precip_7d_sum;
                    forecast7dTemp = owmData.Forecast_Temp_7d_avg;
                    dailyForecast = owmData.forecast;
                } else if (weatherResult?.forecast7dSummary) {
                    forecast7dPrecip = weatherResult.forecast7dSummary.precipitationSum ?? 0;
                    forecast7dTemp = weatherResult.forecast7dSummary.avgTemp ?? realtimeWeather.avgTemp;
                }
            } catch (e) {
                console.error('[Ookura AI] OWM error:', e.message);
                if (weatherResult?.forecast7dSummary) {
                    forecast7dPrecip = weatherResult.forecast7dSummary.precipitationSum ?? 0;
                    forecast7dTemp = weatherResult.forecast7dSummary.avgTemp ?? realtimeWeather.avgTemp;
                }
            }

            const features = {
                StorageLevel: parseFloat(ookuraData.waterLevel),
                Inflow: parseFloat(ookuraData.inflowRate),
                Outflow: parseFloat(ookuraData.outflowRate),
                AvgTemp: realtimeWeather.avgTemp,
                Precipitation: realtimeWeather.precipitation,
                SnowDepth: realtimeWeather.snowDepth,
                Snowfall: realtimeWeather.snowfall,
                Precip_7d_sum: realtimeWeather.precip7dSum,
                Precip_30d_sum: realtimeWeather.precip30dSum,
                Temp_7d_avg: realtimeWeather.temp7dAvg,
                SnowDepth_30d_avg: realtimeWeather.snowDepth30dAvg,
                Snowfall_7d_sum: realtimeWeather.snowfall7dSum,
                Month: currentMonth,
                Forecast_Precip_7d_sum: forecast7dPrecip,
                Forecast_Temp_7d_avg: forecast7dTemp
            };

            console.log(`[Ookura AI] Features: StorageLevel=${features.StorageLevel}, Forecast_Precip_7d=${features.Forecast_Precip_7d_sum}mm`);

            const scriptPath = path.join(__dirname, '../../scripts/predict_ookura.py');
            const pythonExe = process.env.PYTHON_CMD || 'python3';
            return new Promise((resolve) => {
                const py = spawn(pythonExe, [scriptPath]);
                let out = '';
                let err = '';
                py.stdout.on('data', d => out += d.toString());
                py.stderr.on('data', d => err += d.toString());
                py.on('close', code => {
                    if (code !== 0) {
                        console.error(`[Ookura AI] Python exited ${code}: ${err}`);
                        return resolve(null);
                    }
                    try {
                        console.log(`[Ookura AI] Output: ${out.substring(0, 200)}...`);
                        const jsonStart = out.indexOf('{');
                        if (jsonStart !== -1) {
                            const result = JSON.parse(out.substring(jsonStart));
                            // predict_ookura.py は直接 {7d: {...}, 28d: {...}, ...} を返す
                            if (result['7d']) {
                                console.log('[Ookura AI] Success!');
                                if (dailyForecast) {
                                    result.forecast = dailyForecast;
                                }
                                this.cache.set(cacheKey, result, 3600);
                                resolve(result);
                            } else if (result.error) {
                                console.error('[Ookura AI] Error:', result.error);
                                resolve(null);
                            } else {
                                resolve(null);
                            }
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        console.error('[Ookura AI] Parse error:', e);
                        resolve(null);
                    }
                });
                py.stdin.write(JSON.stringify(features));
                py.stdin.end();
            });
        } catch (error) {
            console.error('[Ookura AI] error:', error.message);
            return null;
        }
    }

    /**
     * 全てのダムに対して、対象のダムが存在すればAI予測を一括付与する
     */
    async _applyAllAIPredictions(analyzedData, forecastData) {
        // --- 鳴子ダム ---
        const narukoDam = analyzedData.find(d => d.name === '鳴子ダム');
        if (narukoDam) {
            try {
                const aiPrediction = await this.getNarukoAiPrediction(narukoDam, forecastData);
                if (aiPrediction) {
                    narukoDam.aiPrediction = aiPrediction;
                    const getDroughtLevel = (storageLevel) => {
                        if (storageLevel < 224) return 'critical';
                        if (storageLevel < 227) return 'warning';
                        if (storageLevel < 230) return 'caution';
                        return 'normal';
                    };
                    for (const h of ['7d', '28d', '60d', '90d']) {
                        if (aiPrediction[h]) {
                            aiPrediction[h].level = getDroughtLevel(aiPrediction[h].mean);
                        }
                    }
                }
            } catch (e) {
                console.error("[Naruko AI] error:", e.message);
            }
        }

        // --- 釜房ダム ---
        const kamafusaDam = analyzedData.find(d => d.name === '釜房ダム');
        if (kamafusaDam) {
            try {
                const aiPrediction = await this.getKamafusaAiPrediction(kamafusaDam, forecastData);
                if (aiPrediction) {
                    kamafusaDam.aiPrediction = aiPrediction;
                    const getKamafusaLevel = (level) => {
                        if (level < 138) return 'critical';
                        if (level < 140) return 'warning';
                        if (level < 142) return 'caution';
                        return 'normal';
                    };
                    for (const h of ['7d', '28d', '60d', '90d']) {
                        if (aiPrediction[h]) {
                            aiPrediction[h].level = getKamafusaLevel(aiPrediction[h].mean);
                        }
                    }
                }
            } catch (e) {
                console.error('[Kamafusa AI] error:', e.message);
            }
        }

        // --- 大倉ダム ---
        const ookuraDam = analyzedData.find(d => d.name === '大倉ダム');
        if (ookuraDam) {
            try {
                const aiPrediction = await this.getOokuraAiPrediction(ookuraDam, forecastData);
                if (aiPrediction) {
                    ookuraDam.aiPrediction = aiPrediction;
                    const getOokuraLevel = (level) => {
                        if (level < 240) return 'critical';
                        if (level < 243) return 'warning';
                        if (level < 246) return 'caution';
                        return 'normal';
                    };
                    for (const h of ['7d', '28d', '60d', '90d']) {
                        if (aiPrediction[h]) {
                            aiPrediction[h].level = getOokuraLevel(aiPrediction[h].mean);
                        }
                    }
                }
            } catch (e) {
                console.error('[Ookura AI] error:', e.message);
            }
        }

        // --- 胆沢ダム ---
        const isawaDam = analyzedData.find(d => d.name && d.name.includes('胆沢'));
        if (isawaDam) {
            try {
                const aiPrediction = await this.getIsawaAiPrediction(isawaDam, forecastData);

                if (aiPrediction) {
                    isawaDam.aiPrediction = aiPrediction;
                    const getIsawaLevel = (level) => {
                        // 胆沢ダムの仮レベル設定 (常時満水 344m - 利用可能水深に応じて)
                        if (level < 315) return 'critical';
                        if (level < 320) return 'warning';
                        if (level < 325) return 'caution';
                        return 'normal';
                    };
                    for (const h of ['7d', '28d', '60d', '90d']) {
                        if (aiPrediction[h]) {
                            aiPrediction[h].level = getIsawaLevel(aiPrediction[h].mean);
                        }
                    }
                }
            } catch (e) {
                console.error('[Isawa AI] error:', e.message);
            }
        }
    }

    /**
     * 胆沢ダムのAI予測を取得する
     */
    async getIsawaAiPrediction(damData, forecastData) {
        const cacheKey = 'ai:isawa';
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        // OWM → JMA フォールバック
        let forecast7dPrecip = 20.0;
        let forecast7dTemp = 5.0;
        const currentMonth = new Date().getMonth() + 1;

        // 胆沢ダムの座標
        const ISAWA_LAT = 39.1352;
        const ISAWA_LON = 140.9419;

        let dailyForecast = null;
        try {
            const owmData = await this.owmService.fetchForecast(ISAWA_LAT, ISAWA_LON);
            if (owmData && owmData.Forecast_Precip_7d_sum !== null && owmData.Forecast_Temp_7d_avg !== null) {
                forecast7dPrecip = owmData.Forecast_Precip_7d_sum;
                forecast7dTemp = owmData.Forecast_Temp_7d_avg;
                dailyForecast = owmData.forecast;
            } else if (forecastData && forecastData.regions && forecastData.regions.length > 0) {
                const weekly = forecastData.regions[0].weekly || [];
                if (weekly.length > 0) {
                    dailyForecast = weekly;
                    let tempSum = 0, precipSum = 0, validDays = 0;
                    for (let i = 0; i < Math.min(7, weekly.length); i++) {
                        const day = weekly[i];
                        if (day.maxTemp && day.minTemp) {
                            const t = (parseInt(day.maxTemp) + parseInt(day.minTemp)) / 2;
                            if (!isNaN(t)) { tempSum += t; validDays++; }
                        }
                        if (day.pop) {
                            const prob = parseInt(day.pop);
                            if (!isNaN(prob)) precipSum += (prob / 100) * 20;
                        }
                    }
                    if (validDays > 0) forecast7dTemp = tempSum / validDays;
                    if (precipSum > 0) forecast7dPrecip = precipSum;
                }
            }
        } catch (e) {
            console.error('[Isawa AI] OWM error:', e.message);
        }

        // 新しく実装した IsawaWeatherScraper から取得する
        // 万一取得に失敗した場合は、スクレイパー内のフォールバック値が返される
        const realtimeWeather = await this.isawaScraper.fetchWeatherFeatures();

        const features = {
            StorageLevel: parseFloat(damData.waterLevel || 330.0),
            Inflow: parseFloat(damData.inflowRate || 5.0),
            Outflow: parseFloat(damData.outflowRate || 5.0),
            AvgTemp: realtimeWeather.avgTemp,
            Precipitation: realtimeWeather.precipitation,
            SnowDepth: realtimeWeather.snowDepth,
            Snowfall: realtimeWeather.snowfall,
            Precip_7d_sum: realtimeWeather.precip7dSum,
            Precip_30d_sum: realtimeWeather.precip30dSum,
            Temp_7d_avg: realtimeWeather.temp7dAvg,
            SnowDepth_30d_avg: realtimeWeather.snowDepth30dAvg,
            Snowfall_7d_sum: realtimeWeather.snowfall7dSum,
            Month: currentMonth,
            Forecast_Precip_7d_sum: forecast7dPrecip,
            Forecast_Temp_7d_avg: forecast7dTemp
        };

        console.log(`[Isawa AI] Features: StorageLevel=${features.StorageLevel}, Forecast_Precip_7d=${features.Forecast_Precip_7d_sum}mm`);

        const scriptPath = path.join(__dirname, '../../scripts/predict_isawa.py');
        const pythonExe = process.env.PYTHON_CMD || 'python3';
        return new Promise((resolve) => {
            const py = spawn(pythonExe, [scriptPath]);
            let out = '';
            let err = '';
            py.stdout.on('data', d => out += d.toString());
            py.stderr.on('data', d => err += d.toString());
            py.on('close', code => {
                if (code !== 0) {
                    console.error(`[Isawa AI] Python exited ${code}: ${err}`);
                    return resolve(null);
                }
                try {
                    const jsonStart = out.indexOf('{');
                    if (jsonStart !== -1) {
                        const result = JSON.parse(out.substring(jsonStart));
                        if (result['7d'] || (result.predictions && result.predictions['7d'])) {
                            const finalResult = result.predictions || result;
                            console.log('[Isawa AI] Success!');
                            if (dailyForecast) {
                                finalResult.forecast = dailyForecast;
                            }
                            this.cache.set(cacheKey, finalResult, 3600);
                            resolve(finalResult);
                        } else if (result.error) {
                            console.error('[Isawa AI] Error:', result.error);
                            resolve(null);
                        } else {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    console.error('[Isawa AI] Parse error:', e);
                    resolve(null);
                }
            });
            py.stdin.write(JSON.stringify(features));
            py.stdin.end();
        });
    }

    /**
     * 宮城県のデータを独自スクレイパーで補完する（ハイブリッド・マージ）
     * @param {Array} dams - 川の防災情報から取得したダム配列
     * @returns {Object} { dams: mergedDams, dataSource: string }
     */
    async _mergeMiyagiData(dams) {
        console.log(`[Hybrid] Starting merge for ${dams ? dams.length : 0} dams`);
        try {
            const miyagiDams = await this.scraper.fetchAllDams();
            console.log(`[Hybrid] Scraped ${miyagiDams.length} dams from Miyagi system`);
            
            if (dams && dams.length > 0) {
                const mergedDams = dams.map(kDam => {
                    const kNameClean = (kDam.name || '').replace(/\s/g, '');
                    const mDam = miyagiDams.find(m => {
                        const mNameClean = (m.name || '').replace(/\s/g, '');
                        return m.id === kDam.id || 
                               m.name === kDam.name || 
                               (kNameClean && mNameClean === kNameClean) ||
                               (kDam.name && m.name.includes(kDam.name)) || 
                               (m.name && kDam.name.includes(m.name));
                    });
                    
                    if (!mDam) {
                        // console.log(`[Hybrid] No Miyagi Scraper match for: ${kDam.name} (ID: ${kDam.id})`);
                        return kDam;
                    }

                    const merged = { ...kDam };
                    const fields = ['waterLevel', 'storageVolume', 'inflowRate', 'outflowRate', 'storageRate', 'effectiveStorageRate'];
                    let complementedFields = [];

                    fields.forEach(field => {
                        // 異常値 (null または 0) の場合に補完
                        const isPrimaryRealtimeField = ['waterLevel', 'storageVolume', 'storageRate', 'effectiveStorageRate'].includes(field);
                        const isFlowField = ['inflowRate', 'outflowRate'].includes(field);
                        
                        let needsComplement = false;
                        if (merged[field] === null) {
                            needsComplement = mDam[field] !== null;
                        } else if (merged[field] === 0) {
                            // 水位や貯水率は 0 は異常とみなす。流入・放流の 0 は、APIが null ではなく 0 を返している場合、
                            // 宮城側が 0 以外を返しているなら異常の可能性が高いとみて上書きを試みる
                            if (isPrimaryRealtimeField) {
                                needsComplement = mDam[field] !== null && mDam[field] !== 0;
                            } else if (isFlowField) {
                                // 流入・放流は 0 が正常値でありうるが、APIが 0 を返していて宮城側が有意な値を返しているならマージ
                                needsComplement = mDam[field] !== null && mDam[field] > 0;
                            }
                        }

                        if (needsComplement) {
                            merged[field] = mDam[field];
                            complementedFields.push(field);
                        }
                    });

                    if (complementedFields.length > 0) {
                        merged.dataSource = 'kawabou+miyagi_scraper';
                        console.log(`[Hybrid] Complemented ${kDam.name} fields: ${complementedFields.join(', ')}`);
                    }
                    return merged;
                });
                return { dams: mergedDams, dataSource: 'kawabou_hybrid' };
            } else {
                return { dams: miyagiDams, dataSource: 'miyagi_scraper' };
            }
        } catch (e) {
            console.error('[Hybrid] 宮城県スクレイパー補完失敗:', e.message);
            return { dams: dams || [], dataSource: 'kawabou' };
        }
    }
}

export default DataAggregator;

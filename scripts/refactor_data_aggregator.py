import re
import sys

def main():
    file_path = 'server/services/DataAggregator.js'
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # --- 1. remove old AI prediction block in getMiyagiData ---
    # Find start and end
    start_str = '// --- AI Prediction for Naruko ---'
    end_str = '// --------------------------------\n\n                const result = {'
    
    idx_start = content.find(start_str)
    idx_end = content.find(end_str)
    
    if idx_start == -1 or idx_end == -1:
        print("Could not find old AI Prediction block")
        sys.exit(1)
        
    # Replace with a single call
    new_block = 'await this._applyAllAIPredictions(analyzedData, forecastData);\n\n                const result = {'
    content = content[:idx_start] + new_block + content[idx_end + len(end_str) - len('                const result = {'):]
    
    # --- 2. Add _applyAllAIPredictions to getting dams by pref ---
    # getDamsByPref
    target_pref = 'const analyzedData = this.analyzer.analyzeDams(dams);\n\n            const result = {'
    replacement_pref = 'const analyzedData = this.analyzer.analyzeDams(dams);\n\n            await this._applyAllAIPredictions(analyzedData, null);\n\n            const result = {'
    content = content.replace(target_pref, replacement_pref)
    
    # getAllTohokuDams
    target_all = 'const analyzedData = this.analyzer.analyzeDams(allDams);\n\n            const result = {'
    replacement_all = 'const analyzedData = this.analyzer.analyzeDams(allDams);\n\n            await this._applyAllAIPredictions(analyzedData, null);\n\n            const result = {'
    content = content.replace(target_all, replacement_all)
    
    # --- 3. Add _applyAllAIPredictions method and getIsawaAiPrediction method at the end ---
    methods_code = """
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
        const isawaDam = analyzedData.find(d => d.name === '胆沢ダム');
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

        // 北上&湯田の気象データをマージする仕組みが必要だが、
        // Realtimeでは北上(Nikkawaではないがアメダス等)が必要。
        // 現在 kawatabiScraper や nikkawaScraper があるが、Isawa向けに新しいスクレイパーはないため
        // ここではAPIまたはフォールバックで最近の平均を仮置きする（または既存スクレイパーの値を一時利用）
        // 開発環境のため、一旦仮の現在気象値を使用 (AI推論自体をテスト)
        const realtimeWeather = {
            avgTemp: 5.0,
            precipitation: 0.0,
            snowDepth: 10.0,
            snowfall: 0.0,
            precip7dSum: 15.0,
            precip30dSum: 60.0,
            temp7dAvg: 4.5,
            snowDepth30dAvg: 12.0,
            snowfall7dSum: 5.0
        };

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

        const path = require('path');
        const { spawn } = require('child_process');
        
        const scriptPath = path.join(__dirname, '../../scripts/predict_isawa.py');
        const pythonExe = process.env.PYTHON_CMD || 'python';
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
"""
    # Insert before the last closing brace '}'
    last_brace = content.rfind('}')
    content = content[:last_brace] + methods_code + content[last_brace:]
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print("Done")

if __name__ == '__main__':
    main()

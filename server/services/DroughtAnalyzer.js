import { MIYAGI_DAMS, DROUGHT_LEVELS } from '../config/regions/miyagi.js';

/**
 * 渇水レベル判定サービス
 * 貯水率に基づいて4段階の渇水レベルを判定する
 */
export class DroughtAnalyzer {
    constructor(config = {}) {
        this.thresholds = config.thresholds || {
            normal: 50,
            caution: 30,
            warning: 10,
            critical: 0,
        };
    }

    /**
     * 貯水率から渇水レベルを判定
     * @param {number|null} storageRate - 貯水率（%）
     * @returns {object} 渇水レベルオブジェクト
     */
    getLevel(storageRate) {
        if (storageRate === null || storageRate === undefined) {
            return { id: 'unknown', label: '不明', color: '#94a3b8', icon: '⚪', description: 'データなし' };
        }

        if (storageRate >= this.thresholds.normal) {
            return DROUGHT_LEVELS.NORMAL;
        } else if (storageRate >= this.thresholds.caution) {
            return DROUGHT_LEVELS.CAUTION;
        } else if (storageRate >= this.thresholds.warning) {
            return DROUGHT_LEVELS.WARNING;
        } else {
            return DROUGHT_LEVELS.CRITICAL;
        }
    }

    /**
     * ダムデータ配列にレベル情報を付与
     * @param {Array} damsData - ダムデータ配列
     * @returns {Array} レベル情報付きダムデータ
     */
    analyzeDams(damsData) {
        return damsData.map((dam) => {
            const level = this.getLevel(dam.storageRate);
            return {
                ...dam,
                droughtLevel: level,
            };
        });
    }

    /**
     * サマリー統計を計算
     * @param {Array} analyzedDams - レベル情報付きダムデータ
     * @returns {object} サマリー情報
     */
    getSummary(analyzedDams) {
        const total = analyzedDams.length;
        const counts = {
            normal: 0,
            caution: 0,
            warning: 0,
            critical: 0,
            unknown: 0,
        };

        let totalRate = 0;
        let rateCount = 0;

        analyzedDams.forEach((dam) => {
            const levelId = dam.droughtLevel?.id || 'unknown';
            counts[levelId] = (counts[levelId] || 0) + 1;

            if (dam.storageRate !== null && dam.storageRate !== undefined) {
                totalRate += dam.storageRate;
                rateCount++;
            }
        });

        return {
            total,
            counts,
            averageStorageRate: rateCount > 0 ? Math.round((totalRate / rateCount) * 10) / 10 : null,
            lastUpdated: new Date().toISOString(),
        };
    }
}

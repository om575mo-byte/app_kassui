/**
 * モックダムデータ生成
 * Phase 1 ではリアルタイムデータの代わりに使用
 * Phase 2 でスクレイパーからの実データに置き換え
 */

/**
 * リアルな季節変動を模倣したモックデータを生成
 * @param {Array} masterDams - ダムマスタデータ配列
 * @returns {Array} モックデータ付きダム配列
 */
export function generateMockDamData(masterDams) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const isFloodSeason = month >= 6 && month <= 10;

    // 季節に応じた基準貯水率（冬～春に高く、夏～秋に低い傾向）
    const seasonalBase = getSeasonalBase(month);

    return masterDams.map((dam) => {
        // ダムごとにランダムな変動を加える（シード的に名前からハッシュ）
        const hash = simpleHash(dam.id);
        const variation = ((hash % 30) - 15); // -15 ～ +15 の変動

        let storageRate = null;       // 利水容量に対する貯水率
        let effectiveStorageRate = null; // 有効貯水量に対する貯水率
        let storageVolume = null;
        let inflowRate = null;
        let outflowRate = null;
        let waterLevel = null;

        // 季節に応じた利水容量を選択
        const usableCapacity = isFloodSeason
            ? (dam.usableCapacityFlood ?? null)
            : (dam.usableCapacityNonFlood ?? dam.usableCapacityFlood ?? null);

        // 諸量DBにURLがあるダムのみデータを生成
        if (dam.mudamId !== null) {
            storageRate = Math.max(5, Math.min(100, seasonalBase + variation));
            storageVolume = usableCapacity
                ? Math.round((usableCapacity * storageRate) / 100)
                : null;
            // 有効貯水量に対する貯水率
            effectiveStorageRate = (storageVolume !== null && dam.effectiveCapacity)
                ? Math.round((storageVolume / dam.effectiveCapacity) * 1000) / 10
                : null;
            inflowRate = Math.max(0, Math.round((5 + (hash % 20)) * (isFloodSeason ? 2.5 : 1) * 10) / 10);
            outflowRate = Math.max(0, Math.round((inflowRate * (0.6 + (hash % 4) * 0.1)) * 10) / 10);
            waterLevel = usableCapacity ? Math.round(100 + storageRate * 2) / 10 : null;
        }

        return {
            ...dam,
            usableCapacity,          // 現在の季節で使用中の利水容量
            storageRate,             // 利水容量に対する貯水率
            effectiveStorageRate,    // 有効貯水量に対する貯水率
            storageVolume,
            inflowRate,
            outflowRate,
            waterLevel,
            dataTimestamp: now.toISOString(),
            isLiveData: false,
        };
    });
}

/**
 * 月に応じた基準貯水率を返す
 */
function getSeasonalBase(month) {
    const bases = {
        1: 70, 2: 65, 3: 60, 4: 75, 5: 85, 6: 80,
        7: 70, 8: 60, 9: 55, 10: 65, 11: 75, 12: 75,
    };
    return bases[month] || 70;
}

/**
 * 簡易ハッシュ関数（文字列→数値）
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 32bit整数に変換
    }
    return Math.abs(hash);
}

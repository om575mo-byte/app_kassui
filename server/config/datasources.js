/**
 * データソース設定
 */
export const DATA_SOURCES = {
    // ダム諸量データベース（国総研）
    mudamDatabase: {
        baseUrl: 'https://mudam.nilim.go.jp',
        summaryPath: '/chronology/summary',
        form01Path: '/chronology/form01',
        enabled: true,
        // リクエスト間隔 (ms) — 負荷軽減
        requestDelay: 2000,
    },

    // 気象庁 天気予報JSON（非公式）
    jma: {
        baseUrl: 'https://www.jma.go.jp/bosai',
        forecastPath: '/forecast/data/forecast',
        overviewPath: '/forecast/data/overview_forecast',
        areaListUrl: 'https://www.jma.go.jp/bosai/common/const/area.json',
        enabled: true,
        requestDelay: 1000,
    },

    // 川の防災情報（国交省）
    riverDisaster: {
        baseUrl: 'https://www.river.go.jp',
        enabled: false, // Phase 2で有効化
        requestDelay: 3000,
    },

    // 宮城県河川流域情報システム（ダム現況表）
    miyagiRiver: {
        baseUrl: 'https://www.dobokusougou.pref.miyagi.jp',
        listPath: '/miyagi/servlet/Gamen42Servlet',
        detailPath: '/miyagi/servlet/Gamen41Servlet',
        enabled: true,
        requestDelay: 3000,
    },
};

/**
 * キャッシュ設定
 */
export const CACHE_CONFIG = {
    stdTTL: 300,       // 5分
    checkperiod: 60,   // 1分ごとにチェック
    maxKeys: 200,
};

/**
 * サーバー設定
 */
export const SERVER_CONFIG = {
    port: process.env.PORT || 3001,
    refreshInterval: process.env.DATA_REFRESH_INTERVAL || 600000, // 10分
};

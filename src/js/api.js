/**
 * API クライアント
 * バックエンドAPIとの通信を担当
 */

const API_BASE = '/api';

/**
 * 汎用GETリクエスト
 */
async function fetchJSON(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`);
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

/**
 * 全ダムデータを取得
 */
export async function fetchDams() {
    return fetchJSON('/dams');
}

/**
 * 特定ダムのデータを取得
 */
export async function fetchDam(id) {
    return fetchJSON(`/dams/${id}`);
}

/**
 * サマリーデータを取得
 */
export async function fetchSummary() {
    return fetchJSON('/dams/summary');
}

/**
 * 天気予報データを取得
 */
export async function fetchWeather(prefCode = 401) {
    return fetchJSON(`/weather/${prefCode}`);
}

/**
 * ヘルスチェック
 */
export async function healthCheck() {
    return fetchJSON('/health');
}

/**
 * 水位観測所データを取得
 */
export async function fetchWaterLevels() {
    return fetchJSON('/water-levels');
}

/**
 * 利用可能な都道府県一覧を取得
 */
export async function fetchPrefectures() {
    return fetchJSON('/dams/prefectures');
}

/**
 * 指定県のダムデータを取得
 * @param {number} prefCode - 都道府県コード (例: 401)
 */
export async function fetchDamsByPref(prefCode) {
    return fetchJSON(`/dams/pref/${prefCode}`);
}

/**
 * 東北6県全ダムデータを取得（マップ用）
 */
export async function fetchTohokuDams() {
    return fetchJSON('/dams/tohoku');
}

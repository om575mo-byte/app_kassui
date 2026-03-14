/**
 * 渇水状況モニター — メインエントリポイント
 */

import { fetchDams, fetchWeather, fetchWaterLevels, fetchPrefectures, fetchDamsByPref, fetchTohokuDams } from './js/api.js';
import { initMap, renderDamMarkers, renderStationMarkers, resetView } from './js/mapManager.js';
import {
    updateSummary,
    updateDamList,
    updateWeather,
    updateTimestamp,
    showDamDetail,
    closeDamDetail,
    togglePanel,
} from './js/dashboard.js';

// 東北6県の地図設定（やや広域にデフォルトズーム）
const REGION = {
    center: [39.2, 140.3],
    zoom: 7,
};

// 自動更新間隔 (ms)
const AUTO_REFRESH_INTERVAL = 600000; // 10分

// --- App State ---
let currentData = null;
let currentPrefCode = 401; // 初期選択: 宮城県
let allTohokuDams = [];   // マップ表示用: 全東北ダム
let refreshTimer = null;

/**
 * アプリ初期化
 */
async function init() {
    console.log('🌊 渇水モニター初期化中...');

    // 地図の初期化
    initMap('map', REGION);

    // 県選択UIの初期化
    await initPrefSelector();

    // イベントリスナー
    setupEventListeners();

    // 初回データ取得
    await refreshData();

    // 自動更新開始
    startAutoRefresh();

    console.log('✅ 渇水モニター起動完了');
}

/**
 * 県選択プルダウンを初期化
 */
async function initPrefSelector() {
    const container = document.getElementById('pref-selector');
    if (!container) return;

    try {
        const data = await fetchPrefectures();
        const select = document.createElement('select');
        select.id = 'pref-select';
        select.className = 'pref-select';

        data.prefectures.forEach(pref => {
            const option = document.createElement('option');
            option.value = pref.code;
            option.textContent = pref.name;
            if (pref.code === currentPrefCode) option.selected = true;
            select.appendChild(option);
        });

        select.addEventListener('change', async (e) => {
            currentPrefCode = parseInt(e.target.value, 10);
            await refreshSidebarData();
        });

        container.innerHTML = '';
        container.appendChild(select);
    } catch (e) {
        console.error('県一覧取得失敗:', e);
    }
}

/**
 * データを更新（全東北マップ＋選択県サイドバー）
 */
async function refreshData() {
    try {
        // 東北全ダム（マップ用）・選択県ダム（サイドバー用）・天気・水位を並行取得
        const [tohokuRes, prefRes, weatherRes, waterLevelRes] = await Promise.allSettled([
            fetchTohokuDams(),
            fetchDamsByPref(currentPrefCode),
            fetchWeather(currentPrefCode),
            fetchWaterLevels(),
        ]);

        // 東北全ダム → マップ（全6県のダムを常にプロット）
        if (tohokuRes.status === 'fulfilled' && tohokuRes.value) {
            allTohokuDams = tohokuRes.value.dams || [];
            renderDamMarkers(allTohokuDams, handleDamClick);
        }

        // 選択県データ → サイドバー
        if (prefRes.status === 'fulfilled' && prefRes.value) {
            currentData = prefRes.value;
            updateSummary(currentData.summary);
            updateDamList(currentData.dams, showDamDetail);
            updateTimestamp(currentData.lastUpdated);
        } else {
            console.error('県別データ取得失敗:', prefRes.reason);
        }

        // 天気データ
        if (weatherRes.status === 'fulfilled') {
            updateWeather(weatherRes.value);
        }

        // 水位観測所データ
        if (waterLevelRes.status === 'fulfilled' && waterLevelRes.value) {
            const wlData = waterLevelRes.value;
            renderStationMarkers(wlData.stations);
        }
    } catch (error) {
        console.error('データ更新エラー:', error);
    }
}

/**
 * サイドバーのみ更新（県切り替え時）
 */
async function refreshSidebarData() {
    try {
        const [prefRes, weatherRes] = await Promise.allSettled([
            fetchDamsByPref(currentPrefCode),
            fetchWeather(currentPrefCode)
        ]);

        if (prefRes.status === 'fulfilled' && prefRes.value) {
            currentData = prefRes.value;
            updateSummary(currentData.summary);
            updateDamList(currentData.dams, showDamDetail);
            updateTimestamp(currentData.lastUpdated);
        }

        if (weatherRes.status === 'fulfilled') {
            updateWeather(weatherRes.value);
        }
    } catch (e) {
        console.error('サイドバー更新エラー:', e);
    }
}


/**
 * ダムクリック時のハンドラー
 * マップ上の全ダム（6県分）から呼ばれる
 */
function handleDamClick(dam) {
    showDamDetail(dam);
}

/**
 * イベントリスナーの設定
 */
function setupEventListeners() {
    // パネル切替
    const toggleBtn = document.getElementById('btn-toggle-panel');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', togglePanel);
    }

    // データ更新
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.classList.add('spinning');
            await refreshData();
            setTimeout(() => refreshBtn.classList.remove('spinning'), 500);
        });
    }

    // モーダル閉じる
    const modal = document.getElementById('dam-detail-modal');
    if (modal) {
        const closeBtn = modal.querySelector('.modal-close');
        const overlay = modal.querySelector('.modal-overlay');
        if (closeBtn) closeBtn.addEventListener('click', closeDamDetail);
        if (overlay) overlay.addEventListener('click', closeDamDetail);

        // Escキー
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDamDetail();
        });
    }
}

/**
 * 自動更新タイマーを開始
 */
function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshData, AUTO_REFRESH_INTERVAL);
}

// --- 起動 ---
document.addEventListener('DOMContentLoaded', init);

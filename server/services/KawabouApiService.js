import fetch from 'node-fetch';
import NodeCache from 'node-cache';

/**
 * 川の防災情報 内部JSON API サービス
 * 
 * 東北6県のダムデータを「川の防災情報 (river.go.jp)」の内部APIから取得する。
 * マスタデータ（名称・座標等）と実況データ（水位・貯水率等）を統合して返す。
 */

const BASE_URL = 'https://www.river.go.jp/kawabou/file/files';

// 東北6県の都道府県コード（川の防災情報独自の3桁コード）
export const TOHOKU_PREFECTURES = [
    { code: 201, name: '青森県', jisCode: '02' },
    { code: 301, name: '岩手県', jisCode: '03' },
    { code: 401, name: '宮城県', jisCode: '04' },
    { code: 501, name: '秋田県', jisCode: '05' },
    { code: 601, name: '山形県', jisCode: '06' },
    { code: 701, name: '福島県', jisCode: '07' },
];

// JISコード→3桁コードのマッピング
const JIS_TO_KAWABOU = {};
TOHOKU_PREFECTURES.forEach(p => { JIS_TO_KAWABOU[p.jisCode] = p.code; });

export class KawabouApiService {
    constructor() {
        // マスタデータキャッシュ: 24時間
        this.masterCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
        // 実況データキャッシュ: 10分
        this.telemetryCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
        // マスタデータ Map: obsFcd → { name, lat, lon, river, waterSystem, address, ... }
        this.masterMap = new Map();
        // 初期化済みフラグ
        this._initialized = false;
        this._initPromise = null;
        // フェッチ中Promise共有（Dogpile対策）
        this._fetchPromises = {};
    }

    /**
     * Promise重複排除ヘルパー
     */
    async _deduplicate(key, fetcher) {
        if (this._fetchPromises[key]) return this._fetchPromises[key];
        this._fetchPromises[key] = fetcher().finally(() => { delete this._fetchPromises[key]; });
        return this._fetchPromises[key];
    }

    /**
     * サーバー起動時に呼び出す: 全6県分のマスタデータをロード
     */
    async initMasterData() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._loadAllMasterData();
        return this._initPromise;
    }

    async _loadAllMasterData() {
        console.log('[Kawabou] 東北6県マスタデータの初期ロード開始...');
        const startTime = Date.now();

        for (const pref of TOHOKU_PREFECTURES) {
            try {
                await this._fetchMasterForPref(pref);
                // 直列フェッチ: 負荷軽減のため300msウェイト
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                console.error(`[Kawabou] ${pref.name}(${pref.code}) マスタ取得失敗:`, e.message);
            }
        }

        console.log(`[Kawabou] マスタデータロード完了: ${this.masterMap.size}ダム (${Date.now() - startTime}ms)`);
        this._initialized = true;
    }

    /**
     * 1県分のダムマスタデータを取得してmasterMapに追加
     */
    async _fetchMasterForPref(pref) {
        const cacheKey = `master:${pref.code}`;
        const cached = this.masterCache.get(cacheKey);
        if (cached) {
            cached.forEach((v, k) => this.masterMap.set(k, v));
            return;
        }

        const url = `${BASE_URL}/obslist/twninfo/obs/dam/${pref.code}.json`;
        const res = await fetch(url, { timeout: 10000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const prefMaster = new Map();
        if (data.prefTwn) {
            data.prefTwn.forEach(twn => {
                if (twn.dam) {
                    twn.dam.forEach(dam => {
                        const entry = {
                            obsFcd: dam.obsFcd,
                            name: dam.obsNm,
                            kana: dam.obsKana,
                            address: dam.obsAdr,
                            lat: dam.lat,
                            lon: dam.lon,
                            river: dam.rvrNm || '',
                            waterSystem: dam.rsysNm || '',
                            manager: dam.jrsNm || '',
                            prefCode: pref.code,
                            prefName: pref.name,
                        };
                        prefMaster.set(dam.obsFcd, entry);
                        this.masterMap.set(dam.obsFcd, entry);
                    });
                }
            });
        }

        this.masterCache.set(cacheKey, prefMaster);
        console.log(`[Kawabou] ${pref.name}: ${prefMaster.size}ダムのマスタを取得`);
    }

    /**
     * 指定県のダム実況データを取得し、マスタと結合して返す
     * @param {number} prefCode - 川の防災情報の都道府県コード (例: 401)
     * @returns {Array<object>} ダムデータ配列
     */
    async fetchDamsByPref(prefCode) {
        const cacheKey = `telemetry:${prefCode}`;

        return this._deduplicate(cacheKey, async () => {
            const cached = this.telemetryCache.get(cacheKey);
            if (cached) return cached;

            // まだマスタが初期化されていなければ待つ
            if (!this._initialized) {
                await this.initMasterData();
            }

            const url = `${BASE_URL}/obslist/twninfo/tm/dam/${prefCode}.json`;
            const res = await fetch(url, { timeout: 10000 });
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
            const data = await res.json();

            const dams = [];
            if (data.prefTwn) {
                data.prefTwn.forEach(twn => {
                    if (twn.dam) {
                        twn.dam.forEach(dam => {
                            const master = this.masterMap.get(dam.obsFcd);
                            if (!master) return; // マスタに無い場合スキップ

                            dams.push({
                                // --- 識別子 ---
                                obsFcd: dam.obsFcd,
                                id: this._generateId(master.name),
                                prefCode: master.prefCode,
                                prefName: master.prefName,
                                // --- マスタデータ ---
                                name: master.name,
                                river: master.river,
                                waterSystem: master.waterSystem,
                                manager: master.manager,
                                address: master.address,
                                lat: master.lat,
                                lng: master.lon,
                                // --- 実況データ ---
                                waterLevel: this._parseNum(dam.storLvl, dam.storLvlCcd),
                                storageVolume: this._parseNum(dam.storCap, dam.storCapCcd),
                                inflowRate: this._parseNum(dam.allSink, dam.allSinkCcd),
                                outflowRate: this._parseNum(dam.allDisch, dam.allDischCcd),
                                storageRate: this._sanitizeRate(dam.storPcntIrr, dam.storLvl, dam.storPcntIrrCcd),
                                effectiveStorageRate: this._sanitizeRate(dam.storPcntEff, dam.storLvl, dam.storPcntEffCcd),
                                obsTime: dam.obsTime,
                                // --- メタ ---
                                dataSource: 'kawabou',
                                isLiveData: true,
                                dataTimestamp: new Date().toISOString(),
                            });
                        });
                    }
                });
            }

            this.telemetryCache.set(cacheKey, dams);
            return dams;
        });
    }

    /**
     * 東北6県分のダムを全て取得（マップ用: 全ピン表示）
     */
    async fetchAllTohokuDams() {
        const cacheKey = 'tohoku:all';

        return this._deduplicate(cacheKey, async () => {
            const cached = this.telemetryCache.get(cacheKey);
            if (cached) return cached;

            const allDams = [];
            for (const pref of TOHOKU_PREFECTURES) {
                try {
                    const dams = await this.fetchDamsByPref(pref.code);
                    allDams.push(...dams);
                    // 直列+ウェイト: 負荷軽減
                    await new Promise(r => setTimeout(r, 200));
                } catch (e) {
                    console.error(`[Kawabou] ${pref.name} 実況取得失敗:`, e.message);
                }
            }

            this.telemetryCache.set(cacheKey, allDams);
            console.log(`[Kawabou] 東北6県合計 ${allDams.length}ダムの実況データ取得完了`);
            return allDams;
        });
    }

    /**
     * マスタデータの一覧を返す（マップ用: 座標のみ即座に返す用途）
     */
    getAllMasterData() {
        return Array.from(this.masterMap.values());
    }

    /**
     * ダム名からIDを生成（ローマ字変換の代わりにハッシュ的なIDを生成）
     */
    _generateId(name) {
        // 簡易的にダム名をそのままIDとする（フロント側で利用）
        return name.replace(/ダム$/, '').replace(/\s/g, '');
    }

    _parseNum(val, ccd) {
        if (val === null || val === undefined || val === '' || val === '-') return null;
        // Ccdフラグが 0 以外（異常）の場合は null を返す
        if (ccd !== undefined && ccd !== null && ccd !== 0) return null;
        const n = parseFloat(val);
        return isNaN(n) ? null : n;
    }

    /**
     * 貯水率の値を検証・補正する
     * APIが利水容量未登録ダムに対して0を返すケースがあるため、
     * 「貯水率0% かつ 水位が正の値」の場合は非公表（null）として扱う
     */
    _sanitizeRate(rateVal, waterLevelVal, ccd) {
        const rate = this._parseNum(rateVal, ccd);
        if (rate === null) return null;
        if (rate === 0) {
            const wl = this._parseNum(waterLevelVal);
            // 水位が正常値（> 0）ならば、貯水率0%は「非公表」と判断
            if (wl !== null && wl > 0) return null;
        }
        return rate;
    }
}

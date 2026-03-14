/**
 * 国土数値情報（W05: 河川データ）から東北6県の河川GeoJSONを生成するスクリプト
 * 
 * 処理フロー:
 *   1. 東北6県分のZIPファイルをnlftp.mlit.go.jpからダウンロード（/tmp/にキャッシュ）
 *   2. ZIP内のShapefile（_Stream.shp / .dbf）をメモリ上で解凍・パース
 *   3. Pass 1: 水系コード → 水系名 のマッピングをDBFから構築
 *   4. Pass 2: Shift_JIS属性デコード、水系名付与、@turf/simplify で頂点間引き
 *   5. 統合GeoJSONとして public/data/tohoku_rivers_ksj.geojson を出力
 * 
 * 使用方法: node generateKsjRivers.js
 */
import fetch from 'node-fetch';
import unzipper from 'unzipper';
import shapefile from 'shapefile';
import simplify from '@turf/simplify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================
// 設定
// ============================
const BASE_URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/W05/W05-07';

const TOHOKU_PREFS = [
    { code: '02', name: '青森県' },
    { code: '03', name: '岩手県' },
    { code: '04', name: '宮城県' },
    { code: '05', name: '秋田県' },
    { code: '06', name: '山形県' },
    { code: '07', name: '福島県' },
];

// W05_003 区間種別コード
const SECTION_TYPE_MAP = {
    '1': '1級直轄',
    '2': '1級指定',
    '3': '2級河川',
    '4': '指定区間外',
    '5': '1級直轄(湖沼)',
    '6': '1級指定(湖沼)',
    '7': '2級河川(湖沼)',
    '8': '指定区間外(湖沼)',
    '0': '不明',
};

// Simplify の許容度（度単位。0.001度 ≈ 約100m）
const SIMPLIFY_TOLERANCE = 0.001;

// キャッシュディレクトリ
const CACHE_DIR = path.join(os.tmpdir(), 'ksj_river_cache');

// ============================
// ZIPダウンロード（キャッシュ付き）
// ============================
async function downloadZip(prefCode) {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const zipName = `W05-07_${prefCode}_GML.zip`;
    const cachePath = path.join(CACHE_DIR, zipName);

    // キャッシュがあればスキップ
    if (fs.existsSync(cachePath)) {
        console.log(`   💾 キャッシュ使用: ${cachePath}`);
        return fs.readFileSync(cachePath);
    }

    const url = `${BASE_URL}/${zipName}`;
    console.log(`   📥 ダウンロード: ${url}`);
    const res = await fetch(url, { timeout: 60000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    // キャッシュに保存
    fs.writeFileSync(cachePath, buf);
    console.log(`   ✅ ${(buf.length / 1024 / 1024).toFixed(1)} MB ダウンロード完了`);
    return buf;
}

// ============================
// ZIP → Shapefile バッファ取得
// ============================
async function extractShapefileBuffers(zipBuffer) {
    const dir = await unzipper.Open.buffer(zipBuffer);
    const shpEntry = dir.files.find(f => f.path.endsWith('_Stream.shp'));
    const dbfEntry = dir.files.find(f => f.path.endsWith('_Stream.dbf'));
    if (!shpEntry || !dbfEntry) throw new Error('Stream.shp/.dbf not found');
    return {
        shp: await shpEntry.buffer(),
        dbf: await dbfEntry.buffer(),
    };
}

// ============================
// 座標数カウント
// ============================
function countCoords(geom) {
    if (geom.type === 'LineString') return geom.coordinates.length;
    if (geom.type === 'MultiLineString') return geom.coordinates.reduce((s, c) => s + c.length, 0);
    return 0;
}

// ============================
// メイン処理
// ============================
async function main() {
    console.log('======================================');
    console.log('国土数値情報(W05) 東北6県 河川GeoJSON生成');
    console.log('======================================\n');

    // ──────────────────────────
    // Step 1: ZIPダウンロード
    // ──────────────────────────
    console.log('Step 1: ZIPファイルのダウンロード');
    const zipBuffers = {};
    for (const pref of TOHOKU_PREFS) {
        console.log(`\n  ${pref.name} (${pref.code}):`);
        try {
            zipBuffers[pref.code] = await downloadZip(pref.code);
        } catch (e) {
            console.error(`   ❌ 失敗: ${e.message}`);
        }
    }

    // ──────────────────────────
    // Step 2: 水系コード → 水系名マッピング構築 (Pass 1)
    // ──────────────────────────
    console.log('\n\nStep 2: 水系名マッピングの構築');
    const waterSystemMap = new Map(); // 水系コード → 水系名

    for (const pref of TOHOKU_PREFS) {
        const buf = zipBuffers[pref.code];
        if (!buf) continue;

        try {
            const { shp, dbf } = await extractShapefileBuffers(buf);
            const source = await shapefile.open(shp, dbf, { encoding: 'shift_jis' });

            while (true) {
                const result = await source.read();
                if (result.done) break;
                const props = result.value.properties;
                const wsCode = String(props.W05_001 || '');
                const riverCode = String(props.W05_002 || '');
                const riverName = props.W05_004 || '';

                if (wsCode && riverName) {
                    // 河川コードの末尾4桁が0001 → 本川 → 水系名として扱う
                    if (riverCode.endsWith('0001')) {
                        waterSystemMap.set(wsCode, riverName);
                    } else if (!waterSystemMap.has(wsCode)) {
                        // 本川が見つからない場合は最初の河川名を暫定的に使用
                        waterSystemMap.set(wsCode, riverName);
                    }
                }
            }
        } catch (e) {
            console.error(`   ${pref.name}: ${e.message}`);
        }
    }
    console.log(`   ✅ ${waterSystemMap.size} 水系のマッピングを構築`);

    // ──────────────────────────
    // Step 3: フィーチャ抽出 + Simplify (Pass 2)
    // ──────────────────────────
    console.log('\nStep 3: フィーチャ抽出と軽量化');
    const allFeatures = [];
    let totalOrigCoords = 0;
    let totalSimpCoords = 0;

    for (const pref of TOHOKU_PREFS) {
        const buf = zipBuffers[pref.code];
        if (!buf) continue;

        const beforeCount = allFeatures.length;

        try {
            const { shp, dbf } = await extractShapefileBuffers(buf);
            const source = await shapefile.open(shp, dbf, { encoding: 'shift_jis' });

            while (true) {
                const result = await source.read();
                if (result.done) break;

                const props = result.value.properties;
                const geom = result.value.geometry;
                if (!geom || !geom.coordinates || geom.coordinates.length === 0) continue;

                const origCount = countCoords(geom);
                totalOrigCoords += origCount;

                const sectionCode = String(props.W05_003 || '0');
                const sectionType = SECTION_TYPE_MAP[sectionCode] || '不明';
                const wsCode = String(props.W05_001 || '');
                const wsName = waterSystemMap.get(wsCode) || '';

                // Simplify
                let simpGeom;
                try {
                    const simplified = simplify(
                        { type: 'Feature', properties: {}, geometry: geom },
                        { tolerance: SIMPLIFY_TOLERANCE, highQuality: false }
                    );
                    simpGeom = simplified.geometry;
                } catch (e) {
                    simpGeom = geom;
                }

                const simpCount = countCoords(simpGeom);
                totalSimpCoords += simpCount;

                // 2点未満のラインはスキップ
                if (simpGeom.type === 'LineString' && simpGeom.coordinates.length < 2) continue;

                allFeatures.push({
                    type: 'Feature',
                    properties: {
                        name: props.W05_004 || '',
                        waterSystem: wsName,
                        sectionType,
                        sectionCode,
                    },
                    geometry: simpGeom,
                });
            }
        } catch (e) {
            console.error(`   ${pref.name}: ${e.message}`);
        }

        console.log(`   ${pref.name}: ${allFeatures.length - beforeCount} フィーチャ`);
    }

    // ──────────────────────────
    // Step 4: GeoJSON出力
    // ──────────────────────────
    console.log('\nStep 4: GeoJSONファイル出力');

    const geojson = {
        type: 'FeatureCollection',
        features: allFeatures,
    };

    const publicDir = path.join(__dirname, '../public/data');
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
    }

    const outputPath = path.join(publicDir, 'tohoku_rivers_ksj.geojson');
    const jsonStr = JSON.stringify(geojson);
    fs.writeFileSync(outputPath, jsonStr);

    const fileSizeMB = (Buffer.byteLength(jsonStr) / 1024 / 1024).toFixed(2);
    const reduction = ((1 - totalSimpCoords / totalOrigCoords) * 100).toFixed(1);

    console.log(`\n========================================`);
    console.log(`✅ 完了！`);
    console.log(`   出力先: ${outputPath}`);
    console.log(`   フィーチャ数: ${allFeatures.length}`);
    console.log(`   頂点数: ${totalOrigCoords.toLocaleString()} → ${totalSimpCoords.toLocaleString()} (${reduction}% 削減)`);
    console.log(`   ファイルサイズ: ${fileSizeMB} MB`);
    console.log(`========================================`);
}

main().catch(e => console.error(e));

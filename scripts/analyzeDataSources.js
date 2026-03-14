// エンコーディング対応データソース解析スクリプト
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fetch from 'node-fetch';
import { TextDecoder } from 'util';
import { writeFileSync } from 'fs';

// iconv-liteがなくてもTextDecoderでshift_jis/euc-jpデコード可能
async function fetchAndDecode(url, encoding) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
    });
    const buffer = await res.arrayBuffer();
    const decoder = new TextDecoder(encoding);
    return decoder.decode(buffer);
}

// 1. 宮城県ダム現況表の解析
async function analyzeMiyagiDam() {
    console.log('\n========================================');
    console.log('1. 宮城県ダム現況表の解析');
    console.log('========================================');
    try {
        const html = await fetchAndDecode(
            'https://www.dobokusougou.pref.miyagi.jp/miyagi/servlet/Gamen42Servlet',
            'shift_jis'
        );
        // テーブルデータを抽出 - ダム名、貯水位、有効貯水量、貯水率を探す
        // まずHTMLの構造を見る
        const tableMatches = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
        console.log(`テーブル数: ${tableMatches.length}`);

        // ダム関連キーワードを探す
        const damKeywords = ['貯水率', '貯水位', '流入量', '放流量', '鳴子', '釜房', '七ヶ宿', '漆沢', '宮床', '南川', '樽水', '惣の関'];
        for (const kw of damKeywords) {
            const found = html.includes(kw);
            console.log(`  "${kw}": ${found ? '✅ 発見' : '❌ なし'}`);
        }

        // テキストからダム名近辺を抽出
        for (const damName of ['鳴子', '釜房', '七ヶ宿', '漆沢', '岩堂沢', '栗駒', '二ツ石']) {
            const idx = html.indexOf(damName);
            if (idx > -1) {
                // 前後200文字のHTMLタグを除去して表示
                const context = html.substring(Math.max(0, idx - 100), idx + 200)
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                console.log(`\n  ${damName}ダム付近: ...${context}...`);
            }
        }

        // HTMLをファイルに保存
        writeFileSync('tmp_miyagi_decoded.html', html, 'utf-8');
        console.log('\n  → tmp_miyagi_decoded.htmlに保存');
    } catch (e) {
        console.log(`エラー: ${e.message}`);
    }
}

// 2. DspDamDataの解析
async function analyzeDspDamData() {
    console.log('\n========================================');
    console.log('2. DspDamData (旧river.go.jp) の解析');
    console.log('========================================');
    try {
        const html = await fetchAndDecode(
            'http://www1.river.go.jp/cgi-bin/DspDamData.exe?ID=1368040700010&KIND=3',
            'euc-jp'
        );
        // テーブルデータを抽出
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        console.log(`デコード内容:\n${text.substring(0, 1500)}`);

        writeFileSync('tmp_dspdam_decoded.html', html, 'utf-8');
        console.log('\n→ tmp_dspdam_decoded.htmlに保存');

        // 別のIDでも試す (釜房ダム: 0204050700017)
        console.log('\n--- 釜房ダムID候補で試行 ---');
        const html2 = await fetchAndDecode(
            'http://www1.river.go.jp/cgi-bin/DspDamData.exe?ID=0204050700017&KIND=3',
            'euc-jp'
        );
        const text2 = html2.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        console.log(`内容: ${text2.substring(0, 500)}`);
    } catch (e) {
        console.log(`エラー: ${e.message}`);
    }
}

// 3. 川の防災情報 - 内部APIエンドポイントの探索
async function analyzeKawabou() {
    console.log('\n========================================');
    console.log('3. 川の防災情報 内部API探索');
    console.log('========================================');

    // JavaScriptバンドルからAPIパスを探す
    try {
        const mainPage = await fetchAndDecode(
            'https://www.river.go.jp/kawabou/pcfull/tm?itmkndCd=6&prefCd=04',
            'utf-8'
        );
        // jsファイルのパスを抽出
        const jsFiles = mainPage.match(/src="([^"]*\.js[^"]*)"/g) || [];
        console.log(`JSファイル: ${jsFiles.length}個`);
        jsFiles.forEach(f => console.log(`  ${f}`));

        // 既知のAPIパターンを試す
        const apiUrls = [
            'https://www.river.go.jp/kawabou/api/areaMap/damObs?prefCd=04',
            'https://www.river.go.jp/kawabou/reference/dam/04',
            'https://www.river.go.jp/kawabou/ipDamTokei/list?prefCd=04',
        ];
        for (const url of apiUrls) {
            try {
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
                });
                console.log(`\n  ${url}`);
                console.log(`  Status: ${res.status}, Content-Type: ${res.headers.get('content-type')}`);
                if (res.status === 200) {
                    const body = await res.text();
                    console.log(`  Body (first 300): ${body.substring(0, 300)}`);
                }
            } catch (e) {
                console.log(`  ${url} → Error: ${e.message}`);
            }
        }
    } catch (e) {
        console.log(`エラー: ${e.message}`);
    }
}

async function main() {
    await analyzeMiyagiDam();
    await analyzeDspDamData();
    await analyzeKawabou();
}

main();

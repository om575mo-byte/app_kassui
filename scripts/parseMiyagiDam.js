// 宮城県ダム現況表HTMLの詳細解析
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fetch from 'node-fetch';
import { TextDecoder } from 'util';

async function fetchAndDecode(url, encoding) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
    });
    const buffer = await res.arrayBuffer();
    const decoder = new TextDecoder(encoding);
    return decoder.decode(buffer);
}

async function main() {
    const html = await fetchAndDecode(
        'https://www.dobokusougou.pref.miyagi.jp/miyagi/servlet/Gamen42Servlet',
        'shift_jis'
    );

    // 1. 全ダムのstationNoとダム名を抽出
    console.log('=== ダム一覧（stationNo） ===');
    const damRegex = /chengeGamen2\('Gamen41Servlet','stationNo','(\d+)'\)">([^<]+)</g;
    let match;
    const dams = [];
    while ((match = damRegex.exec(html)) !== null) {
        dams.push({ stationNo: match[1], name: match[2] });
        console.log(`  ${match[1]}: ${match[2]}`);
    }
    console.log(`\n合計: ${dams.length}ダム\n`);

    // 2. テーブル行を解析してデータを抽出
    // tableの<tr>の中の<td>からデータを取得
    console.log('=== テーブル構造解析 ===');

    // ヘッダー行を探す
    const headerRegex = /<th[^>]*>(.*?)<\/th>/gi;
    let headerMatch;
    const headers = [];
    while ((headerMatch = headerRegex.exec(html)) !== null) {
        const text = headerMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
        if (text) headers.push(text);
    }
    console.log(`ヘッダー: ${headers.join(' | ')}\n`);

    // 各ダム周辺のデータを取得
    console.log('=== 各ダムのデータ ===');
    for (const dam of dams.slice(0, 15)) {
        const damIdx = html.indexOf(dam.name);
        if (damIdx === -1) continue;

        // ダム名を含む<tr>行を探す
        const trStart = html.lastIndexOf('<tr', damIdx);
        const trEnd = html.indexOf('</tr>', damIdx);
        if (trStart === -1 || trEnd === -1) continue;

        const trContent = html.substring(trStart, trEnd + 5);

        // <td>の内容を抽出
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch;
        const cells = [];
        while ((tdMatch = tdRegex.exec(trContent)) !== null) {
            const cellText = tdMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            cells.push(cellText);
        }
        console.log(`\n${dam.name} (${dam.stationNo}):`);
        console.log(`  セル: ${cells.join(' | ')}`);
    }

    // 3. 個別ダムページ(Gamen41Servlet)を確認
    console.log('\n\n=== 個別ダムページ (鳴子ダム) ===');
    try {
        const detailHtml = await fetchAndDecode(
            'https://www.dobokusougou.pref.miyagi.jp/miyagi/servlet/Gamen41Servlet?stationNo=104007201',
            'shift_jis'
        );
        // データテーブルを探す
        const detailText = detailHtml
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        console.log(`\nページ内容 (先頭2000文字):\n${detailText.substring(0, 2000)}`);
    } catch (e) {
        console.log(`エラー: ${e.message}`);
    }
}

main();

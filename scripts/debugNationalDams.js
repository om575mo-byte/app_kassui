// 国交省ダムテーブル(Table2/3)の構造を詳細調査
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fetch from 'node-fetch';
import { TextDecoder } from 'util';

async function main() {
    const res = await fetch(
        'https://www.dobokusougou.pref.miyagi.jp/miyagi/servlet/Gamen42Servlet',
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const buffer = await res.arrayBuffer();
    const html = new TextDecoder('shift_jis').decode(buffer);

    // 各テーブルの範囲を特定
    const tableStarts = [];
    const tableEnds = [];
    let searchPos = 0;
    while (true) {
        const start = html.indexOf('<table', searchPos);
        if (start === -1) break;
        tableStarts.push(start);
        const end = html.indexOf('</table>', start);
        tableEnds.push(end + 8);
        searchPos = end + 1;
    }

    console.log(`テーブル数: ${tableStarts.length}`);

    // テーブル2と3の内容を確認（国交省ダムがいるはず）
    for (let t = 1; t < tableStarts.length; t++) {
        const tableHtml = html.substring(tableStarts[t], tableEnds[t]);
        console.log(`\n=== Table ${t} (position ${tableStarts[t]}) ===`);
        console.log(`サイズ: ${tableHtml.length}文字`);

        // tdの内容を全て出力
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let match;
        let idx = 0;
        while ((match = tdRegex.exec(tableHtml)) !== null) {
            const text = match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
            if (text) {
                console.log(`  [${idx}] = "${text}"`);
            }
            idx++;
        }
    }

    // 主テーブル（Table 0）で「長沼ダム」と「払川ダム」を見つけた後、残りのtdを確認
    console.log('\n=== Table 0 - 末尾部分 ===');
    const table0 = html.substring(tableStarts[0], tableEnds[0]);
    const tdAll = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = tdRegex.exec(table0)) !== null) {
        const text = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
        tdAll.push(text);
    }
    console.log(`Table0のtd数: ${tdAll.length}`);

    // 払川ダムの位置を特定
    const payIdx = tdAll.indexOf('払川ダム');
    console.log(`払川ダム位置: ${payIdx}`);
    if (payIdx > -1) {
        console.log('払川ダム以降の全セル:');
        for (let i = payIdx; i < Math.min(payIdx + 50, tdAll.length); i++) {
            console.log(`  [${i}] = "${tdAll[i]}"`);
        }
    }
}

main();

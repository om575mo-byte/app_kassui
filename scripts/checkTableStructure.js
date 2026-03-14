// テーブルカラム構造の確認
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

    // ダム名を含むtrを見つけて、全tdのテキストを順序通りに出力
    // 大倉ダムの行を例として
    const damName = '大倉ダム';
    const damIdx = html.indexOf(damName);

    // trの開始を見つける（複数ネストの可能性）
    let searchStart = damIdx;
    for (let i = 0; i < 3; i++) {
        const prev = html.lastIndexOf('<tr', searchStart - 1);
        if (prev === -1) break;
        searchStart = prev;
    }

    // trの中身を表示
    const trEnd = html.indexOf('</tr>', damIdx);
    const trContent = html.substring(searchStart, trEnd + 5);

    // tdを順番に
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let match;
    let idx = 0;
    while ((match = tdRegex.exec(trContent)) !== null) {
        const text = match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
        console.log(`  [${idx}] = "${text}"`);
        idx++;
    }

    // ヘッダー部分を探して表示
    console.log('\n=== テーブルヘッダー ===');
    // テーブルのth or headerを探す
    // Gamen42にはtdベースのヘッダーが多い
    const headerIndex = html.indexOf('貯水位');
    if (headerIndex > -1) {
        const hStart = html.lastIndexOf('<tr', headerIndex);
        const hEnd = html.indexOf('</tr>', headerIndex);
        const hRow = html.substring(hStart, hEnd + 5);
        const hTdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let hm;
        let hi = 0;
        while ((hm = hTdRegex.exec(hRow)) !== null) {
            const text = hm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
            console.log(`  Header[${hi}] = "${text}"`);
            hi++;
        }
    }

    // 利水貯水率の列を確認
    console.log('\n=== 利水貯水率周辺の構造 ===');
    const risuiIdx = html.indexOf('利水');
    if (risuiIdx > -1) {
        const context = html.substring(risuiIdx - 200, risuiIdx + 200)
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        console.log(context);
    }

    // 2つ目のテーブル構造も確認（貯水率と利水貯水率が別テーブルの可能性）
    console.log('\n=== 二ツ石ダムのデータ ===');
    const dam2 = '二ツ石ダム';
    const dam2Idx = html.indexOf(dam2);
    if (dam2Idx > -1) {
        let s2 = dam2Idx;
        for (let i = 0; i < 3; i++) {
            const prev = html.lastIndexOf('<tr', s2 - 1);
            if (prev === -1) break;
            s2 = prev;
        }
        const e2 = html.indexOf('</tr>', dam2Idx);
        const row2 = html.substring(s2, e2 + 5);
        const td2Regex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let m2;
        let i2 = 0;
        while ((m2 = td2Regex.exec(row2)) !== null) {
            const text = m2[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
            console.log(`  [${i2}] = "${text}"`);
            i2++;
        }
    }
}

main();

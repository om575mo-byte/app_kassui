// ダム座標抽出スクリプト
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// dam_syoryou_url.txt からのURL一覧
const DAMS = [
    { name: '大倉ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/184' },
    { name: '樽水ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/185' },
    { name: '七北田ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/186' },
    { name: '南川ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/183' },
    { name: '宮床ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/189' },
    { name: '惣の関ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/190' },
    { name: '漆沢ダム', id: 182 },
    { name: '化女沼ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/187' },
    { name: '上大沢ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/191' },
    { name: '花山ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/181' },
    { name: '荒砥沢ダム', id: 188 },
    { name: '小田ダム', id: 192 },
    { name: '払川ダム', id: 193 },
    { name: '鳴子ダム', id: 20 },
    { name: '釜房ダム', id: 22 },
    { name: '七ヶ宿ダム', url: 'https://mudam.nilim.go.jp/chronology/summary/27' },
];

async function extractCoords(name, url) {
    try {
        const res = await fetch(url);
        const html = await res.text();
        const $ = cheerio.load(html);

        // テーブルからデータを探す
        const allText = $('body').text();

        // 緯度経度パターン（度分秒形式）
        const dmsPattern = /(\d{2,3})[°度]\s*(\d{1,2})[\'′分]\s*(\d{1,2})[\"″秒]?/g;
        const dmsMatches = [...allText.matchAll(dmsPattern)];

        // 10進表記パターン
        const decPattern = /(3[5-9]\.\d+|14[0-2]\.\d+)/g;
        const decMatches = [...allText.matchAll(decPattern)];

        // テーブルのtd内容を探す
        const tdTexts = [];
        $('td, th').each((i, el) => {
            const text = $(el).text().trim();
            if (text && (text.includes('緯度') || text.includes('経度') || text.includes('位置') ||
                text.match(/\d{2,3}°/) || text.match(/\d{2,3}度/))) {
                tdTexts.push(text);
            }
        });

        console.log(`\n[${name}] ${url}`);
        if (dmsMatches.length > 0) {
            console.log('  DMS matches:', dmsMatches.map(m => `${m[1]}°${m[2]}'${m[3]}"`));
        }
        if (decMatches.length > 0) {
            console.log('  Decimal matches:', decMatches.map(m => m[0]));
        }
        if (tdTexts.length > 0) {
            console.log('  Location cells:', tdTexts);
        }
        if (dmsMatches.length === 0 && decMatches.length === 0 && tdTexts.length === 0) {
            // 全テキストの一部を出力してデバッグ
            const lines = allText.split('\n').filter(l => l.trim());
            const coordLines = lines.filter(l =>
                l.includes('緯') || l.includes('経') || l.includes('位置') || l.includes('所在') ||
                l.match(/\d{2,3}[°度]/)
            );
            if (coordLines.length > 0) {
                console.log('  Possible coord lines:', coordLines.slice(0, 5));
            } else {
                console.log('  No coordinates found. Sample text:', allText.substring(0, 300));
            }
        }
    } catch (e) {
        console.log(`[${name}] Error: ${e.message}`);
    }
}

async function main() {
    for (const dam of DAMS) {
        const url = dam.url || `https://mudam.nilim.go.jp/chronology/summary/${dam.id}`;
        await extractCoords(dam.name, url);
        // 負荷軽減
        await new Promise(r => setTimeout(r, 1000));
    }
}

main();

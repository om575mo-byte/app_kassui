// Gamen41Servlet (水位経過ページ) のHTMLを取得して保存するスクリプト
import fetch from 'node-fetch';
import https from 'https';
import fs from 'fs';

const agent = new https.Agent({ rejectUnauthorized: false });

const stationNo = process.argv[2] || '104004010'; // 広瀬橋
const url = `https://www.dobokusougou.pref.miyagi.jp/miyagi/servlet/Gamen41Servlet?stationNo=${stationNo}`;

console.log(`Fetching: ${url}`);

const response = await fetch(url, { agent });
const buffer = await response.arrayBuffer();
const html = new TextDecoder('shift-jis').decode(buffer);

const filename = `tmp_g41_${stationNo}.html`;
fs.writeFileSync(filename, html);
console.log(`Saved to ${filename} (${html.length} chars)`);

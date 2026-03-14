// データソース調査スクリプト
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fetch from 'node-fetch';

const sources = [
    {
        name: '宮城県ダム現況表',
        url: 'https://www.dobokusougou.pref.miyagi.jp/miyagi/servlet/Gamen42Servlet',
    },
    {
        name: 'DspDamData (鳴子ダム想定)',
        url: 'http://www1.river.go.jp/cgi-bin/DspDamData.exe?ID=1368040700010&KIND=3',
    },
    {
        name: '川の防災情報 ダム一覧API候補1',
        url: 'https://www.river.go.jp/kawabou/ipDamKobetu.do?init=init&obsrvId=2041050001&gession=dummy',
    },
    {
        name: '川の防災情報 テレメータ',
        url: 'https://www.river.go.jp/kawabou/pcfull/tm?itmkndCd=6&prefCd=04',
    },
];

async function checkSource(src) {
    console.log(`\n=== ${src.name} ===`);
    console.log(`URL: ${src.url}`);
    try {
        const res = await fetch(src.url, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            redirect: 'follow',
        });
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log(`Content-Type: ${res.headers.get('content-type')}`);
        console.log(`Content-Length: ${res.headers.get('content-length') || 'unknown'}`);

        const buffer = await res.buffer();
        console.log(`Body size: ${buffer.length} bytes`);

        // Try to detect encoding and convert
        const text = buffer.toString('utf-8');
        // Show first 500 chars (ASCII-safe)
        const preview = text.substring(0, 800).replace(/[^\x20-\x7E\n\r\t]/g, '?');
        console.log(`Preview:\n${preview}`);

        // Look for dam-related keywords in raw bytes
        const hasTable = text.includes('<table') || text.includes('<TABLE');
        const hasForm = text.includes('<form') || text.includes('<FORM');
        const hasJson = text.includes('{') && text.includes('"');
        console.log(`Has table: ${hasTable}, Has form: ${hasForm}, Possible JSON: ${hasJson}`);
    } catch (e) {
        console.log(`Error: ${e.message}`);
    }
}

async function main() {
    for (const src of sources) {
        await checkSource(src);
        await new Promise(r => setTimeout(r, 1000));
    }
}

main();

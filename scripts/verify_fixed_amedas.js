import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

async function testStation(url, label) {
    console.log(`\nTesting ${label}...`);
    try {
        const res = await fetch(url);
        const html = await res.text();
        const $ = cheerio.load(html);
        const rows = $('table#tablefix1 tr.mtx');
        console.log(`Rows found: ${rows.length}`);
        if (rows.length > 0) {
            console.log(`Sample data from first row: ${$(rows[0]).text().trim().substring(0, 50)}...`);
        }
    } catch (e) {
        console.error(`Error: ${e.message}`);
    }
}

async function main() {
    await testStation('https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php?prec_no=34&block_no=0251&year=2024&month=2&day=&view=', 'Nikkawa (Corrected ID: 0251)');
    await testStation('https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php?prec_no=33&block_no=0230&year=2024&month=2&day=&view=', 'Kitakami (Corrected ID: 0230)');
    await testStation('https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php?prec_no=33&block_no=0229&year=2024&month=2&day=&view=', 'Yuda (Corrected ID: 0229)');
}

main();

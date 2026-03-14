import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

async function debugScraping(url, label) {
    console.log(`\n--- Debugging ${label} ---`);
    console.log(`URL: ${url}`);
    
    try {
        const res = await fetch(url);
        const html = await res.text();
        const $ = cheerio.load(html);
        
        const table = $('table#tablefix1');
        console.log(`Table #tablefix1 found: ${table.length > 0}`);
        
        const mtxRows = $('table#tablefix1 tr.mtx');
        console.log(`Rows with class 'mtx' found: ${mtxRows.length}`);
        
        if (mtxRows.length === 0) {
            console.log("Snippet of HTML around body:");
            console.log($('body').html().substring(0, 1000));
            
            // tr.mtxがない場合、全てのtrを確認
            const allRows = $('table#tablefix1 tr');
            console.log(`Total rows in table: ${allRows.length}`);
            if (allRows.length > 0) {
                console.log("First row classes:", $(allRows[0]).attr('class'));
                console.log("Second row classes:", $(allRows[1]).attr('class'));
            }
        }
    } catch (e) {
        console.error(`Error: ${e.message}`);
    }
}

async function main() {
    // 成功している仙台 (s1)
    await debugScraping('https://www.data.jma.go.jp/stats/etrn/view/daily_s1.php?prec_no=34&block_no=47590&year=2024&month=2&day=&view=', 'Sendai (Observatory)');
    
    // 失敗している新川 (a1)
    await debugScraping('https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php?prec_no=34&block_no=0300&year=2024&month=2&day=&view=', 'Nikkawa (AMeDAS)');
    
    // 失敗している胆沢/北上 (a1)
    await debugScraping('https://www.data.jma.go.jp/stats/etrn/view/daily_a1.php?prec_no=33&block_no=0411&year=2024&month=2&day=&view=', 'Kitakami (AMeDAS)');
}

main();

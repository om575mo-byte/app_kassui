// テスト: 水文水質データベースからリアルタイム水位データを取得
// URL: https://www1.river.go.jp/cgi-bin/DspWaterData.exe?KIND=9&ID=XXXXX
// KIND=9 はリアルタイム10分水位
import fetch from 'node-fetch';

// ステップ1: DspWaterData.exe にアクセスして .dat ダウンロードURLを取得
// ステップ2: .dat ファイルを取得してCSVをパース

const stationId = '302031282207150'; // 落合

async function fetchWaterLevel(id) {
    // まずHTMLページ取得
    const pageUrl = `https://www1.river.go.jp/cgi-bin/DspWaterData.exe?KIND=9&ID=${id}`;
    console.log(`Fetching page: ${pageUrl}`);

    const pageRes = await fetch(pageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const pageHtml = await pageRes.text();

    // .dat ファイルURLを抽出
    const datMatch = pageHtml.match(/href="([^"]*\.dat)"/i)
        || pageHtml.match(/(\/dat\/dload\/download\/[^\s"'<>]+\.dat)/i)
        || pageHtml.match(/(https?:\/\/[^\s"'<>]*\.dat)/i);

    if (!datMatch) {
        // HTMLの内容を確認
        console.log('HTML content (first 2000 chars):');
        console.log(pageHtml.substring(0, 2000));
        console.log('\n... looking for dat url pattern ...');
        // 別パターンで探す
        const allUrls = pageHtml.match(/[^\s"'<>]+\.dat/gi);
        console.log('All .dat URLs found:', allUrls);
        return;
    }

    let datUrl = datMatch[1];
    if (datUrl.startsWith('/')) {
        datUrl = `https://www1.river.go.jp${datUrl}`;
    }
    console.log(`Found .dat URL: ${datUrl}`);

    // .dat ファイルを取得
    const datRes = await fetch(datUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const datBuffer = await datRes.arrayBuffer();
    // Shift-JIS エンコーディングの可能性
    const datText = new TextDecoder('shift-jis').decode(datBuffer);

    // ヘッダー部分を表示
    const lines = datText.split('\n');
    console.log('\nHeader lines:');
    for (let i = 0; i < Math.min(10, lines.length); i++) {
        console.log(`  ${lines[i].trim()}`);
    }

    // 最新の有効データを取得（後ろから探す）
    console.log('\nLatest data entries:');
    const dataLines = lines.filter(l => /^\d{4}\//.test(l.trim()));
    // 最新の有効データ（値がある行）
    const validLines = dataLines.filter(l => {
        const parts = l.trim().split(',');
        return parts.length >= 3 && parts[2] !== '-' && parts[2] !== '' && parts[2].trim() !== '';
    });

    if (validLines.length > 0) {
        const latest = validLines[validLines.length - 1].trim().split(',');
        console.log(`  最新データ: ${latest[0]} ${latest[1]} 水位=${latest[2]}m ${latest[3] ? '流量=' + latest[3] : ''}`);
        console.log(`  (全${validLines.length}件の有効データ中)`);
    } else {
        console.log('  有効データなし');
    }

    // 直近5行を表示
    console.log('\n  直近のデータ行:');
    for (const line of dataLines.slice(-10)) {
        console.log(`    ${line.trim()}`);
    }
}

fetchWaterLevel(stationId).catch(console.error);

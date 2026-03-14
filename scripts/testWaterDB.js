// WaterLevelScraper 最終統合テスト
import { WaterLevelScraper } from '../server/services/WaterLevelScraper.js';

const scraper = new WaterLevelScraper();

console.log('=== WaterLevelScraper 最終テスト ===\n');
const results = await scraper.fetchAllStations();

console.log('\n=== 結果一覧 ===');
for (const r of results) {
    const status = r.isLiveData ? '✅' : '❌';
    const wl = r.waterLevel !== null ? `${r.waterLevel} m` : 'N/A';
    const time = r.observedAt || '-';
    console.log(`${status} ${r.name} (${r.river}): 水位=${wl}, 観測時刻=${time}`);
}

const liveCount = results.filter(r => r.isLiveData).length;
console.log(`\n合計: ${liveCount}/${results.length} 観測所でデータ取得成功`);

import { MiyagiDamScraper } from '../server/services/MiyagiDamScraper.js';

(async () => {
    try {
        const scraper = new MiyagiDamScraper();
        const data = await scraper.fetchCurrentData();
        const n = data.find(x => x.damName.includes('鳴子'));
        console.log("鳴子ダム パース結果:");
        console.log(JSON.stringify(n, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
})();

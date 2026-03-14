import fetch from 'node-fetch';

async function verifyKawabouAPI() {
    try {
        console.log('--- 1. 観測所マスタ (都道府県: 401, 宮城県) の取得 ---');
        // https://www.river.go.jp/kawabou/file/files/obslist/twninfo/obs/dam/04.json
        const masterRes = await fetch('https://www.river.go.jp/kawabou/file/files/obslist/twninfo/obs/dam/401.json');
        if (!masterRes.ok) throw new Error(`Master API failed: ${masterRes.status}`);
        const masterData = await masterRes.json();

        const damMasterMap = new Map();
        if (masterData.prefTwn) {
            masterData.prefTwn.forEach(twn => {
                if (twn.dam) {
                    twn.dam.forEach(dam => {
                        damMasterMap.set(dam.obsFcd, {
                            name: dam.obsNm,
                            river: dam.rivNm,
                            system: dam.wsNm
                        });
                    });
                }
            });
        }
        console.log(`抽出したダムマスタ数: ${damMasterMap.size}`);

        console.log('\n--- 2. 実況データ (都道府県: 401, 宮城県) の取得 ---');
        // 実況データは prefCd="401" という内部コードを使う場合がある
        const dataRes = await fetch('https://www.river.go.jp/kawabou/file/files/obslist/twninfo/tm/dam/401.json');
        if (!dataRes.ok) throw new Error(`Data API failed: ${dataRes.status}`);
        const dataJson = await dataRes.json();

        let matchedCount = 0;
        if (dataJson.prefTwn) {
            dataJson.prefTwn.forEach(twn => {
                if (twn.dam) {
                    twn.dam.forEach(dam => {
                        const masterInfo = damMasterMap.get(dam.obsFcd) || { name: 'Unknown' };
                        // 大倉, 鳴子, 釜房 をピックアップ
                        if (['大倉', '鳴子', '釜房'].some(name => masterInfo.name.includes(name))) {
                            console.log(`\n[${masterInfo.name}] (${dam.obsFcd}) at ${dam.obsTime}`);
                            console.log(`  貯水位: ${dam.storLvl} m`);
                            console.log(`  貯水量: ${dam.storCap} 千㎥`);
                            console.log(`  流入量: ${dam.allSink} ㎥/s`);
                            console.log(`  放流量: ${dam.allDisch} ㎥/s`);
                            console.log(`  貯水率: ${dam.storPcntIrr}% (Irr) / ${dam.storPcntEff}% (Eff)`);
                            matchedCount++;
                        }
                    });
                }
            });
        }
        console.log(`\n対象ダムのマッチ数: ${matchedCount}`);

    } catch (error) {
        console.error('API Verification Error:', error.message);
    }
}

verifyKawabouAPI();

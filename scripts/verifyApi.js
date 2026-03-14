// APIレスポンス検証
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
    const res = await fetch('http://localhost:3001/api/dams');
    const data = await res.json();

    console.log(`dataSource: ${data.dataSource}`);
    console.log(`lastUpdated: ${data.lastUpdated}`);
    console.log(`dams count: ${data.dams.length}\n`);

    console.log('=== Summary ===');
    console.log(JSON.stringify(data.summary, null, 2));

    console.log('\n=== Dam Data ===');
    data.dams.forEach(d => {
        const live = d.isLiveData ? '🟢' : '⚪';
        const rate = d.storageRate !== null ? `${d.storageRate}%` : 'N/A';
        const vol = d.storageVolume !== null ? `${d.storageVolume}千m3` : 'N/A';
        const level = d.droughtLevel?.id || 'unknown';
        const calc = d._calcStorageRate !== null ? `${d._calcStorageRate}%` : 'N/A';
        console.log(`${live} ${d.name}: 利水貯水率=${rate}, 貯水量=${vol}, レベル=${level}, 計算値=${calc}`);
    });
}

main().catch(e => console.error(e));

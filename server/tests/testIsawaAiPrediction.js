import { DataAggregator } from '../services/DataAggregator.js';

async function testIsawaPrediction() {
    console.log("=== Testing Isawa AI Prediction ===");
    const aggregator = new DataAggregator();

    // 予測機能が参照するダミーのダムデータ
    const dummyDamData = {
        waterLevel: 310.5,
        inflowRate: 15.2,
        outflowRate: 15.0
    };

    // 予測機能が参照するダミーの天気予報データ
    const dummyForecastData = {
        regions: [{
            weekly: [
                { maxTemp: '10', minTemp: '0', pop: '30' },
                { maxTemp: '12', minTemp: '2', pop: '10' }
            ]
        }]
    };

    console.log("Input Dam Data:", dummyDamData);
    
    try {
        const result = await aggregator.getIsawaAiPrediction(dummyDamData, dummyForecastData);
        console.log("\n=== Prediction Result ===");
        if (result) {
            console.log(JSON.stringify(result, null, 2));
            console.log("\n✅ Test Passed: Successfully retrieved AI Prediction result for Isawa Dam.");
        } else {
            console.error("\n❌ Test Failed: AI Prediction returned null or undefined.");
        }
    } catch (e) {
        console.error("\n❌ Test Failed with Exception:", e);
    }
}

testIsawaPrediction();

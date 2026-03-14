---
name: 1ヶ月予報のAI予測統合
description: 気象庁の1か月予報（季節予報）確率データを、既存のダムAI貯水位予測モデルに新特徴量として組み込むための手順とノウハウ。鳴子ダムでの実装実績に基づく。
---

# 1ヶ月予報をAI予測に統合する手順

既存のAI予測パイプライン（`add_new_ai_prediction` スキル参照）に、気象庁の1か月予報データを追加特徴量として導入する手順。
鳴子ダムでの実装を参考実装としている。

## 前提条件
- 対象ダムのAI予測パイプライン（EDA → Train → Predict → DataAggregator統合）が既に完成していること
- `SeasonalForecastScraper.js` が既に存在すること（全ダム共通で使用可能）

---

## 1. SeasonalForecastScraper（共通コンポーネント）

### 概要
気象庁の季節予報JSON APIから、東北地方の1ヶ月先の降水量・気温の3階級確率を取得する。

### API仕様
- **エンドポイント**: `https://www.jma.go.jp/bosai/season/data/P1M/{地域コード}.json`
- **東北地方コード**: `010200`
- **更新頻度**: 毎週木曜日 14:30
- **キャッシュTTL**: 24時間

### JSONの構造（重要）
確率データは**ネストされた構造**にある。直接 `data.metInfos[i]` にアクセスしても取得できない。

```
正しいパス: data.metInfos[].items[] → type === '地域・期間平均平年偏差各階級の確率'
```

```javascript
for (const metInfo of data.metInfos) {
    if (!metInfo.items || !Array.isArray(metInfo.items)) continue;
    for (const item of metInfo.items) {
        if (item.type === '地域・期間平均平年偏差各階級の確率') {
            // item.kind: '降水量' | '気温' | '日照時間'
            // item.below, item.normal, item.above: 確率値(文字列)
        }
    }
}
```

### 取得される6個の特徴量
| 特徴量名 | 内容 | 範囲 |
| :--- | :--- | :--- |
| `Forecast_1M_Precip_Below` | 降水量「少ない」確率 | 0-100 |
| `Forecast_1M_Precip_Normal` | 降水量「平年並」確率 | 0-100 |
| `Forecast_1M_Precip_Above` | 降水量「多い」確率 | 0-100 |
| `Forecast_1M_Temp_Below` | 気温「低い」確率 | 0-100 |
| `Forecast_1M_Temp_Normal` | 気温「平年並」確率 | 0-100 |
| `Forecast_1M_Temp_Above` | 気温「高い」確率 | 0-100 |

### フォールバック戦略
API取得に失敗した場合は **等確率 (33/34/33)** を返す。これは「情報なし」のニュートラルなシグナルとしてモデルに影響を与えない。

### 他地域への展開時
東北以外のダムに適用する場合は、地域コードを変更する:
- 北海道: `010100`
- 関東甲信: `010300`
- 東海: `010400`
- 近畿: `010500`
- 全コード一覧: `https://www.jma.go.jp/bosai/season/` のネットワークリクエストから確認可能

---

## 2. EDAスクリプトの修正（`scripts/eda_[dam_name].py`）

### 追加する処理: 三分位点ベースの確率シミュレーション

過去の気象庁1ヶ月予報確率データは入手困難なため、**過去の気象実績から「理想的な予報確率」を逆算シミュレーション**する。

### 実装手順

#### Step 1: 向こう30日間の実績値を計算
```python
merged_df['_future_precip_30d'] = merged_df['Precipitation'].shift(-30).rolling(window=30).sum()
merged_df['_future_temp_30d'] = merged_df['AvgTemp'].shift(-30).rolling(window=30).mean()
```

#### Step 2: 月ごとの三分位点を計算
```python
precip_terciles = merged_df.groupby(merged_df.index.month)['_future_precip_30d'].quantile([0.333, 0.667]).unstack()
temp_terciles = merged_df.groupby(merged_df.index.month)['_future_temp_30d'].quantile([0.333, 0.667]).unstack()
```

#### Step 3: 階級に応じたシミュレーション確率を割り当て
```python
def simulate_forecast_prob(actual_value, q33, q67):
    if actual_value <= q33:
        base = [60, 25, 15]   # 「少ない/低い」
    elif actual_value <= q67:
        base = [20, 50, 30]   # 「平年並」
    else:
        base = [15, 25, 60]   # 「多い/高い」
    
    # ±10のノイズ → 合計100に正規化
    noise = np.random.randint(-10, 11, size=3)
    probs = np.clip(np.array(base) + noise, 5, 90)
    probs = (probs / probs.sum() * 100).astype(int)
    probs[1] += 100 - probs.sum()  # 丸め誤差補正
    return probs[0], probs[1], probs[2]
```

### 設計上の注意点
- **`np.random.seed(42)`** を設定して再現性を確保すること
- シミュレーション確率のベース値 `[60,25,15]` 等は、実際の1ヶ月予報の傾向（正答率6割程度）を模倣したもの
- **作業用列 `_future_*` は最後に削除**すること
- 出力CSVのカラム数が増えるため、既存の `train_*.py` が読み込めなくなることに注意（→ Step 3で対応）

---

## 3. 学習スクリプトの修正（`scripts/train_[dam_name]_model.py`）

`features` リストに6個の確率特徴量を追加する。既存の15個の後ろに追加:

```python
features = [
    # ... 既存の15個 ...
    'Forecast_1M_Precip_Below',
    'Forecast_1M_Precip_Normal',
    'Forecast_1M_Precip_Above',
    'Forecast_1M_Temp_Below',
    'Forecast_1M_Temp_Normal',
    'Forecast_1M_Temp_Above',
]
```

### 精度への影響（鳴子ダムでの実績）
- **7日後**: ほぼ変化なし（R²=0.913）→ 長期トレンドより直近データが支配的
- **28日後**: `Forecast_1M_Precip_Above` が**特徴量重要度5位（3.2%）**にランクイン
- **60-90日後**: 月（Month）が依然支配的だが、降水確率が間接的に寄与

---

## 4. 推論スクリプトの修正（`scripts/predict_[dam_name].py`）

`feature_names` リストに同じ6個を追加。**順序は `train_*.py` と完全に一致させること。**

```python
feature_names = [
    # ... 既存の15個 ...
    'Forecast_1M_Precip_Below', 'Forecast_1M_Precip_Normal', 'Forecast_1M_Precip_Above',
    'Forecast_1M_Temp_Below', 'Forecast_1M_Temp_Normal', 'Forecast_1M_Temp_Above'
]
```

---

## 5. DataAggregator.jsの修正

### Step 1: SeasonalForecastScraperのインポートと初期化
`DataAggregator.js` の先頭に一度だけ追加（既に追加されている場合は不要）:

```javascript
import { SeasonalForecastScraper } from './SeasonalForecastScraper.js';
// constructor内:
this.seasonalForecastScraper = new SeasonalForecastScraper();
```

### Step 2: 各ダムの予測メソッド内でデータ取得
```javascript
let seasonalData;
try {
    seasonalData = await this.seasonalForecastScraper.fetchSeasonalForecast();
} catch (e) {
    console.error('[AI Prediction] SeasonalForecast error:', e.message);
    seasonalData = null;
}
```

### Step 3: features オブジェクトに追加
```javascript
const features = {
    // ... 既存の特徴量 ...
    Forecast_1M_Precip_Below: seasonalData?.Forecast_1M_Precip_Below ?? 33,
    Forecast_1M_Precip_Normal: seasonalData?.Forecast_1M_Precip_Normal ?? 34,
    Forecast_1M_Precip_Above: seasonalData?.Forecast_1M_Precip_Above ?? 33,
    Forecast_1M_Temp_Below: seasonalData?.Forecast_1M_Temp_Below ?? 33,
    Forecast_1M_Temp_Normal: seasonalData?.Forecast_1M_Temp_Normal ?? 34,
    Forecast_1M_Temp_Above: seasonalData?.Forecast_1M_Temp_Above ?? 33,
};
```

---

## 6. 検証チェックリスト

- [ ] `python scripts/eda_[dam].py` で三分位点が月別に計算されるか
- [ ] 出力CSVに6個の新カラムが含まれるか
- [ ] `python scripts/train_[dam]_model.py` でR²/MAEが旧モデルと同等以上か
- [ ] サーバーログに `[SeasonalForecast] OK: Precip=[xx/xx/xx], Temp=[xx/xx/xx]` が表示されるか（等確率でないこと）
- [ ] `[AI Prediction] Success!` が出力されるか

---

## 参考: 鳴子ダムの実装ファイル一覧

| ファイル | 役割 |
| :--- | :--- |
| `server/services/SeasonalForecastScraper.js` | 1ヶ月予報API取得（全ダム共通） |
| `scripts/eda_naruko.py` | EDA + 三分位点シミュレーション |
| `scripts/train_naruko_model.py` | 21特徴量でのモデル学習 |
| `scripts/predict_naruko.py` | 21特徴量での推論 |
| `server/services/DataAggregator.js` | スクレイパー統合・特徴量受け渡し |

---
name: 新規ダムのAI予測パイプライン追加
description: 既存の渇水可視化システムに対して、別のダムのAI貯水位予測モデル（RandomForestRegressor）を新規実装し、フロントエンドに表示させるまでの一連の手順とノウハウ。
---

# 新規ダムのAI貯水位予測パイプラインの追加手順

このスキルは、本システムに新しいダムのAI水利予測を追加する際の、必要なステップと見落としがちな設定漏れ（バックエンドのAPIマッピング等）を網羅したチェックリストです。

## 1. データの準備とEDA（探索的データ分析）
1. **必要データの収集**
   - 対象ダムの過去の水位・流入量・放流量データ（約10年分推奨）
   - 対象ダム近傍の気象データ（降水量、平均気温など）。積雪地帯の場合は最深積雪・降雪量データも必要。
2. **EDAスクリプトの実装 (`scripts/eda_[dam_name].py`)**
   - 収集したデータを読み込み、日付で結合(Inner Join)。
   - 欠損値の補間（`interpolate('linear')`など）を実施。
   - `Rolling` を用いて「過去7日間の降水量合計 (Precip_7d_sum)」「過去7日平均気温 (Temp_7d_avg)」などの特徴量を生成。
   - モデル評価用のターゲット特徴量（`shift(-N)`）の作成。
   - 結果を `docs/analysis_results/merged_[dam_name]_dataset.csv` に出力。

## 2. AI予測モデルの学習
1. **学習スクリプトの実装 (`scripts/train_[dam_name]_model.py`)**
   - 前段で作成した結合CSVを読み込む。
   - 7日先、28日先、60日先、90日先 などの目的変数ごとに `RandomForestRegressor` モデルを構築・学習。
   - 期間での Train / Test 分割（例: ~2019年がTrain、2020年~がTest）を行い、R2スコアおよびMAEで精度を確認。
   - 学習済みモデルを `models/[dam_name]_rf_7d.pkl` などとして保存。

## 3. 推論ロジックの構築
1. **推論スクリプトの実装 (`scripts/predict_[dam_name].py`)**
   - JSON形式で「現在の気象パラメータ+水位」を標準入力から受け取る。
   - 保存した `.pkl` モデルをロードし、各期間の予測（mean, std, min, max）を行う。
   - `shap.TreeExplainer` を用いて、各特徴量が予測値に与える寄与度（SHAP値）を算出。
   - レスポンスとしてJSON文字列（出力結果）を標準出力にプリントする。

## 4. サーバーAPIとDataAggregatorの結合
1. **`server/services/DataAggregator.js` へのメソッド追加**
   - `get[DamName]AiPrediction(damData, forecastData)` を新設。
   - 対象ダムの緯度経度を用い、`OpenWeatherMapService.fetchForecast(lat, lon)` で週間予報の「降水量(Forecast_Precip_7d_sum)」「平均気温(Forecast_Temp_7d_avg)」を取得。
   - `predict_[dam_name].py` を `child_process.spawn` で呼び出し（このとき、**`process.env.PYTHON_CMD` などのPython実行パスのフルパス指定**に注意）。
2. **グローバル連携ロジックへの統合**
   - `_applyAllAIPredictions()` メソッド内へ、対象ダムのAI予測を付与するブロックを追加。
   - AIの予測結果（mean）に応じて、そのダム固有の「危険・警戒・注意」レベルのしきい値判定関数 (`get[DamName]Level(level)`) を定義して付与する。

## 5. 【重要】過去推移データAPIのマッピング追加
**（※ここで設定が漏れるとフロントエンドで予測グラフが描画されません）**
1. **`server/routes/dam-history.js` の改修**
   - `DAM_CSV_MAP` オブジェクトに、対象ダムの日本語名および英字IDと結合CSVファイルのパスを追加する。
   ```javascript
   const DAM_CSV_MAP = {
       // ... existing mapping
       '新規ダム': 'merged_[dam_name]_dataset.csv',
       newdam: 'merged_[dam_name]_dataset.csv'
   };
   ```

## 6. フロントエンドでの検証
1. Nodeサーバーとフロントエンド（Vite）を再起動。
2. マップ上の新規追加したダムのピンをクリックし、詳細モーダルに以下の2点が正常に表示されるか確認する。
   - テキストベースの推論結果とSHAP根拠（増減理由）。
   - Canvas の折れ線グラフ（過去推移 + AI予測のポイント・誤差範囲）。

# 渇水状況可視化アプリ: AI予測機能のアーキテクチャ報告書

本資料は、アプリ内に実装されている各ダム（大倉ダム、鳴子ダム、釜房ダム、胆沢ダム等）のAI予測ロジックについて、学習・推論に使用しているデータやその取得方法の全容を整理したものです。

## 1. 予測モデルの概要

システムには、ダムの貯水位（向こう7日、28日、60日、90日後）を予測するための機械学習モデル（RandomForestRegressor）が組み込まれています。

- **モデルの種類**: Random Forest Regressor（ランダムフォレスト回帰）
- **推論エンジン**: Python スクリプト (`predict_*.py`)
- **連携方式**: Node.js ([DataAggregator.js](file:///c:/Users/moika/.gemini/antigravity/playground/app_kassui/server/services/DataAggregator.js)) から `child_process.spawn` 経由で推論用Pythonスクリプトを呼び出し、標準入力（JSON形式）で特徴量を送信、標準出力（JSON形式）から予測結果と変動要因（Feature Impact）を受け取るインタフェース。

---

## 2. 実装されているAI予測モデル一覧と対象観測所

ダムの予測モデルごとに、気象データ（降水量、気温、積雪深、降雪量）の取得元となる観測所が異なります。

| ダム名 | 学習時の対象アメダス（気象データ元） | リアルタイム取得先 (スクレイパー) |
| :--- | :--- | :--- |
| **鳴子ダム** | 川渡（Kawatabi） | [KawatabiWeatherScraper.js](file:///c:/Users/moika/.gemini/antigravity/playground/app_kassui/server/services/KawatabiWeatherScraper.js) |
| **釜房ダム** | 仙台（Sendai） | [SendaiWeatherScraper.js](file:///c:/Users/moika/.gemini/antigravity/playground/app_kassui/server/services/SendaiWeatherScraper.js) |
| **大倉ダム** | 新川（Nikkawa） | [NikkawaWeatherScraper.js](file:///c:/Users/moika/.gemini/antigravity/playground/app_kassui/server/services/NikkawaWeatherScraper.js) |
| **胆沢ダム** | 北上（Kitakami）と 湯田（Yuda）の平均 | [IsawaWeatherScraper.js](file:///c:/Users/moika/.gemini/antigravity/playground/app_kassui/server/services/IsawaWeatherScraper.js) |

※ 大倉ダム付近の新川は「降雪量(Snowfall)」データが存在しないなど、観測所によって利用可能なデータカラムに違いがあるため、各スクレイパー内部で適切にフォールバックや0埋め処理を行なっています。

---

## 3. 使用しているデータセット（特徴量）と取得方法

AIの学習および推論に使用される特徴量は、大きく「ダム運用データ」「気象観測データ」「天気予報データ」の3つに分類されます。

### 3.1. ダム運用データ（Dam Data）

ダムの現在の状況を表す基本的な実況値です。

*   **StorageLevel (貯水位)**: 現在の貯水位 (m)
*   **Inflow (流入量)**: 現在の流入量 (m³/s)
*   **Outflow (放流量)**: 現在の放流量 (m³/s)

**【取得方法】**
*   **学習時**: 国土交通省「水文水質データベース」等から手動ダウンロードした過去データCSV（例: `2014_2024_day_storage_inflow_discharge.csv`）を使用します。
*   **推論時 (リアルタイム)**: 国土交通省「川の防災情報」の内部JSON API（`kawabou` API）へNode.jsから定期ポーリングして取得した実況値（直近10分〜1時間の値）を使用します。API取得に失敗した場合は、フォールバック（スクレイピングまたはモックデータ）を使用します。

### 3.2. 気象観測データ（Meteorological Data）

ダム流域付近の実況気象データおよび直近の履歴データです。

*   **AvgTemp**: 当日の平均気温 (℃)
*   **Precipitation**: 当日の降水量 (mm)
*   **SnowDepth**: 本日の最深積雪 (cm)
*   **Snowfall**: 本日の降雪量 (cm)
*   **Precip_7d_sum**: 直近7日間の降水量合計 (mm)
*   **Precip_30d_sum**: 直近30日間の降水量合計 (mm)
*   **Temp_7d_avg**: 直近7日間の平均気温 (℃)
*   **SnowDepth_30d_avg**: 直近30日間の平均最深積雪 (cm)
*   **Snowfall_7d_sum**: 直近7日間の降雪量合計 (cm)
*   **Month**: 現在の月（1〜12）。季節性や運用ルール（利水期・洪水期など）をモデルに学習させるための特徴量です。

**【取得方法】**
*   **学習時**: 気象庁の「過去の気象データ検索」からダウンロードした日別値CSV（降水量、気温、最深積雪、降雪量など）を結合し、ローリング計算（`rolling(window=N)`）によって過去N日間ベースの特徴量を生成しています`eda_*.py`。
*   **推論時 (リアルタイム)**: Node.jsの専用スクレイパー群（`*WeatherScraper.js`）が、気象庁の過去データ検索ページ（例: `daily_a1.php` または `daily_h1.php`）を`cheerio`で直接スクレイピングします。現在および1ヶ月前のページから日別データを抽出し、直近1/7/30日間の集計値を動的に計算してモデルに渡します。データのキャッシュ（標準6時間）を行い、気象庁サーバへの負荷を抑えています。

### 3.3. 天気予報データ（Forecast Data）

未来の水位予測に必要な、向こう1週間の気象予報データです。予測精度を左右する重要なインプットとなります。

*   **Forecast_Precip_7d_sum**: 向こう7日間の予想降水量合計（推論時・学習時）
*   **Forecast_Temp_7d_avg**: 向こう7日間の予想平均気温（推論時・学習時）

**【取得方法】**
*   **学習時**: 将来の正解データ（未来の観測値）をシフト処理（例：`df['Precipitation'].shift(-7).rolling(window=7).sum()`）することで、"完璧な天気予報"が存在したと仮定した擬似的な予報特徴量として作成し、学習に使用しています。
*   **推論時 (リアルタイム)**:
    1.  **優先 (OpenWeatherMap API)**: `OpenWeatherMapService.js` を介して One Call API 3.0 をコールし、対象ダムの座標 (Lat/Lon) をベースにした高精度な8日間予報データから予想降水量と予想平均気温を算出します。
    2.  **フォールバック (気象庁予報)**: OWM APIキーが未設定、またはAPIコールに失敗した場合、気象庁のJSON API（`https://www.jma.go.jp/bosai/forecast/data/forecast/{code}.json`）から県別の週間天気予報を取得します。降水確率と季節に応じた降水係数を掛け合わせた疑似降水量（例：降水確率50% × 夏場係数50mm = 25mm）や、最高・最低気温の中間値を算出して代替しています。

---

## 4. 学習プロセスと予測プロセスのアプローチ

1.  **特徴量エンジニアリング (EDAスクリプト)**
    `scripts/eda_*.py` を実行し、ダムの過去運用データCSVとアメダス過去データCSVを日次（Date）でマージします。直近の累積降水量などの派生特徴量を計算し、各期間後のターゲット値（例：`StorageLevel.shift(-N)`）を生成した学習用データセットを作成します。

2.  **モデル訓練 (Trainスクリプト)**
    `scripts/train_*.py` を実行します。作成されたデータセットを学習用と検証用に分割（例：2020年以前と以降）し、RandomForestRegressorを用いて「7日後」「28日後」「60日後」「90日後」の4つのそれぞれのモデル（[.pkl](file:///c:/Users/moika/.gemini/antigravity/playground/app_kassui/models/isawa_rf_7d.pkl)）を学習・生成して `models/` ディレクトリに保存します。

3.  **リアルタイム推論 (Node.js + Predictスクリプト)**
    ユーザーからダッシュボードへのリクエスト発生時に [server/services/DataAggregator.js](file:///c:/Users/moika/.gemini/antigravity/playground/app_kassui/server/services/DataAggregator.js) が起ち上がります。
    - 直近の各種APIやHTMLスクレイピングから特徴量を収集・集計
    - JSONオブジェクトに構築し、`child_process`として `scripts/predict_*.py` を実行
    - `predict_*.py` は保存されたモデル（[.pkl](file:///c:/Users/moika/.gemini/antigravity/playground/app_kassui/models/isawa_rf_7d.pkl)）をロードして推論を行い、結果の貯水位（Mean, Std, Min, Max）と、その予測における各特徴量の寄与度（Feature Impact）を計算してJSONでNode.jsへ返却します。
    - 最終的にフロントエンドで渇水レベル（正常、注意、警戒、危険）が判定されUIに描画されます。

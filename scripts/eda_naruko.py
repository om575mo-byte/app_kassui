import pandas as pd
import numpy as np
import os
import matplotlib.pyplot as plt

# 日本語フォントの設定（Windows等）
plt.rcParams['font.family'] = 'Meiryo'

def load_dam_data(filepath):
    """鳴子ダムのデータを読み込む (先頭の不要な行をスキップ)"""
    try:
        df = pd.read_csv(filepath, encoding='shift_jis', skiprows=1)
        df['年月日'] = pd.to_datetime(df['年月日'])
        df.set_index('年月日', inplace=True)
        # カラム名を統一・英語化して扱いやすく
        df.rename(columns={'貯水位（m）': 'StorageLevel', '流入量（m3/S）': 'Inflow', '放流量（m3/S）': 'Outflow'}, inplace=True)
        # 数値型に変換（エラーはNaNにする）
        for col in ['StorageLevel', 'Inflow', 'Outflow']:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        print(f"Dam data loaded: {df.shape[0]} rows (from {df.index.min().date()} to {df.index.max().date()})")
        return df
    except Exception as e:
        print(f"Error loading dam data: {e}")
        return None

def load_weather_data(filepath, val_col_name):
    """気象庁からダウンロードした形式のデータを読み込む"""
    try:
        # 気象庁のデータは先頭にメタデータが複数行あり、実際のデータは6行目(index 5)から始まることが多い
        # 年月日, 値, 品質情報, 均質番号 という構成
        df = pd.read_csv(filepath, encoding='shift_jis', skiprows=5, header=None, usecols=[0, 1], names=['Date', val_col_name])
        df['Date'] = pd.to_datetime(df['Date'])
        df.set_index('Date', inplace=True)
        df[val_col_name] = pd.to_numeric(df[val_col_name], errors='coerce')
        print(f"Weather data ({val_col_name}) loaded: {df.shape[0]} rows (from {df.index.min().date()} to {df.index.max().date()})")
        return df
    except Exception as e:
        print(f"Error loading weather data {filepath}: {e}")
        return None

def main():
    base_dir = os.path.join(os.path.dirname(__file__), '../dum_data')
    
    # 1. データ読み込み
    dam_file = os.path.join(base_dir, '10200421500000_naruko/1993_2023_day_storage_inflow_discharge (2).csv')
    precip_file = os.path.join(base_dir, 'kawatabi/kousui.csv')
    temp_file = os.path.join(base_dir, 'kawatabi/kion_heikinn.csv')
    snow_depth_file = os.path.join(base_dir, 'kawatabi/kousetu.csv')       # 最深積雪(cm) - ストック量
    snowfall_file = os.path.join(base_dir, 'kawatabi/kouseturyou.csv')     # 日降雪量合計(cm) - フロー量
    
    df_dam = load_dam_data(dam_file)
    df_precip = load_weather_data(precip_file, 'Precipitation')
    df_temp = load_weather_data(temp_file, 'AvgTemp')
    df_snow_depth = load_weather_data(snow_depth_file, 'SnowDepth')        # 旧: Snowfall → 正: SnowDepth
    df_snowfall = load_weather_data(snowfall_file, 'Snowfall')             # 新規追加: 日降雪量
    
    if df_dam is None:
        return
        
    # 2. データの結合 (Inner Joinで期間が被っているところだけ抽出)
    dfs = [df_dam]
    for df in [df_precip, df_temp, df_snow_depth, df_snowfall]:
        if df is not None:
            dfs.append(df)
            
    # 全てまとめる
    merged_df = pd.concat(dfs, axis=1, join='inner')
    print(f"\nMerged data: {merged_df.shape[0]} rows (from {merged_df.index.min().date()} to {merged_df.index.max().date()})")
    print(merged_df.head())
    print("\nMissing values:\n", merged_df.isnull().sum())
    
    # 欠損値の基本的な補間 (線形)
    merged_df.interpolate(method='linear', inplace=True)
    
    # 3. 特徴量の作成
    merged_df['Precip_7d_sum'] = merged_df['Precipitation'].rolling(window=7).sum()
    merged_df['Precip_30d_sum'] = merged_df['Precipitation'].rolling(window=30).sum()
    merged_df['Temp_7d_avg'] = merged_df['AvgTemp'].rolling(window=7).mean()
    merged_df['SnowDepth_30d_avg'] = merged_df['SnowDepth'].rolling(window=30).mean()   # 旧: Snowfall_30d_sum → 正: 30日平均積雪深
    merged_df['Snowfall_7d_sum'] = merged_df['Snowfall'].rolling(window=7).sum()         # 新規追加: 7日間降雪量合計
    merged_df['Month'] = merged_df.index.month                                           # 新規追加: 季節性・運用ルールの学習用
    
    # 提案1の実証用：未来7日間の予報データ（実際は未来の実績値を使用）
    # rolling(window=7).sum() は "今日を含む過去7日" なので、
    # .shift(-7) することで "明日からの未来7日分" を今日の特徴量として扱う
    merged_df['Forecast_Precip_7d_sum'] = merged_df['Precipitation'].shift(-7).rolling(window=7).sum()
    merged_df['Forecast_Temp_7d_avg'] = merged_df['AvgTemp'].shift(-7).rolling(window=7).mean()
    
    # ========================================
    # 1ヶ月予報シミュレーション（三分位点ベース）
    # ========================================
    # 向こう30日間の実績値を計算
    merged_df['_future_precip_30d'] = merged_df['Precipitation'].shift(-30).rolling(window=30).sum()
    merged_df['_future_temp_30d'] = merged_df['AvgTemp'].shift(-30).rolling(window=30).mean()
    
    # 月ごとの三分位点を計算（過去データ全体から）
    precip_terciles = merged_df.groupby(merged_df.index.month)['_future_precip_30d'].quantile([0.333, 0.667]).unstack()
    temp_terciles = merged_df.groupby(merged_df.index.month)['_future_temp_30d'].quantile([0.333, 0.667]).unstack()
    
    print("\n--- 30日降水量の月別三分位点 ---")
    print(precip_terciles)
    print("\n--- 30日平均気温の月別三分位点 ---")
    print(temp_terciles)
    
    np.random.seed(42)
    
    def simulate_forecast_prob(actual_value, q33, q67):
        """実績値の階級に応じてシミュレーション確率を生成（ノイズ付き）"""
        if pd.isna(actual_value) or pd.isna(q33) or pd.isna(q67):
            return 33, 34, 33  # フォールバック：等確率
        
        if actual_value <= q33:
            # 「少ない/低い」階級 → below の確率が高い
            base = [60, 25, 15]
        elif actual_value <= q67:
            # 「平年並」階級 → normal の確率が高い
            base = [20, 50, 30]
        else:
            # 「多い/高い」階級 → above の確率が高い
            base = [15, 25, 60]
        
        # ±10のノイズを加え、合計100に正規化
        noise = np.random.randint(-10, 11, size=3)
        probs = np.array(base) + noise
        probs = np.clip(probs, 5, 90)  # 極端な値を回避
        probs = (probs / probs.sum() * 100).astype(int)
        # 丸め誤差の調整（合計を100にする）
        probs[1] += 100 - probs.sum()
        return probs[0], probs[1], probs[2]
    
    # 各日に対してシミュレーション確率を割り当て
    forecast_cols = {
        'Forecast_1M_Precip_Below': [], 'Forecast_1M_Precip_Normal': [], 'Forecast_1M_Precip_Above': [],
        'Forecast_1M_Temp_Below': [], 'Forecast_1M_Temp_Normal': [], 'Forecast_1M_Temp_Above': [],
    }
    
    for idx in merged_df.index:
        m = idx.month
        # 降水量
        pq33 = precip_terciles.loc[m, 0.333] if m in precip_terciles.index else None
        pq67 = precip_terciles.loc[m, 0.667] if m in precip_terciles.index else None
        pb, pn, pa = simulate_forecast_prob(merged_df.loc[idx, '_future_precip_30d'], pq33, pq67)
        forecast_cols['Forecast_1M_Precip_Below'].append(pb)
        forecast_cols['Forecast_1M_Precip_Normal'].append(pn)
        forecast_cols['Forecast_1M_Precip_Above'].append(pa)
        
        # 気温
        tq33 = temp_terciles.loc[m, 0.333] if m in temp_terciles.index else None
        tq67 = temp_terciles.loc[m, 0.667] if m in temp_terciles.index else None
        tb, tn, ta = simulate_forecast_prob(merged_df.loc[idx, '_future_temp_30d'], tq33, tq67)
        forecast_cols['Forecast_1M_Temp_Below'].append(tb)
        forecast_cols['Forecast_1M_Temp_Normal'].append(tn)
        forecast_cols['Forecast_1M_Temp_Above'].append(ta)
    
    for col, vals in forecast_cols.items():
        merged_df[col] = vals
    
    # 作業用列を削除
    merged_df.drop(columns=['_future_precip_30d', '_future_temp_30d'], inplace=True)
    
    print(f"\n--- 1ヶ月予報シミュレーション確率のサンプル ---")
    print(merged_df[['Forecast_1M_Precip_Below', 'Forecast_1M_Precip_Normal', 'Forecast_1M_Precip_Above',
                      'Forecast_1M_Temp_Below', 'Forecast_1M_Temp_Normal', 'Forecast_1M_Temp_Above']].head(10))
    
    # NaNを落とす
    merged_df.dropna(inplace=True)
    
    # 4. 相関分析
    print("\n--- Correlation with StorageLevel (貯水位) ---")
    correlations = merged_df.corr()['StorageLevel'].sort_values(ascending=False)
    print(correlations)
    
    # 5. 基本的なプロットの保存
    output_dir = os.path.join(os.path.dirname(__file__), '../docs/analysis_results')
    os.makedirs(output_dir, exist_ok=True)
    
    plt.figure(figsize=(15, 12))
    
    # 2018年〜2020年の3年間をズームしてプロット
    zoom_df = merged_df['2018':'2020']
    
    ax1 = plt.subplot(4, 1, 1)
    ax1.plot(zoom_df.index, zoom_df['StorageLevel'], color='blue', label='Storage Level (m)')
    ax1.set_title("Naruko Dam Storage Level (2018-2020)")
    ax1.legend()
    ax1.grid(True)
    
    ax2 = plt.subplot(4, 1, 2)
    ax2.bar(zoom_df.index, zoom_df['Precipitation'], color='cyan', label='Daily Precipitation (mm)')
    ax2.plot(zoom_df.index, zoom_df['Precip_30d_sum'] / 10, color='darkblue', label='30-day Precip Sum / 10', linestyle='--')
    ax2.set_title("Precipitation at Kawatabi")
    ax2.legend()
    ax2.grid(True)
    
    ax3 = plt.subplot(4, 1, 3)
    ax3.plot(zoom_df.index, zoom_df['AvgTemp'], color='red', label='Average Temp (C)')
    ax3.set_title("Temperature at Kawatabi")
    ax3.legend()
    ax3.grid(True)
    
    ax4 = plt.subplot(4, 1, 4)
    ax4.fill_between(zoom_df.index, zoom_df['SnowDepth'], color='lightblue', alpha=0.7, label='Snow Depth (cm)')
    ax4.bar(zoom_df.index, zoom_df['Snowfall'], color='gray', alpha=0.5, label='Daily Snowfall (cm)')
    ax4.set_title("Snow Depth & Snowfall at Kawatabi")
    ax4.legend()
    ax4.grid(True)
    
    plt.tight_layout()
    plot_path = os.path.join(output_dir, 'eda_timeseries_2018_2020.png')
    plt.savefig(plot_path)
    print(f"\nPlot saved to {plot_path}")
    
    # データをCSVとして保存しておく（後で使えるように）
    csv_path = os.path.join(output_dir, 'merged_naruko_dataset.csv')
    merged_df.to_csv(csv_path)
    print(f"Merged dataset saved to {csv_path}")

if __name__ == "__main__":
    main()

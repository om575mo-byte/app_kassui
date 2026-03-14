import pandas as pd
import numpy as np
import os
import matplotlib.pyplot as plt

# 日本語フォントの設定（Windows等）
plt.rcParams['font.family'] = 'Meiryo'

def load_dam_data(filepath):
    try:
        df = pd.read_csv(filepath, encoding='shift_jis', skiprows=1)
        df['年月日'] = pd.to_datetime(df['年月日'])
        df.set_index('年月日', inplace=True)
        df.rename(columns={'貯水位(m)': 'StorageLevel', '流入量(m3/S)': 'Inflow', '放流量(m3/S)': 'Outflow'}, inplace=True)
        # 鳴子ダムとヘッダー仕様が少し違う可能性があるため、フォールバックも用意
        if 'StorageLevel' not in df.columns:
             # 例：貯水位（m）など全角括弧の場合
             df.rename(columns={'貯水位（m）': 'StorageLevel', '流入量（m3/S）': 'Inflow', '放流量（m3/S）': 'Outflow'}, inplace=True)
             
        for col in ['StorageLevel', 'Inflow', 'Outflow']:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        print(f"Dam data loaded: {df.shape[0]} rows (from {df.index.min().date()} to {df.index.max().date()})")
        return df
    except Exception as e:
        print(f"Error loading dam data: {e}")
        return None

def load_weather_data(filepath, val_col_name):
    """気象庁からダウンロードした形式のデータを読み込む。複数局の平均を取るため、系列にプレフィックス等はつけない"""
    try:
        # 気象庁のデータは先頭にメタデータが複数行あり、実際のデータは6行目(index 5)から始まることが多い
        df = pd.read_csv(filepath, encoding='shift_jis', skiprows=5, header=None, usecols=[0, 1], names=['Date', val_col_name])
        df['Date'] = pd.to_datetime(df['Date'])
        df.set_index('Date', inplace=True)
        df[val_col_name] = pd.to_numeric(df[val_col_name], errors='coerce')
        return df
    except Exception as e:
        print(f"Error loading weather data {filepath}: {e}")
        return None

def get_average_weather(dir1, dir2, filename, col_name):
    """2つの観測所の同じ気象データを読み込み、平均を計算する"""
    df1 = load_weather_data(os.path.join(dir1, filename), col_name)
    df2 = load_weather_data(os.path.join(dir2, filename), col_name)
    
    if df1 is None and df2 is None:
        return None
    if df1 is None: return df2
    if df2 is None: return df1
    
    # 結合して平均
    merged = pd.concat([df1.rename(columns={col_name: 'v1'}), df2.rename(columns={col_name: 'v2'})], axis=1)
    merged[col_name] = merged[['v1', 'v2']].mean(axis=1) # どちらかがNaNでも、もう一方で計算される
    return merged[[col_name]]

def main():
    base_dir = os.path.join(os.path.dirname(__file__), '../dum_data')
    
    # 1. データ読み込み
    dam_file = os.path.join(base_dir, '10210321500000_isawa/2014_2024_day_storage_inflow_discharge.csv')
    
    kitakami_dir = os.path.join(base_dir, 'kitakami')
    yuda_dir = os.path.join(base_dir, 'yuda')
    
    # 気象庁CSVのファイル名とカラム名のマッピング
    # data (8).csv: 降水量(mm)
    # data (9).csv: 平均気温(℃)
    # data (6).csv: 最深積雪(cm)
    # data (7).csv: 降雪量(cm)
    df_dam = load_dam_data(dam_file)
    df_precip = get_average_weather(kitakami_dir, yuda_dir, 'data (8).csv', 'Precipitation')
    df_temp = get_average_weather(kitakami_dir, yuda_dir, 'data (9).csv', 'AvgTemp')
    df_snow_depth = get_average_weather(kitakami_dir, yuda_dir, 'data (6).csv', 'SnowDepth')
    df_snowfall = get_average_weather(kitakami_dir, yuda_dir, 'data (7).csv', 'Snowfall')
    
    if df_dam is None:
        return
        
    # 2. データの結合 (Inner Joinで期間が被っているところだけ抽出)
    dfs = [df_dam]
    for df in [df_precip, df_temp, df_snow_depth, df_snowfall]:
        if df is not None:
            dfs.append(df)
            
    # 全てまとめる
    merged_df = pd.concat(dfs, axis=1, join='inner')
    print(f"\\nMerged data: {merged_df.shape[0]} rows (from {merged_df.index.min().date()} to {merged_df.index.max().date()})")
    print(merged_df.head())
    print("\\nMissing values:\\n", merged_df.isnull().sum())
    
    # 欠損値の基本的な補間 (線形)
    merged_df.interpolate(method='linear', inplace=True)
    
    # 3. 特徴量の作成
    merged_df['Precip_7d_sum'] = merged_df['Precipitation'].rolling(window=7).sum()
    merged_df['Precip_30d_sum'] = merged_df['Precipitation'].rolling(window=30).sum()
    merged_df['Temp_7d_avg'] = merged_df['AvgTemp'].rolling(window=7).mean()
    merged_df['SnowDepth_30d_avg'] = merged_df['SnowDepth'].rolling(window=30).mean()
    merged_df['Snowfall_7d_sum'] = merged_df['Snowfall'].rolling(window=7).sum()
    merged_df['Month'] = merged_df.index.month
    
    # 検証用の未来特徴量
    merged_df['Forecast_Precip_7d_sum'] = merged_df['Precipitation'].shift(-7).rolling(window=7).sum()
    merged_df['Forecast_Temp_7d_avg'] = merged_df['AvgTemp'].shift(-7).rolling(window=7).mean()
    
    # NaNを落とす
    merged_df.dropna(inplace=True)
    
    # 4. 相関分析
    print("\\n--- Correlation with StorageLevel (貯水位) ---")
    correlations = merged_df.corr()['StorageLevel'].sort_values(ascending=False)
    print(correlations)
    
    # 5. プロット保存
    output_dir = os.path.join(os.path.dirname(__file__), '../docs/analysis_results')
    os.makedirs(output_dir, exist_ok=True)
    
    plt.figure(figsize=(15, 12))
    
    # 2020年〜2022年の3年間をズームしてプロット
    zoom_df = merged_df['2020':'2022']
    
    ax1 = plt.subplot(4, 1, 1)
    ax1.plot(zoom_df.index, zoom_df['StorageLevel'], color='blue', label='Storage Level (m)')
    ax1.set_title("Isawa Dam Storage Level (2020-2022)")
    ax1.legend()
    ax1.grid(True)
    
    ax2 = plt.subplot(4, 1, 2)
    ax2.bar(zoom_df.index, zoom_df['Precipitation'], color='cyan', label='Daily Precipitation (mm)')
    ax2.plot(zoom_df.index, zoom_df['Precip_30d_sum'] / 10, color='darkblue', label='30-day Precip Sum / 10', linestyle='--')
    ax2.set_title("Average Precipitation (Kitakami & Yuda)")
    ax2.legend()
    ax2.grid(True)
    
    ax3 = plt.subplot(4, 1, 3)
    ax3.plot(zoom_df.index, zoom_df['AvgTemp'], color='red', label='Average Temp (C)')
    ax3.set_title("Average Temperature (Kitakami & Yuda)")
    ax3.legend()
    ax3.grid(True)
    
    ax4 = plt.subplot(4, 1, 4)
    ax4.fill_between(zoom_df.index, zoom_df['SnowDepth'], color='lightblue', alpha=0.7, label='Snow Depth (cm)')
    ax4.bar(zoom_df.index, zoom_df['Snowfall'], color='gray', alpha=0.5, label='Daily Snowfall (cm)')
    ax4.set_title("Average Snow Depth & Snowfall (Kitakami & Yuda)")
    ax4.legend()
    ax4.grid(True)
    
    plt.tight_layout()
    plot_path = os.path.join(output_dir, 'eda_isawa_timeseries_2020_2022.png')
    plt.savefig(plot_path)
    print(f"\\nPlot saved to {plot_path}")
    
    # データをCSVとして保存
    csv_path = os.path.join(output_dir, 'merged_isawa_dataset.csv')
    merged_df.to_csv(csv_path)
    print(f"Merged dataset saved to {csv_path}")
    
if __name__ == "__main__":
    main()

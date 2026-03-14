"""
釜房ダム AI予測用 データ前処理・特徴量エンジニアリング

仙台・新川の2つの気象観測所からデータを読み込み、
それぞれでデータセットを生成して精度比較の基盤を作る。
"""

import pandas as pd
import numpy as np
import os
import matplotlib.pyplot as plt

plt.rcParams['font.family'] = 'Meiryo'

def load_dam_data(filepath):
    """釜房ダムのデータを読み込む"""
    try:
        df = pd.read_csv(filepath, encoding='shift_jis', skiprows=1)
        df['年月日'] = pd.to_datetime(df['年月日'])
        df.set_index('年月日', inplace=True)
        df.rename(columns={
            '貯水位（m）': 'StorageLevel',
            '流入量（m3/S）': 'Inflow',
            '放流量（m3/S）': 'Outflow'
        }, inplace=True)
        for col in ['StorageLevel', 'Inflow', 'Outflow']:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        print(f"Dam data loaded: {df.shape[0]} rows ({df.index.min().date()} to {df.index.max().date()})")
        return df
    except Exception as e:
        print(f"Error loading dam data: {e}")
        return None

def load_weather_csv(filepath, val_col_name):
    """気象庁CSVを読み込む（先頭5行スキップ、1列目=日付, 2列目=値）"""
    try:
        df = pd.read_csv(filepath, encoding='shift_jis', skiprows=5, header=None,
                         usecols=[0, 1], names=['Date', val_col_name])
        df['Date'] = pd.to_datetime(df['Date'])
        df.set_index('Date', inplace=True)
        df[val_col_name] = pd.to_numeric(df[val_col_name], errors='coerce')
        print(f"  {val_col_name}: {df.shape[0]} rows ({df.index.min().date()} ~ {df.index.max().date()})")
        return df
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return None

def load_station_data(base_dir, station_name, file_map):
    """
    1つの観測所の全CSVを読み込んで結合する
    file_map: { 'Precipitation': 'data (2).csv', 'AvgTemp': 'data (3).csv', ... }
    """
    print(f"\n=== {station_name} 観測所データ読み込み ===")
    station_dir = os.path.join(base_dir, station_name)
    dfs = []
    for col_name, filename in file_map.items():
        filepath = os.path.join(station_dir, filename)
        df = load_weather_csv(filepath, col_name)
        if df is not None:
            dfs.append(df)
    if not dfs:
        return None
    merged = pd.concat(dfs, axis=1, join='inner')
    print(f"  統合: {merged.shape[0]} rows, {merged.shape[1]} cols")
    return merged

def create_features(merged_df):
    """特徴量を生成する（鳴子と同じスキーマ）"""
    merged_df['Precip_7d_sum'] = merged_df['Precipitation'].rolling(window=7).sum()
    merged_df['Precip_30d_sum'] = merged_df['Precipitation'].rolling(window=30).sum()
    merged_df['Temp_7d_avg'] = merged_df['AvgTemp'].rolling(window=7).mean()
    merged_df['SnowDepth_30d_avg'] = merged_df['SnowDepth'].rolling(window=30).mean()
    merged_df['Snowfall_7d_sum'] = merged_df['Snowfall'].rolling(window=7).sum()
    merged_df['Month'] = merged_df.index.month

    # 未来7日間の予報データ（学習時は実績値を代用）
    merged_df['Forecast_Precip_7d_sum'] = merged_df['Precipitation'].shift(-7).rolling(window=7).sum()
    merged_df['Forecast_Temp_7d_avg'] = merged_df['AvgTemp'].shift(-7).rolling(window=7).mean()

    merged_df.dropna(inplace=True)
    return merged_df

def main():
    base_dir = os.path.join(os.path.dirname(__file__), '../dum_data')
    output_dir = os.path.join(os.path.dirname(__file__), '../docs/analysis_results')
    os.makedirs(output_dir, exist_ok=True)

    # ========== 1. ダムデータ読み込み ==========
    dam_file = os.path.join(base_dir, '10200432400000_kamahusa/1993_2023_day_storage_inflow_discharge (3).csv')
    df_dam = load_dam_data(dam_file)
    if df_dam is None:
        return

    # ========== 2. 気象データ読み込み（2観測所） ==========
    # 仙台: data.csv=積雪深, data(1)=降雪量, data(2)=降水量, data(3)=平均気温, data(4)=最高気温, data(5)=最低気温
    sendai_map = {
        'SnowDepth': 'data.csv',
        'Snowfall': 'data (1).csv',
        'Precipitation': 'data (2).csv',
        'AvgTemp': 'data (3).csv',
    }
    # 新川: data.csv=積雪深, kouseturyou=降雪量, data(1)=降水量, data(2)=平均気温, data(3)=最高気温, data(4)=最低気温
    nikkawa_map = {
        'SnowDepth': 'data.csv',
        'Snowfall': 'kouseturyou.csv',
        'Precipitation': 'data (1).csv',
        'AvgTemp': 'data (2).csv',
    }

    df_sendai = load_station_data(base_dir, 'sendai', sendai_map)
    df_nikkawa = load_station_data(base_dir, 'nikkawa', nikkawa_map)

    # ========== 3. 各観測所でデータセットを生成 ==========
    results = {}
    for station_name, df_weather in [('sendai', df_sendai), ('nikkawa', df_nikkawa)]:
        if df_weather is None:
            print(f"\n⚠ {station_name} のデータが不足 → スキップ")
            continue

        print(f"\n=== {station_name} 版データセット構築 ===")
        merged = pd.concat([df_dam, df_weather], axis=1, join='inner')
        print(f"  マージ後: {merged.shape[0]} rows ({merged.index.min().date()} ~ {merged.index.max().date()})")
        print(f"  欠損値:\n{merged.isnull().sum()}")

        # 欠損値の補間
        merged.interpolate(method='linear', inplace=True)

        # 特徴量生成
        merged = create_features(merged)

        # 相関分析
        print(f"\n--- {station_name}: StorageLevel との相関 ---")
        corr = merged.corr()['StorageLevel'].sort_values(ascending=False)
        print(corr)

        # CSV保存
        csv_path = os.path.join(output_dir, f'merged_kamafusa_{station_name}.csv')
        merged.to_csv(csv_path)
        print(f"[OK] {csv_path} に保存")

        results[station_name] = merged

    # ========== 4. 比較サマリー ==========
    if len(results) == 2:
        print("\n" + "=" * 60)
        print("=== 観測所データ比較サマリー ===")
        print("=" * 60)
        for name, df in results.items():
            print(f"\n【{name}】")
            print(f"  行数: {df.shape[0]}")
            print(f"  期間: {df.index.min().date()} ~ {df.index.max().date()}")
            print(f"  降水量平均: {df['Precipitation'].mean():.2f} mm/day")
            print(f"  気温平均: {df['AvgTemp'].mean():.1f} ℃")
            print(f"  最大積雪深平均: {df['SnowDepth'].mean():.1f} cm")
            print(f"  降雪量平均: {df['Snowfall'].mean():.1f} cm/day")

if __name__ == "__main__":
    main()

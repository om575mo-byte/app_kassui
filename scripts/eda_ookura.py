"""
大倉ダム AI予測モデル用 EDA・特徴量生成スクリプト
- ダムデータ: 1993/1/1 - 2023/12/31 (dum_data/20200410000000_ookura)
- 日次気象データ: 2000/1/1 - 2025/12/31 (dum_data/nikkawa)
    - 新川(nikkawa) のみを使用
- 処理内容:
    - データの結合
    - 積雪深(SnowDepth)の欠損値補間 (直近値埋め または 季節0埋め 等)
    - 特徴量(移動平均・累積など)の生成
    - 予測ターゲット(Storage_X_ahead)へのシフト作成用ベースデータの出力
"""

import pandas as pd
import numpy as np
import os

base_dir = os.path.dirname(__file__)

def load_dam_data():
    csv_path = os.path.join(base_dir, '../dum_data/20200410000000_ookura/1993_2023_day_storage_inflow_discharge.csv')
    try:
        df = pd.read_csv(csv_path, encoding='cp932', skiprows=2)
    except Exception as e:
        print(f"Error reading dam CSV (trying utf-8): {e}")
        df = pd.read_csv(csv_path, encoding='utf-8', skiprows=2)
    
    df.columns = ['Date', 'StorageLevel', 'Inflow', 'Outflow']
    df['Date'] = pd.to_datetime(df['Date'])
    df.set_index('Date', inplace=True)
    
    # 型変換・異常値処理
    for col in ['StorageLevel', 'Inflow', 'Outflow']:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # 欠損日を補間
    df = df.resample('D').asfreq()
    df.interpolate(method='linear', inplace=True)
    return df

def load_weather_csv(folder, filename, col_name):
    path = os.path.join(base_dir, f'../dum_data/{folder}/{filename}')
    df = pd.read_csv(path, encoding='shift_jis', skiprows=5)
    
    # 日付(1列目)と値(2列目)だけ抽出
    df = df.iloc[:, [0, 1]]
    df.columns = ['Date', col_name]
    
    # 品質情報などの記号を除去
    df[col_name] = df[col_name].astype(str).str.replace(r'[)\]×]', '', regex=True)
    df[col_name] = pd.to_numeric(df[col_name], errors='coerce')
    
    # / を含む日付文字列に対応 (YYYY/M/D)
    df['Date'] = pd.to_datetime(df['Date'].astype(str).str.split().str[0])
    df.set_index('Date', inplace=True)
    return df

def load_nikkawa_data():
    folder = 'nikkawa'
    df_snow_depth = load_weather_csv(folder, 'data.csv', 'SnowDepth')
    df_snowfall   = load_weather_csv(folder, 'kouseturyou.csv', 'Snowfall')
    df_precip     = load_weather_csv(folder, 'data (1).csv', 'Precipitation')
    df_temp_avg   = load_weather_csv(folder, 'data (2).csv', 'AvgTemp')
    
    # 結合
    df_weather = df_snow_depth.join([df_snowfall, df_precip, df_temp_avg], how='outer')
    
    # 積雪深(SnowDepth)の欠損値処理
    # 欠損は主に夏場と仮定し、0で埋める
    df_weather['SnowDepth'].fillna(0, inplace=True)
    df_weather['Snowfall'].fillna(0, inplace=True)
    df_weather['Precipitation'].fillna(0, inplace=True)
    
    # 気温の短い欠損は線形補間
    df_weather['AvgTemp'].interpolate(method='linear', inplace=True)
    
    return df_weather

def create_features(df):
    """特徴量エンジニアリング"""
    # 月 (季節性)
    df['Month'] = df.index.month
    
    # --- 過去実績特徴量 ---
    df['Precip_7d_sum'] = df['Precipitation'].rolling(window=7, min_periods=1).sum()
    df['Precip_30d_sum'] = df['Precipitation'].rolling(window=30, min_periods=1).sum()
    df['Temp_7d_avg'] = df['AvgTemp'].rolling(window=7, min_periods=1).mean()
    df['SnowDepth_30d_avg'] = df['SnowDepth'].rolling(window=30, min_periods=1).mean()
    df['Snowfall_7d_sum'] = df['Snowfall'].rolling(window=7, min_periods=1).sum()
    
    # --- 予報特徴量 (学習時は1〜7日先の「実績」を「正確な予報」と見なしてシフト) ---
    df['Forecast_Precip_7d_sum'] = df['Precipitation'].rolling(window=7).sum().shift(-7)
    df['Forecast_Temp_7d_avg'] = df['AvgTemp'].rolling(window=7).mean().shift(-7)
    
    return df

def main():
    print("Loading Ookura dam data...")
    df_dam = load_dam_data()
    print(f"Dam data shape: {df_dam.shape}, Range: {df_dam.index.min().date()} to {df_dam.index.max().date()}")
    
    print("Loading Nikkawa weather data...")
    df_weather = load_nikkawa_data()
    print(f"Weather data shape: {df_weather.shape}, Range: {df_weather.index.min().date()} to {df_weather.index.max().date()}")
    
    # 2000-01-01 以降 (気象データが揃っている期間) でマージ
    print("Merging data...")
    merged_df = df_dam.join(df_weather, how='inner')
    merged_df = merged_df[merged_df.index >= '2000-01-01']
    
    print("Creating features...")
    df_features = create_features(merged_df)
    
    # 欠損を含む行を削除（シフトでできた末尾7日分など）
    # Target生成前なので最低限のdropnaでOK
    df_clean = df_features.dropna()
    print(f"Final shape: {df_clean.shape}, Range: {df_clean.index.min().date()} to {df_clean.index.max().date()}")
    
    # CSV出力
    out_dir = os.path.join(base_dir, '../docs/analysis_results')
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, 'merged_ookura_dataset.csv')
    df_clean.to_csv(out_file)
    print(f"[OK] Saved to {out_file}")
    
    # 要約
    print("\n--- Summary ---")
    print(df_clean.describe()[['StorageLevel', 'SnowDepth', 'Precipitation']].round(2))

if __name__ == "__main__":
    main()

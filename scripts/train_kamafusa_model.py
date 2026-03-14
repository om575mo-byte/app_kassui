"""
釜房ダム AI予測モデルの学習スクリプト

仙台版・新川版の両方で Random Forest を学習し、精度を比較する。
精度が高い方のモデルを最終採用、もしくは両方のモデルを出力する。
"""

import pandas as pd
import numpy as np
import os
import pickle
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score

def train_model(df, target_col, features, save_path):
    """1つのターゲット（N日後水位）に対してRFを学習・評価"""
    temp_df = df[features + [target_col]].dropna()

    # 2021年以前を学習、2021年以降をテスト
    train_df = temp_df[temp_df.index < '2021-01-01']
    test_df = temp_df[temp_df.index >= '2021-01-01']

    X_train, y_train = train_df[features], train_df[target_col]
    X_test, y_test = test_df[features], test_df[target_col]

    rf = RandomForestRegressor(n_estimators=100, max_depth=15, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)

    test_preds = rf.predict(X_test)
    mae = mean_absolute_error(y_test, test_preds)
    r2 = r2_score(y_test, test_preds)

    # Feature Importance Top 5
    importances = pd.Series(rf.feature_importances_, index=features).sort_values(ascending=False)
    top5 = importances.head(5)

    # Save
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    with open(save_path, 'wb') as f:
        pickle.dump(rf, f)

    return mae, r2, top5, X_train.shape[0], X_test.shape[0]

def main():
    base_dir = os.path.dirname(__file__)
    features = [
        'StorageLevel', 'Inflow', 'Outflow', 'AvgTemp',
        'Precipitation', 'SnowDepth', 'Snowfall',
        'Precip_7d_sum', 'Precip_30d_sum', 'Temp_7d_avg',
        'SnowDepth_30d_avg', 'Snowfall_7d_sum', 'Month',
        'Forecast_Precip_7d_sum', 'Forecast_Temp_7d_avg'
    ]
    horizons = [
        ('7d', 7),
        ('28d', 28),
        ('60d', 60),
        ('90d', 90),
    ]
    stations = ['sendai', 'nikkawa']

    # ========== 各観測所でモデル学習 ==========
    all_results = {}
    for station in stations:
        data_path = os.path.join(base_dir, f'../docs/analysis_results/merged_kamafusa_{station}.csv')
        if not os.path.exists(data_path):
            print(f"[SKIP] {data_path} not found")
            continue

        df = pd.read_csv(data_path)
        df['Date'] = pd.to_datetime(df.iloc[:, 0])
        df.set_index('Date', inplace=True)

        # ターゲット変数の作成
        for label, shift in horizons:
            df[f'Storage_{label}_ahead'] = df['StorageLevel'].shift(-shift)

        print(f"\n{'='*60}")
        print(f"=== {station.upper()} ===")
        print(f"{'='*60}")

        station_results = {}
        models_dir = os.path.join(base_dir, f'../models')
        for label, shift in horizons:
            target = f'Storage_{label}_ahead'
            save_path = os.path.join(models_dir, f'kamafusa_{station}_rf_{label}.pkl')
            mae, r2, top5, n_train, n_test = train_model(df, target, features, save_path)
            station_results[label] = {'MAE': mae, 'R2': r2, 'top5': top5}
            print(f"  {label}: MAE={mae:.3f}m, R2={r2:.3f}  (train={n_train}, test={n_test})")

        all_results[station] = station_results

    # ========== 精度比較表 ==========
    if len(all_results) == 2:
        print(f"\n{'='*60}")
        print("=== ACCURACY COMPARISON: sendai vs nikkawa ===")
        print(f"{'='*60}")
        print(f"{'Horizon':<8} | {'Sendai MAE':>12} {'R2':>8} | {'Nikkawa MAE':>12} {'R2':>8} | Winner")
        print("-" * 75)
        best_station = {'sendai': 0, 'nikkawa': 0}
        for label, _ in horizons:
            s = all_results['sendai'][label]
            n = all_results['nikkawa'][label]
            winner = 'sendai' if s['MAE'] < n['MAE'] else 'nikkawa'
            best_station[winner] += 1
            print(f"  {label:<6} | {s['MAE']:>10.3f}m {s['R2']:>7.3f} | {n['MAE']:>10.3f}m {n['R2']:>7.3f} | {winner}")

        overall_winner = max(best_station, key=best_station.get)
        print(f"\n>>> Overall winner: {overall_winner.upper()} ({best_station[overall_winner]}/4 horizons)")

        # Feature importance for the winner's 7d model
        print(f"\n--- {overall_winner} 7d Feature Importance Top 5 ---")
        print(all_results[overall_winner]['7d']['top5'])

        # 勝者のモデルを最終モデルとしてコピー
        print(f"\n=== Final models: {overall_winner} ===")
        for label, _ in horizons:
            src = os.path.join(base_dir, f'../models/kamafusa_{overall_winner}_rf_{label}.pkl')
            dst = os.path.join(base_dir, f'../models/kamafusa_rf_{label}.pkl')
            if os.path.exists(src):
                import shutil
                shutil.copy2(src, dst)
                print(f"  {src} -> {dst}")

if __name__ == "__main__":
    main()

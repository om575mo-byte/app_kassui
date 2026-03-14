"""
大倉ダム AI予測モデルの学習スクリプト
新川の気象データを使用した merged_ookura_dataset.csv で学習・評価を行う。
"""

import pandas as pd
import numpy as np
import os
import pickle
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score

def train_model(df, target_col, features, save_path):
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

    importances = pd.Series(rf.feature_importances_, index=features).sort_values(ascending=False)
    top5 = importances.head(5)

    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    with open(save_path, 'wb') as f:
        pickle.dump(rf, f)

    return mae, r2, top5, X_train.shape[0], X_test.shape[0]

def main():
    base_dir = os.path.dirname(__file__)
    data_path = os.path.join(base_dir, '../docs/analysis_results/merged_ookura_dataset.csv')
    models_dir = os.path.join(base_dir, '../models')
    
    if not os.path.exists(data_path):
        print(f"Error: {data_path} not found.")
        return

    features = [
        'StorageLevel', 'Inflow', 'Outflow', 'AvgTemp',
        'Precipitation', 'SnowDepth', 'Snowfall',
        'Precip_7d_sum', 'Precip_30d_sum', 'Temp_7d_avg',
        'SnowDepth_30d_avg', 'Snowfall_7d_sum', 'Month',
        'Forecast_Precip_7d_sum', 'Forecast_Temp_7d_avg'
    ]
    horizons = [('7d', 7), ('28d', 28), ('60d', 60), ('90d', 90)]

    df = pd.read_csv(data_path)
    df['Date'] = pd.to_datetime(df.iloc[:, 0])
    df.set_index('Date', inplace=True)

    for label, shift in horizons:
        df[f'Storage_{label}_ahead'] = df['StorageLevel'].shift(-shift)

    print(f"\n{'='*60}")
    print(f"=== OOKURA DAM MODEL TRAINING (Nikkawa Weather) ===")
    print(f"{'='*60}")

    for label, shift in horizons:
        target = f'Storage_{label}_ahead'
        save_path = os.path.join(models_dir, f'ookura_rf_{label}.pkl')
        
        mae, r2, top5, n_train, n_test = train_model(df, target, features, save_path)
        
        print(f"\n[{label} Forecast]")
        print(f"  MAE: {mae:.3f}m, R2: {r2:.3f} (train={n_train}, test={n_test})")
        print(f"  Top Features: {', '.join(top5.index.tolist())}")

if __name__ == "__main__":
    main()

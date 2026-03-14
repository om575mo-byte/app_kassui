import pandas as pd
import numpy as np
import os
import pickle
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score

def train_model(df, target_col, features, save_path):
    print(f"\n--- Training mode for: {target_col} ---")
    
    # Drop rows with NaN for the target and features
    temp_df = df[features + [target_col]].dropna()
    print(f"Data points available: {temp_df.shape[0]}")
    
    # Split into train/validation (Use before 2021 as train, 2021-2023 as test)
    train_df = temp_df[temp_df.index < '2021-01-01']
    test_df = temp_df[temp_df.index >= '2021-01-01']
    
    X_train = train_df[features]
    y_train = train_df[target_col]
    X_test = test_df[features]
    y_test = test_df[target_col]
    
    print(f"Train size: {X_train.shape[0]}, Test size: {X_test.shape[0]}")
    
    # Train Random Forest
    # RandomForest is chosen because it easily provides variance (uncertainty) across its trees
    rf = RandomForestRegressor(n_estimators=100, max_depth=15, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)
    
    # Evaluation
    train_preds = rf.predict(X_train)
    test_preds = rf.predict(X_test)
    
    print(f"Train R2: {r2_score(y_train, train_preds):.3f}, MAE: {mean_absolute_error(y_train, train_preds):.3f} m")
    print(f"Test R2: {r2_score(y_test, test_preds):.3f}, MAE: {mean_absolute_error(y_test, test_preds):.3f} m")
    
    # Feature Importance
    importances = pd.Series(rf.feature_importances_, index=features).sort_values(ascending=False)
    print("Feature Importances:")
    print(importances.head())
    
    # Save Model
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    with open(save_path, 'wb') as f:
        pickle.dump(rf, f)
    print(f"Model saved to {save_path}")

def main():
    base_dir = os.path.dirname(__file__)
    data_path = os.path.join(base_dir, '../docs/analysis_results/merged_naruko_dataset.csv')
    
    if not os.path.exists(data_path):
        print("Dataset not found. Please run eda_naruko.py first.")
        return
        
    df = pd.read_csv(data_path)
    df['Date'] = pd.to_datetime(df.iloc[:, 0]) # The first column is the datetime index string from previous script
    df.set_index('Date', inplace=True)
    
    print("Dataset loaded successfully.")
    
    # Define Target Variables (Shift by -N for N days ahead)
    df['Storage_7d_ahead'] = df['StorageLevel'].shift(-7)
    df['Storage_28d_ahead'] = df['StorageLevel'].shift(-28)
    df['Storage_60d_ahead'] = df['StorageLevel'].shift(-60)
    df['Storage_90d_ahead'] = df['StorageLevel'].shift(-90)
    
    # Define Features
    # Use current storage, inflow, outflow, and the window features created in EDA
    features = [
        'StorageLevel', 
        'Inflow', 
        'Outflow', 
        'AvgTemp', 
        'Precipitation', 
        'SnowDepth',           # 最深積雪(cm) - 旧: Snowfall
        'Snowfall',            # 日降雪量合計(cm) - 新規追加
        'Precip_7d_sum', 
        'Precip_30d_sum', 
        'Temp_7d_avg', 
        'SnowDepth_30d_avg',   # 30日平均積雪深 - 旧: Snowfall_30d_sum
        'Snowfall_7d_sum',     # 7日間降雪量合計 - 新規追加
        'Month',               # 季節性・運用ルールの学習用
        'Forecast_Precip_7d_sum', # 【検証用】向こう7日間の予想雨量
        'Forecast_Temp_7d_avg',   # 【検証用】向こう7日間の予想平均気温
        'Forecast_1M_Precip_Below',  # 1ヶ月予報 降水量「少ない」確率
        'Forecast_1M_Precip_Normal', # 1ヶ月予報 降水量「平年並」確率
        'Forecast_1M_Precip_Above',  # 1ヶ月予報 降水量「多い」確率
        'Forecast_1M_Temp_Below',    # 1ヶ月予報 気温「低い」確率
        'Forecast_1M_Temp_Normal',   # 1ヶ月予報 気温「平年並」確率
        'Forecast_1M_Temp_Above',    # 1ヶ月予報 気温「高い」確率
    ]
    
    models_dir = os.path.join(base_dir, '../models')
    
    # Train 7-day ahead model
    train_model(
        df=df,
        target_col='Storage_7d_ahead',
        features=features,
        save_path=os.path.join(models_dir, 'naruko_rf_7d.pkl')
    )
    
    # Train 28-day ahead model
    train_model(
        df=df,
        target_col='Storage_28d_ahead',
        features=features,
        save_path=os.path.join(models_dir, 'naruko_rf_28d.pkl')
    )
    
    # Train 60-day ahead model
    train_model(
        df=df,
        target_col='Storage_60d_ahead',
        features=features,
        save_path=os.path.join(models_dir, 'naruko_rf_60d.pkl')
    )
    
    # Train 90-day ahead model
    train_model(
        df=df,
        target_col='Storage_90d_ahead',
        features=features,
        save_path=os.path.join(models_dir, 'naruko_rf_90d.pkl')
    )

if __name__ == "__main__":
    main()

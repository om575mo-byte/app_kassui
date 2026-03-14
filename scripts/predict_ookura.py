"""
大倉ダム AI渇水予測推論スクリプト
JSON形式で入力データを受け取り、新川気象モデルで学習したRFで7d/28d/60d/90dの予測とSHAP寄与度を返す。
"""

import sys
import json
import os
import pickle
import warnings
import pandas as pd
import numpy as np

# SHAPのインポート（エラー回避付き）
try:
    import shap
    SHAP_AVAILABLE = True
except Exception as e:
    SHAP_AVAILABLE = False
    SHAP_ERROR = str(e)

def get_base_dir():
    return os.path.dirname(os.path.abspath(__file__))

# ---------- 特徴量定義（学習時と同じ順序） ----------
FEATURES = [
    'StorageLevel', 'Inflow', 'Outflow', 'AvgTemp',
    'Precipitation', 'SnowDepth', 'Snowfall',
    'Precip_7d_sum', 'Precip_30d_sum', 'Temp_7d_avg',
    'SnowDepth_30d_avg', 'Snowfall_7d_sum', 'Month',
    'Forecast_Precip_7d_sum', 'Forecast_Temp_7d_avg'
]

def get_reasons(model, df_input, feature_names):
    """SHAPベースの寄与度をincrease/decrease配列で返す（鳴子/釜房と同形式）"""
    if not SHAP_AVAILABLE:
        return {"error": SHAP_ERROR}

    explainer = shap.TreeExplainer(model)
    shap_vals = explainer.shap_values(df_input)

    # shap_vals の形状対応 (1サンプルなので1次元配列にする)
    if len(shap_vals.shape) == 2:
        shap_vals = shap_vals[0]
    elif len(shap_vals.shape) == 3:
        shap_vals = shap_vals[0][0]

    contributions = list(zip(feature_names, shap_vals))
    sorted_contributions = sorted(contributions, key=lambda x: x[1])

    neg_reasons = [{"feature": f, "impact": round(float(v), 2)} for f, v in sorted_contributions if v < 0]
    pos_reasons = [{"feature": f, "impact": round(float(v), 2)} for f, v in sorted_contributions if v > 0]

    return {
        "increase": sorted(pos_reasons, key=lambda x: x["impact"], reverse=True)[:2],
        "decrease": sorted(neg_reasons, key=lambda x: x["impact"])[:2]
    }


def main():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"error": "No input provided"}))
            return

        data = json.loads(input_data)

        # DataFrame化
        df = pd.DataFrame([data])

        # 不足カラムを補完
        for col in FEATURES:
            if col not in df.columns:
                df[col] = 0.0

        # 学習時と同じ順序に並び替え
        X = df[FEATURES]

        base_dir = get_base_dir()
        models_dir = os.path.join(base_dir, '../models')

        results = {}

        for horizon in ['7d', '28d', '60d', '90d']:
            model_path = os.path.join(models_dir, f'ookura_rf_{horizon}.pkl')

            if not os.path.exists(model_path):
                results[horizon] = {"error": f"Model not found for {horizon}"}
                continue

            with open(model_path, 'rb') as f:
                rf = pickle.load(f)

            # 予測
            pred = rf.predict(X)[0]

            # 各決定木の予測値の標準偏差 (不確実性)
            preds_all_trees = np.array([tree.predict(X.values) for tree in rf.estimators_])
            std = np.std(preds_all_trees)
            min_val = float(np.min(preds_all_trees))
            max_val = float(np.max(preds_all_trees))

            # SHAP寄与度（increase/decrease 形式）
            reasons = get_reasons(rf, X, FEATURES)

            results[horizon] = {
                "mean": round(float(pred), 2),
                "std": round(float(std), 2),
                "min": round(min_val, 2),
                "max": round(max_val, 2),
                "reasons": reasons
            }

        print(json.dumps(results, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()


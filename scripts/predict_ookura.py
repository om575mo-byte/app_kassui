import sys
import json
import os
import pickle
import warnings
import pandas as pd
import numpy as np
import gc

# SHAPのインポート（エラー回避付き）
try:
    import shap
    SHAP_AVAILABLE = True
except Exception as e:
    SHAP_AVAILABLE = False
    SHAP_ERROR = str(e)

# 環境変数で分析（SHAP）の有効/無効を切り替え可能にする
ENABLE_SHAP = os.environ.get('ENABLE_AI_REASONS', 'true').lower() == 'true'

def get_base_dir():
    return os.path.dirname(os.path.abspath(__file__))

# ---------- 特徴量定義 ----------
FEATURES = [
    'StorageLevel', 'Inflow', 'Outflow', 'AvgTemp',
    'Precipitation', 'SnowDepth', 'Snowfall',
    'Precip_7d_sum', 'Precip_30d_sum', 'Temp_7d_avg',
    'SnowDepth_30d_avg', 'Snowfall_7d_sum', 'Month',
    'Forecast_Precip_7d_sum', 'Forecast_Temp_7d_avg'
]

def get_reasons(model, df_input, feature_names):
    if not (SHAP_AVAILABLE and ENABLE_SHAP):
        return {"error": "SHAP disabled or not available"}

    try:
        explainer = shap.TreeExplainer(model)
        shap_vals = explainer.shap_values(df_input)

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
    except Exception as e:
        return {"error": str(e)}

def main():
    try:
        input_data = sys.stdin.read().strip() if not sys.argv[1:] else sys.argv[1]
        if not input_data:
            print(json.dumps({"error": "No input provided"}))
            return

        data = json.loads(input_data)
        df = pd.DataFrame([data])
        for col in FEATURES:
            if col not in df.columns:
                df[col] = 0.0
        X = df[FEATURES]

        base_dir = get_base_dir()
        models_dir = os.path.join(base_dir, '../models')
        results = {}

        for horizon in ['7d', '28d', '60d', '90d']:
            model_path = os.path.join(models_dir, f'ookura_rf_{horizon}.pkl')
            if not os.path.exists(model_path):
                continue

            with open(model_path, 'rb') as f:
                model = pickle.load(f)
                pred = model.predict(X.values)[0]
                preds_all_trees = np.array([tree.predict(X.values)[0] for tree in model.estimators_])
                
                results[horizon] = {
                    "mean": round(float(pred), 2),
                    "std": round(float(np.std(preds_all_trees)), 2),
                    "min": round(float(np.min(preds_all_trees)), 2),
                    "max": round(float(np.max(preds_all_trees)), 2),
                    "reasons": get_reasons(model, X, FEATURES) if ENABLE_SHAP else {"status": "skipped"}
                }
                
                # 解放
                del model
                del preds_all_trees
                gc.collect()

        print(json.dumps(results, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    warnings.filterwarnings("ignore")
    main()


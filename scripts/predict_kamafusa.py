"""
釜房ダム AI推論スクリプト
DataAggregator.js から呼び出され、JSON入力を受け取り予測結果を返す。
モデルは仙台観測所データで学習済みの kamafusa_rf_*.pkl を使用。
"""

import sys
import json
import os
import pickle
import warnings
import pandas as pd
import numpy as np
try:
    import shap
    SHAP_AVAILABLE = True
except Exception as e:
    SHAP_AVAILABLE = False
    SHAP_ERROR = str(e)

def get_reasons(model, df_input, feature_names):
    if not SHAP_AVAILABLE:
        return {"error": SHAP_ERROR}
    
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

def predict(features_dict):
    base_dir = os.path.dirname(__file__)
    horizons = ['7d', '28d', '60d', '90d']
    model_paths = {h: os.path.join(base_dir, f'../models/kamafusa_rf_{h}.pkl') for h in horizons}
    
    if not all(os.path.exists(p) for p in model_paths.values()):
        return {"error": "Kamafusa models not found. Run train_kamafusa_model.py first."}
    
    feature_names = [
        'StorageLevel', 'Inflow', 'Outflow', 'AvgTemp', 
        'Precipitation', 'SnowDepth', 'Snowfall',
        'Precip_7d_sum', 'Precip_30d_sum', 'Temp_7d_avg', 
        'SnowDepth_30d_avg', 'Snowfall_7d_sum', 'Month',
        'Forecast_Precip_7d_sum', 'Forecast_Temp_7d_avg'
    ]
    
    input_data = {}
    for f in feature_names:
        input_data[f] = [float(features_dict.get(f, 0.0))]
        
    df = pd.DataFrame(input_data)
    results = {}
    
    try:
        for h in horizons:
            with open(model_paths[h], 'rb') as f:
                rf = pickle.load(f)
                preds = np.array([tree.predict(df)[0] for tree in rf.estimators_])
                results[h] = {
                    'mean': round(float(np.mean(preds)), 2),
                    'std': round(float(np.std(preds)), 2),
                    'min': round(float(np.min(preds)), 2),
                    'max': round(float(np.max(preds)), 2),
                    'reasons': get_reasons(rf, df, feature_names) if SHAP_AVAILABLE else {"error": SHAP_ERROR}
                }
                
        return {"success": True, "predictions": results}
        
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    warnings.filterwarnings("ignore")
    input_str = ""
    if len(sys.argv) > 1:
        input_str = sys.argv[1]
    else:
        input_str = sys.stdin.read().strip()
        
    if not input_str:
        print(json.dumps({"error": "No input JSON provided via args or stdin"}))
        sys.exit(1)
        
    try:
        input_json = json.loads(input_str)
        result = predict(input_json)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON input: {str(e)}"}))

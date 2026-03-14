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
    
    # shap_vals の形状対応 (1サンプルなので1次元配列にする)
    if len(shap_vals.shape) == 2:
        shap_vals = shap_vals[0]
    elif len(shap_vals.shape) == 3: # multi-output の場合 (通常Regressorではないが念のため)
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
    model_7d_path = os.path.join(base_dir, '../models/isawa_rf_7d.pkl')
    model_28d_path = os.path.join(base_dir, '../models/isawa_rf_28d.pkl')
    model_60d_path = os.path.join(base_dir, '../models/isawa_rf_60d.pkl')
    model_90d_path = os.path.join(base_dir, '../models/isawa_rf_90d.pkl')
    
    required_models = [model_7d_path, model_28d_path, model_60d_path, model_90d_path]
    if not all(os.path.exists(p) for p in required_models):
        return {"error": "Models not found. Run training script first."}
    
    feature_names = [
        'StorageLevel', 'Inflow', 'Outflow', 'AvgTemp', 
        'Precipitation', 'SnowDepth', 'Snowfall',
        'Precip_7d_sum', 'Precip_30d_sum', 'Temp_7d_avg', 
        'SnowDepth_30d_avg', 'Snowfall_7d_sum', 'Month',
        'Forecast_Precip_7d_sum', 'Forecast_Temp_7d_avg'
    ]
    
    # 欠損がある場合は0埋め等でハンドリング
    input_data = {}
    for f in feature_names:
        input_data[f] = [float(features_dict.get(f, 0.0))]
        
    df = pd.DataFrame(input_data)
    
    results = {}
    
    try:
        # 7日後モデルの予測
        with open(model_7d_path, 'rb') as f:
            rf_7d = pickle.load(f)
            preds_7d = np.array([tree.predict(df)[0] for tree in rf_7d.estimators_])
            results['7d'] = {
                'mean': round(float(np.mean(preds_7d)), 2),
                'std': round(float(np.std(preds_7d)), 2),
                'min': round(float(np.min(preds_7d)), 2),
                'max': round(float(np.max(preds_7d)), 2),
                'reasons': get_reasons(rf_7d, df, feature_names) if SHAP_AVAILABLE else {"error": SHAP_ERROR}
            }
            
        # 28日後モデルの予測
        with open(model_28d_path, 'rb') as f:
            rf_28d = pickle.load(f)
            preds_28d = np.array([tree.predict(df)[0] for tree in rf_28d.estimators_])
            results['28d'] = {
                'mean': round(float(np.mean(preds_28d)), 2),
                'std': round(float(np.std(preds_28d)), 2),
                'min': round(float(np.min(preds_28d)), 2),
                'max': round(float(np.max(preds_28d)), 2),
                'reasons': get_reasons(rf_28d, df, feature_names) if SHAP_AVAILABLE else {"error": SHAP_ERROR}
            }
            
        # 60日後モデルの予測
        with open(model_60d_path, 'rb') as f:
            rf_60d = pickle.load(f)
            preds_60d = np.array([tree.predict(df)[0] for tree in rf_60d.estimators_])
            results['60d'] = {
                'mean': round(float(np.mean(preds_60d)), 2),
                'std': round(float(np.std(preds_60d)), 2),
                'min': round(float(np.min(preds_60d)), 2),
                'max': round(float(np.max(preds_60d)), 2),
                'reasons': get_reasons(rf_60d, df, feature_names) if SHAP_AVAILABLE else {"error": SHAP_ERROR}
            }
            
        # 90日後モデルの予測
        with open(model_90d_path, 'rb') as f:
            rf_90d = pickle.load(f)
            preds_90d = np.array([tree.predict(df)[0] for tree in rf_90d.estimators_])
            results['90d'] = {
                'mean': round(float(np.mean(preds_90d)), 2),
                'std': round(float(np.std(preds_90d)), 2),
                'min': round(float(np.min(preds_90d)), 2),
                'max': round(float(np.max(preds_90d)), 2),
                'reasons': get_reasons(rf_90d, df, feature_names) if SHAP_AVAILABLE else {"error": SHAP_ERROR}
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
        # Read from stdin
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

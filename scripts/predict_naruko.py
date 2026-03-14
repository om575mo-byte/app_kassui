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

# 環境変数で分析（SHAP）の有効/無効を切り替え可能にする（メモリ節約用）
ENABLE_SHAP = os.environ.get('ENABLE_AI_REASONS', 'true').lower() == 'true'

def get_reasons(model, df_input, feature_names):
    if not (SHAP_AVAILABLE and ENABLE_SHAP):
        return {"error": "SHAP disabled or not available"}
    
    try:
        explainer = shap.TreeExplainer(model)
        shap_vals = explainer.shap_values(df_input)
        
        # shap_vals の形状対応
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

def predict(features_dict):
    base_dir = os.path.dirname(__file__)
    horizons = ['7d', '28d', '60d', '90d']
    
    feature_names = [
        'StorageLevel', 'Inflow', 'Outflow', 'AvgTemp', 
        'Precipitation', 'SnowDepth', 'Snowfall',
        'Precip_7d_sum', 'Precip_30d_sum', 'Temp_7d_avg', 
        'SnowDepth_30d_avg', 'Snowfall_7d_sum', 'Month',
        'Forecast_Precip_7d_sum', 'Forecast_Temp_7d_avg',
        'Forecast_1M_Precip_Below', 'Forecast_1M_Precip_Normal', 'Forecast_1M_Precip_Above',
        'Forecast_1M_Temp_Below', 'Forecast_1M_Temp_Normal', 'Forecast_1M_Temp_Above'
    ]
    
    input_data = {f: [float(features_dict.get(f, 0.0))] for f in feature_names}
    df = pd.DataFrame(input_data)
    
    results = {}
    
    try:
        for h in horizons:
            model_path = os.path.join(base_dir, f'../models/naruko_rf_{h}.pkl')
            if not os.path.exists(model_path):
                continue
            
            # モデルを1つずつ読み込み（メモリ節約）
            with open(model_path, 'rb') as f:
                model = pickle.load(f)
                
                # 予測と分布計算
                preds = np.array([tree.predict(df.values)[0] for tree in model.estimators_])
                
                results[h] = {
                    'mean': round(float(np.mean(preds)), 2),
                    'std': round(float(np.std(preds)), 2),
                    'min': round(float(np.min(preds)), 2),
                    'max': round(float(np.max(preds)), 2),
                    'reasons': get_reasons(model, df, feature_names) if ENABLE_SHAP else {"status": "skipped"}
                }
                
                # 使用済みモデルを明示的に削除してGC実行
                del model
                del preds
                gc.collect()
            
        return {"success": True, "predictions": results}
        
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    warnings.filterwarnings("ignore")
    input_str = sys.stdin.read().strip() if not sys.argv[1:] else sys.argv[1]
    
    if not input_str:
        print(json.dumps({"error": "No input JSON provided"}))
        sys.exit(1)
        
    try:
        input_json = json.loads(input_str)
        print(json.dumps(predict(input_json)))
    except Exception as e:
        print(json.dumps({"error": f"Invalid input: {str(e)}"}))

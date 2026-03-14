import os
import glob
import pandas as pd
import numpy as np
import io
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit

def parse_dat_file(filepath):
    """
    .datファイル（Shift_JIS）を読み込み、日ごとの値(1次元シリーズ)を返す
    """
    try:
        with open(filepath, 'r', encoding='Shift_JIS', errors='replace') as f:
            lines = f.readlines()
            
        data_records = []
        for line in lines:
            line = line.strip()
            # "1日,-9999.99,-,..." のように始まる行を探す（先頭が数字+"日"または文字化け""）
            # splitして最初が数字かどうかで判定
            parts = line.split(',')
            if not parts: continue
            
            day_str = re.sub(r'\D', '', parts[0])
            if not day_str.isdigit():
                continue
                
            day = int(day_str)
            if not (1 <= day <= 31):
                continue
                
            # parts[1]以降は 値,フラグ,値,フラグ... と並んでいる想定 (1月〜12月)
            # 値だけ(奇数インデックス)を取り出す
            values = []
            for i in range(1, len(parts), 2):
                if i < 25: # 12ヶ月分
                    try:
                        val_str = parts[i].strip()
                        # 空白や特殊文字を除去
                        val_str = re.sub(r'[^\d.-]', '', val_str)
                        if val_str and val_str != '-':
                            val = float(val_str)
                            # -9999.99 は欠測
                            if val > -9000:
                                values.append(val)
                            else:
                                values.append(np.nan)
                        else:
                            values.append(np.nan)
                    except:
                        values.append(np.nan)
            
            for m in range(len(values)):
                data_records.append({'MonthNum': m+1, 'Day': day, 'Value': values[m]})
                
        df_melt = pd.DataFrame(data_records)
        if df_melt.empty:
            return pd.Series()
            
        # Noneを除去
        df_melt = df_melt.dropna(subset=['Value']).sort_values(by=['MonthNum', 'Day']).reset_index(drop=True)
        return df_melt['Value']
        
    except Exception as e:
        print(f"Error parsing {filepath}: {e}")
        return pd.Series()

def main():
    base_dir = r"c:\Users\moika\.gemini\antigravity\playground\app_kassui\dum_data\suii\hirosebashi"
    
    # 年ごとのファイルをペアで取得
    suii_files = sorted(glob.glob(os.path.join(base_dir, "suii*.dat")))
    
    all_H = []
    all_Q = []
    
    for suii_file in suii_files:
        filename = os.path.basename(suii_file)
        # suii2011.dat -> 2011
        year_str = re.search(r'\d{4}', filename).group()
        ryuuryou_file = os.path.join(base_dir, f"ryuuryou{year_str}.dat")
        
        if os.path.exists(ryuuryou_file):
            print(f"Processing year {year_str}...")
            # 水位と流量をパース
            h_series = parse_dat_file(suii_file)
            q_series = parse_dat_file(ryuuryou_file)
            
            if not h_series.empty and not q_series.empty:
                # 念のためサイズが同じかチェック
                min_len = min(len(h_series), len(q_series))
                all_H.extend(h_series[:min_len].tolist())
                all_Q.extend(q_series[:min_len].tolist())
    
    df = pd.DataFrame({'WaterLevel': all_H, 'Flow': all_Q}).dropna()
    print(f"\nTotal valid data points: {len(df)}")
    
    # 物理的におかしい値を除外 (例: Flow <= 0)
    df = df[df['Flow'] > 0]
    
    if len(df) == 0:
        print("No valid data available for fitting.")
        return
        
    H = df['WaterLevel'].values
    Q = df['Flow'].values
    
    print(f"WaterLevel Range: {H.min()} ~ {H.max()}")
    print(f"Flow Range: {Q.min()} ~ {Q.max()}")
    
    def hq_curve(h, a, b):
        return a * (h + b)**2
        
    def log_hq_curve(h, a, b):
        val = a * (h + b)**2
        return np.log(np.where(val > 0, val, 1e-10))
        
    b_guess = -H.min() + 0.1
    
    # 1. 通常の自乗誤差最小化
    popt_norm, _ = curve_fit(hq_curve, H, Q, p0=[10, b_guess], maxfev=10000)
    
    # 2. 低流量域（対数）での自乗誤差最小化
    popt_log, _ = curve_fit(log_hq_curve, H, np.log(Q), p0=[10, b_guess], maxfev=10000)
    
    print("\n--- Standard Fit (High Flow focus) ---")
    print(f"Q = {popt_norm[0]:.4f} * (H + {popt_norm[1]:.4f})^2")
    
    print("\n--- Log Fit (Low Flow focus) ---")
    print(f"Q = {popt_log[0]:.4f} * (H + {popt_log[1]:.4f})^2")
    
    # 低流量(Q < 5.0)でのR2スコア比較
    mask_low = Q < 5.0
    if np.sum(mask_low) > 0:
        H_low = H[mask_low]
        Q_low = Q[mask_low]
        
        Q_est_norm = hq_curve(H_low, *popt_norm)
        Q_est_log = hq_curve(H_low, *popt_log)
        
        ss_tot = np.sum((Q_low - np.mean(Q_low))**2)
        r2_norm = 1 - (np.sum((Q_low - Q_est_norm)**2) / ss_tot)
        r2_log = 1 - (np.sum((Q_low - Q_est_log)**2) / ss_tot)
        
        print("\n--- Low Flow (< 5.0 m3/s) Evaluation ---")
        print(f"Standard Fit R2: {r2_norm:.4f}")
        print(f"Log Fit R2: {r2_log:.4f}")
        
    # Plotting
    plt.figure(figsize=(10, 6))
    plt.scatter(H, Q, alpha=0.1, s=10, label=f'Actual Data ({len(df)} points)')
    
    h_line = np.linspace(H.min(), H.max(), 100)
    plt.plot(h_line, hq_curve(h_line, *popt_norm), color='red', label=f'Standard Fit: Q={popt_norm[0]:.2f}(H+{popt_norm[1]:.2f})^2')
    plt.plot(h_line, hq_curve(h_line, *popt_log), color='orange', linestyle='--', label=f'Log Fit: Q={popt_log[0]:.2f}(H+{popt_log[1]:.2f})^2')
    
    plt.title('H-Q Relationship for Hirosebashi (2011-2024)')
    plt.xlabel('Water Level (H) [m]')
    plt.ylabel('Flow Rate (Q) [m3/s]')
    plt.grid(True)
    plt.legend()
    # Y軸の上限を設けて低流量域を見やすくする
    plt.ylim(0, np.percentile(Q, 95)) 
    
    output_path = r'c:\Users\moika\.gemini\antigravity\brain\668a5dfd-2235-4ff4-a8b2-8901273f3eb6\hq_curve_plot_all_years.png'
    plt.savefig(output_path, dpi=150)
    print(f"\nPlot saved to {output_path}")

if __name__ == "__main__":
    import re
    main()

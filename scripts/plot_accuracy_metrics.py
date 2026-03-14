import matplotlib.pyplot as plt
import numpy as np
import os
import matplotlib

# Set reasonable font for Japanese if available, otherwise default
matplotlib.rcParams['font.family'] = 'sans-serif'

# Data
models = ['7d', '28d', '60d', '90d']

# MAE (Mean Absolute Error) - Lower is better
mae_base = [1.221, 2.589, 2.884, 2.736]
mae_month = [1.201, 2.432, 2.616, 2.629]
mae_forecast = [1.020, 2.411, 2.514, 2.540]

# R2 (R-squared) - Higher is better
r2_base = [0.881, 0.483, 0.429, 0.524]
r2_month = [0.885, 0.561, 0.514, 0.559]
r2_forecast = [0.913, 0.571, 0.546, 0.585]

x = np.arange(len(models))
width = 0.25

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))

colors = ['#cccccc', '#6fa8dc', '#3d85c6']
labels = ['v1 (12 Features)', 'v2 (+ Month Rule)', 'v3 (+ Forecast API)']

# Plot MAE
ax1.bar(x - width, mae_base, width, label=labels[0], color=colors[0])
ax1.bar(x, mae_month, width, label=labels[1], color=colors[1])
ax1.bar(x + width, mae_forecast, width, label=labels[2], color=colors[2])
ax1.set_ylabel('Mean Absolute Error (m)')
ax1.set_title('Prediction Error (MAE) - Lower is Better')
ax1.set_xticks(x)
ax1.set_xticklabels(models)
ax1.legend()
ax1.grid(axis='y', linestyle='--', alpha=0.7)

# Plot R2
ax2.bar(x - width, r2_base, width, label=labels[0], color=colors[0])
ax2.bar(x, r2_month, width, label=labels[1], color=colors[1])
ax2.bar(x + width, r2_forecast, width, label=labels[2], color=colors[2])
ax2.set_ylabel('R-squared (R2)')
ax2.set_title('Prediction Accuracy (R2) - Higher is Better')
ax2.set_xticks(x)
ax2.set_xticklabels(models)
ax2.legend(loc='lower left')
ax2.set_ylim(0, 1.0)
ax2.grid(axis='y', linestyle='--', alpha=0.7)

plt.tight_layout()

# Save image
output_path = os.path.join(os.path.dirname(__file__), '../docs/analysis_results/metrics_comparison.png')
os.makedirs(os.path.dirname(output_path), exist_ok=True)
plt.savefig(output_path, dpi=300)
print(f"Graph saved to {output_path}")


/**
 * ダッシュボード管理モジュール
 * サイドパネルの表示を管理する
 */

import { focusDam, resizeMap } from './mapManager.js';

let currentWeatherMsg = null;
let currentWeatherRegionIndex = 0;

/**
 * サマリーカードを更新
 * @param {object} summary - サマリーデータ
 */
export function updateSummary(summary) {
  if (!summary) return;

  const avgEl = document.getElementById('avg-storage');
  const normalEl = document.getElementById('count-normal');
  const cautionEl = document.getElementById('count-caution');
  const warningEl = document.getElementById('count-warning');
  const criticalEl = document.getElementById('count-critical');

  if (avgEl) {
    animateNumberTo(avgEl, summary.averageStorageRate || 0);
  }

  if (normalEl) normalEl.textContent = summary.counts?.normal || 0;
  if (cautionEl) cautionEl.textContent = summary.counts?.caution || 0;
  if (warningEl) warningEl.textContent = summary.counts?.warning || 0;
  if (criticalEl) criticalEl.textContent = summary.counts?.critical || 0;
}

/**
 * ダム一覧を更新
 * @param {Array} dams - ダムデータ配列
 * @param {Function} onDetail - 詳細表示コールバック
 */
export function updateDamList(dams, onDetail) {
  const listEl = document.getElementById('dam-list');
  if (!listEl) return;

  // 渇水レベルの深刻度でソート（危険→正常の順）
  const sortedDams = [...dams].sort((a, b) => {
    const rateA = a.storageRate ?? 999;
    const rateB = b.storageRate ?? 999;
    return rateA - rateB;
  });

  listEl.innerHTML = sortedDams.map((dam) => {
    const level = dam.droughtLevel || { color: '#94a3b8', id: 'unknown' };
    const rate = dam.storageRate != null ? dam.storageRate : null;
    const rateText = rate != null ? `${rate}%` : '—';
    const barWidth = rate != null ? rate : 0;

    return `
      <div class="dam-list-item" data-dam-id="${dam.id}">
        <span class="dam-list-dot" style="background:${level.color}; color:${level.color};"></span>
        <div class="dam-list-info">
          <div class="dam-list-name">${dam.name}</div>
          <div class="dam-list-river">${dam.river || '—'} / ${dam.waterSystem || '—'}</div>
        </div>
        <span class="dam-list-rate" style="color:${level.color}">${rateText}</span>
        <div class="dam-list-bar">
          <div class="dam-list-bar-fill" style="width:${barWidth}%; background:${level.color};"></div>
        </div>
      </div>
    `;
  }).join('');

  // クリックイベント
  listEl.querySelectorAll('.dam-list-item').forEach((item) => {
    item.addEventListener('click', () => {
      const damId = item.dataset.damId;
      const dam = dams.find((d) => d.id === damId);
      if (dam) {
        focusDam(damId);
        if (onDetail) onDetail(dam);
      }
    });
  });
}

/**
 * 天気情報を更新
 * @param {object} weather - 天気データ
 */
export function updateWeather(weather) {
  const el = document.getElementById('weather-content');
  if (!el || !weather) return;

  if (weather.error || !weather.regions || weather.regions.length === 0) {
    el.innerHTML = `<p class="weather-forecast" style="color:var(--text-muted);">天気データを取得できませんでした</p>`;
    return;
  }

  currentWeatherMsg = weather;

  // 選択中のタブインデックスが新しいデータの地域数を超えている場合はリセット（県切り替え時など）
  if (currentWeatherRegionIndex >= weather.regions.length) {
    currentWeatherRegionIndex = 0;
  }

  renderWeatherRegion();
}

/**
 * 選択された地域の天気をレンダリング
 */
function renderWeatherRegion() {
  const el = document.getElementById('weather-content');
  if (!el || !currentWeatherMsg) return;

  const region = currentWeatherMsg.regions[currentWeatherRegionIndex];
  if (!region) return;

  // JMAのweatherCodeをベースに絵文字を判定 (簡易版)
  const codeIcons = {
    '100': '☀️', '101': '⛅', '102': '🌦️', '104': '🌨️', '110': '🌤️', '111': '⛅', '112': '🌧️',
    '200': '☁️', '201': '🌥️', '202': '🌧️', '204': '🌨️', '210': '🌥️', '211': '☁️', '212': '🌧️',
    '300': '☔', '301': '🌦️', '302': '🌧️', '311': '🌧️', '313': '🌧️', '314': '🌨️',
    '400': '⛄', '401': '🌨️', '402': '🌨️', '411': '🌨️', '413': '🌨️', '414': '🌧️'
  };

  const getIcon = (code) => {
    if (!code) return '🌫️';
    const c = String(code);
    return codeIcons[c] || (c.startsWith('1') ? '☀️' : c.startsWith('2') ? '☁️' : c.startsWith('3') ? '☔' : c.startsWith('4') ? '⛄' : '🌫️');
  };

  let tabsHtml = '';
  if (currentWeatherMsg.regions.length > 1) {
    const tabs = currentWeatherMsg.regions.map((r, i) => `
      <div class="weather-tab ${i === currentWeatherRegionIndex ? 'active' : ''}" data-index="${i}">
        ${r.name}
      </div>
    `).join('');
    tabsHtml = `<div class="weather-tabs">${tabs}</div>`;
  }

  const todayForecast = region.weathers?.[0] || '取得できませんでした';
  const todayCode = region.weatherCodes?.[0];
  const todayIcon = getIcon(todayCode);

  let popsHtml = '';
  if (region.pops && region.pops.length > 0) {
    const popItems = region.pops.map((pop, i) => {
      const time = currentWeatherMsg.popTimeDefines?.[i];
      const timeLabel = time ? formatTime(time) : '';
      return `
        <div class="pop-item">
          <span class="pop-time">${timeLabel}</span>
          <span class="pop-value">${pop}%</span>
        </div>
      `;
    }).slice(0, 4).join(''); // 直近4件の降水確率のみ表示

    popsHtml = `
      <div class="weather-pops-title">降水確率</div>
      <div class="weather-pops">${popItems}</div>
    `;
  }

  // 週間予報のHTML生成
  let weeklyHtml = '';
  if (region.weekly && region.weekly.length > 0) {
    const weeklyItems = region.weekly.map((day) => {
      const d = new Date(day.date);
      const dayLabel = `${d.getDate()}日(${['日', '月', '火', '水', '木', '金', '土'][d.getDay()]})`;
      const icon = getIcon(day.weatherCode);
      const popStr = day.pop ? `${day.pop}%` : '-';

      return `
        <div class="weekly-item">
          <div class="weekly-date">${dayLabel}</div>
          <div class="weekly-icon">${icon}</div>
          <div class="weekly-pop">${popStr}</div>
          <div class="weekly-temps">
            <span class="temp-max">${day.maxTemp || '-'}</span>
            <span class="temp-sep">/</span>
            <span class="temp-min">${day.minTemp || '-'}</span>
          </div>
        </div>
      `;
    }).join('');

    weeklyHtml = `
      <div class="weather-weekly-title">週間予報</div>
      <div class="weather-weekly">${weeklyItems}</div>
    `;
  }

  el.innerHTML = `
    ${tabsHtml}
    <div class="weather-today-container">
      <div class="weather-icon">${todayIcon}</div>
      <div class="weather-text-wrap">
        <div class="weather-forecast">${todayForecast}</div>
      </div>
    </div>
    ${popsHtml}
    ${weeklyHtml}
  `;

  // タブのイベントリスナー設定
  const tabEls = el.querySelectorAll('.weather-tab');
  tabEls.forEach(tab => {
    tab.addEventListener('click', (e) => {
      currentWeatherRegionIndex = parseInt(e.currentTarget.dataset.index, 10);
      renderWeatherRegion();
    });
  });
}

/**
 * 更新日時を表示
 */
export function updateTimestamp(isoString) {
  const el = document.querySelector('#last-updated .update-text');
  if (!el) return;

  const date = new Date(isoString);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  el.textContent = `${hh}:${mm} 更新`;
}

/**
 * AI予測の要因(特徴量)を日本語に変換
 */
const translateFeature = (featureName) => {
  const map = {
    'StorageLevel': '現在の貯水位',
    'Inflow': '現在の流入量',
    'Outflow': '現在の放流量',
    'AvgTemp': '当日の気温',
    'Precipitation': '当日の雨量',
    'SnowDepth': '山の積雪量（融雪ポテンシャル）',
    'Snowfall': '直近の寒波・降雪',
    'Precip_7d_sum': '最近一週間の雨量',
    'Precip_30d_sum': '過去1ヶ月の降水状況',
    'Temp_7d_avg': '最近一週間の気温傾向',
    'SnowDepth_30d_avg': '積雪による今後の雪解け見込み',
    'Snowfall_7d_sum': '最近一週間の降雪傾向',
    'Month': '現在の時期 (季節・運用ルール)',
    'Forecast_Precip_7d_sum': '【予報】週間予想雨量',
    'Forecast_Temp_7d_avg': '【予報】週間予想気温'
  };
  return map[featureName] || featureName;
};

/**
 * AI予測の理由テキストを組み立ててHTML出力
 */
const formatReason = (reasons) => {
  if (!reasons) return '';
  let txt = '<div style="font-size:0.7rem; margin-top:8px; padding-top:4px; border-top:1px dashed rgba(59, 130, 246, 0.3); line-height:1.5;">';
  if (reasons.increase && reasons.increase.length > 0) {
    txt += `<div style="color:#ef4444;">▲上昇要因: ${translateFeature(reasons.increase[0].feature)}</div>`;
  }
  if (reasons.decrease && reasons.decrease.length > 0) {
    txt += `<div style="color:#3b82f6;">▼低下要因: ${translateFeature(reasons.decrease[0].feature)}</div>`;
  }
  txt += '</div>';
  return txt;
};

/**
 * 詳細モーダルを表示
 * @param {object} dam - ダムデータ
 */
export function showDamDetail(dam) {
  const modal = document.getElementById('dam-detail-modal');
  const body = document.getElementById('modal-body');
  if (!modal || !body) return;

  const level = dam.droughtLevel || { color: '#94a3b8', label: '不明', icon: '⚪' };
  const rate = dam.storageRate != null ? dam.storageRate : null;
  const rateText = rate != null ? `${rate}%` : '—';
  const effectiveRateText = dam.effectiveStorageRate != null ? `${dam.effectiveStorageRate}%` : '—';
  const volumeText = dam.storageVolume != null ? `${dam.storageVolume.toLocaleString()} 千m³` : '—';
  const usableCapText = dam.usableCapacity != null ? `${dam.usableCapacity.toLocaleString()} 千m³` : '—';
  const effectiveCapText = dam.effectiveCapacity != null ? `${dam.effectiveCapacity.toLocaleString()} 千m³` : '—';
  const totalText = dam.totalCapacity != null ? `${dam.totalCapacity.toLocaleString()} 千m³` : '—';
  const barWidth = rate != null ? rate : 0;

  body.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">${dam.name}</div>
      <div class="detail-subtitle">${dam.damType || '—'}</div>
      <div class="detail-level" style="background:${level.color}">
        ${level.icon} ${level.label}
      </div>
    </div>

    <div class="detail-bar">
      <div class="detail-bar-fill" style="width:${barWidth}%; background:${level.color};"></div>
    </div>

    <div class="detail-stats">
      <div class="detail-stat">
        <div class="detail-stat-label">貯水率(利水)</div>
        <div class="detail-stat-value" style="color:${level.color}">${rateText}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">貯水率(有効)</div>
        <div class="detail-stat-value">${effectiveRateText}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">貯水位</div>
        <div class="detail-stat-value">${dam.waterLevel != null ? dam.waterLevel + ' m' : '—'}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">貯水量</div>
        <div class="detail-stat-value">${volumeText}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">流入量</div>
        <div class="detail-stat-value">${dam.inflowRate != null ? dam.inflowRate + ' m³/s' : '—'}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">放流量</div>
        <div class="detail-stat-value">${dam.outflowRate != null ? dam.outflowRate + ' m³/s' : '—'}</div>
      </div>
    </div>

    ${dam.aiPrediction && dam.aiPrediction['7d'] && dam.aiPrediction['28d'] ? `
    <div class="detail-ai-prediction" style="margin-top: 1rem; padding: 0.75rem; background: rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; border-radius: 4px;">
      <div style="font-size: 0.8rem; font-weight: 600; color: #60a5fa; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 4px;">
        <span style="font-size: 1rem;">🤖</span>
        AI渇水予測 (Machine Learning)
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; font-size: 0.8rem;">
        <div>
          <div style="color: var(--text-muted); font-size: 0.75rem;">7日後の予想</div>
          <div style="margin-top: 2px;">危険度: <strong>${dam.aiPrediction['7d'].level.toUpperCase()}</strong></div>
          <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 2px;">水位: ${dam.aiPrediction['7d'].mean}m (±${dam.aiPrediction['7d'].std}m)</div>
          ${formatReason(dam.aiPrediction['7d'].reasons)}
        </div>
        <div>
          <div style="color: var(--text-muted); font-size: 0.75rem;">28日後の予想</div>
          <div style="margin-top: 2px;">危険度: <strong>${dam.aiPrediction['28d'].level.toUpperCase()}</strong></div>
          <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 2px;">水位: ${dam.aiPrediction['28d'].mean}m (±${dam.aiPrediction['28d'].std}m)</div>
          ${formatReason(dam.aiPrediction['28d'].reasons)}
        </div>
        ${dam.aiPrediction['60d'] ? `
        <div>
          <div style="color: var(--text-muted); font-size: 0.75rem;">60日後の予想</div>
          <div style="margin-top: 2px;">危険度: <strong>${dam.aiPrediction['60d'].level.toUpperCase()}</strong></div>
          <div style="color: var(--text-muted); font-size: 0.75rem; margin-top: 2px;">水位: ${dam.aiPrediction['60d'].mean}m (±${dam.aiPrediction['60d'].std}m)</div>
          ${formatReason(dam.aiPrediction['60d'].reasons)}
        </div>
        ` : ''}
      </div>
      <div style="margin-top: 0.75rem;">
        <canvas id="ai-forecast-chart" style="width:100%; max-height:220px;"></canvas>
      </div>

      ${dam.aiPrediction.forecast && dam.aiPrediction.forecast.length > 0 ? (() => {
        const codeIcons = {
          '100': '☀️', '101': '⛅', '102': '🌦️', '104': '🌨️', '110': '🌤️', '111': '⛅', '112': '🌧️',
          '200': '☁️', '201': '🌥️', '202': '🌧️', '204': '🌨️', '210': '🌥️', '211': '☁️', '212': '🌧️',
          '300': '☔', '301': '🌦️', '302': '🌧️', '311': '🌧️', '313': '🌧️', '314': '🌨️',
          '400': '⛄', '401': '🌨️', '402': '🌨️', '411': '🌨️', '413': '🌨️', '414': '🌧️'
        };
        const getIcon = (c) => codeIcons[String(c)] || (String(c).startsWith('1') ? '☀️' : String(c).startsWith('2') ? '☁️' : String(c).startsWith('3') ? '☔' : String(c).startsWith('4') ? '⛄' : '🌫️');

        const forecastHtml = dam.aiPrediction.forecast.map(day => {
          const mDate = day.date || '—';
          const mIcon = getIcon(day.icon || day.weatherCode);
          const mMax = day.tempMax ?? day.maxTemp ?? '-';
          const mMin = day.tempMin ?? day.minTemp ?? '-';
          const mPrecip = day.precip !== undefined ? `${day.precip}mm` : (day.pop ? `${day.pop}%` : '-');

          return `
            <div class="modal-forecast-item">
              <div style="font-size:0.75rem; color: #64748b;">${mDate}</div>
              <div style="font-size:1.25rem; margin:2px 0;">${mIcon}</div>
              <div style="font-size:0.7rem;">
                <span style="color:#ef4444;">${mMax}</span><span style="color:#94a3b8;margin:0 2px">/</span><span style="color:#3b82f6;">${mMin}</span>
              </div>
              <div style="font-size:0.7rem; color:#64748b; margin-top:2px;">${mPrecip}</div>
            </div>
          `;
        }).join('');

        return `
          <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid rgba(59, 130, 246, 0.2);">
            <div style="font-size: 0.75rem; color: #3b82f6; margin-bottom: 0.5rem;">※ AI予測の計算に用いたピンポイント週間予報</div>
            <div class="modal-forecast-container" style="display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 4px;">
              ${forecastHtml}
            </div>
          </div>
        `;
      })() : ''}
    </div>
    ` : ''}

    <div class="detail-info">
      <span class="detail-info-label">河川</span>
      <span>${dam.river || '—'}</span>
      <span class="detail-info-label">水系</span>
      <span>${dam.waterSystem || '—'}</span>
      <span class="detail-info-label">管理者</span>
      <span>${dam.manager || '—'}</span>
      <span class="detail-info-label">利水容量</span>
      <span>${usableCapText}</span>
      <span class="detail-info-label">有効貯水量</span>
      <span>${effectiveCapText}</span>
      <span class="detail-info-label">総貯水量</span>
      <span>${totalText}</span>
      <span class="detail-info-label">用途</span>
      <span>${(dam.purpose || []).join('、') || '—'}</span>
    </div>

    ${dam.mudamUrl ? `<a class="detail-link" href="${dam.mudamUrl}" target="_blank" rel="noopener">📊 ダム諸量データベースで詳細を見る</a>` : ''}
  `;

  modal.classList.remove('hidden');

  // アニメーション：バーを遅延で伸ばす
  requestAnimationFrame(() => {
    const barEl = body.querySelector('.detail-bar-fill');
    if (barEl) barEl.style.width = `${barWidth}%`;
  });

  // 鳴子ダムでAI予測がある場合、グラフを描画
  if (dam.aiPrediction && dam.aiPrediction['7d']) {
    renderForecastChart(dam);
  }
}

/**
 * AI予測と過去推移の比較グラフを描画
 */
async function renderForecastChart(dam) {
  const canvas = document.getElementById('ai-forecast-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  try {
    const res = await fetch(`/api/dam-history/${dam.id}`);
    const data = await res.json();
    if (!data.history) return;

    const history = data.history.filter(h => h.avg !== null);
    const labels = history.map(h => {
      const d = new Date(h.date);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    const avgLine = history.map(h => h.avg);
    const minLine = history.map(h => h.min);
    const maxLine = history.map(h => h.max);

    // AI予測ポイントの日付インデックスを計算
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const getOffset = (days) => {
      const target = new Date(today);
      target.setDate(target.getDate() + days);
      const dateStr = `${target.getMonth() + 1}/${target.getDate()}`;
      return labels.indexOf(dateStr);
    };

    // 予測値のデータ配列（空データ + 予測ポイントのみ）
    const predData = new Array(labels.length).fill(null);
    const predUpper = new Array(labels.length).fill(null);
    const predLower = new Array(labels.length).fill(null);

    // 今日（0日目）
    const todayIdx = 0;
    if (dam.waterLevel) {
      predData[todayIdx] = dam.waterLevel;
      predUpper[todayIdx] = dam.waterLevel;
      predLower[todayIdx] = dam.waterLevel;
    }

    [[7, '7d'], [28, '28d'], [60, '60d'], [90, '90d']].forEach(([days, key]) => {
      const p = dam.aiPrediction[key];
      if (p) {
        const idx = getOffset(days);
        if (idx >= 0 && idx < labels.length) {
          predData[idx] = p.mean;
          predUpper[idx] = p.mean + p.std;
          predLower[idx] = p.mean - p.std;
        }
      }
    });

    // 現在の水位の横線
    const currentLevel = new Array(labels.length).fill(dam.waterLevel || null);

    const ctx = canvas.getContext('2d');

    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '例年レンジ(最大)',
            data: maxLine,
            borderColor: 'transparent',
            backgroundColor: 'rgba(148, 163, 184, 0.15)',
            fill: '+1',
            pointRadius: 0,
            order: 5
          },
          {
            label: '例年レンジ(最小)',
            data: minLine,
            borderColor: 'transparent',
            backgroundColor: 'rgba(148, 163, 184, 0.15)',
            fill: false,
            pointRadius: 0,
            order: 5
          },
          {
            label: '例年平均',
            data: avgLine,
            borderColor: 'rgba(148, 163, 184, 0.6)',
            borderDash: [5, 3],
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            order: 3
          },
          {
            label: '現在の水位',
            data: currentLevel,
            borderColor: 'rgba(34, 197, 94, 0.5)',
            borderDash: [3, 3],
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            order: 4
          },
          {
            label: 'AI予測(上限)',
            data: predUpper,
            borderColor: 'transparent',
            backgroundColor: 'rgba(251, 146, 60, 0.2)',
            fill: '+1',
            pointRadius: 0,
            spanGaps: true,
            order: 2
          },
          {
            label: 'AI予測(下限)',
            data: predLower,
            borderColor: 'transparent',
            fill: false,
            pointRadius: 0,
            spanGaps: true,
            order: 2
          },
          {
            label: 'AI予測',
            data: predData,
            borderColor: '#fb923c',
            backgroundColor: '#fb923c',
            borderWidth: 2,
            fill: false,
            pointRadius: (ctx) => ctx.raw !== null ? 5 : 0,
            pointStyle: 'circle',
            pointBackgroundColor: '#fb923c',
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5,
            spanGaps: true,
            order: 1
          },
          // 最低水位ライン（lowestWaterLevel がある場合のみ表示）
          ...(dam.lowestWaterLevel ? [{
            label: '最低水位',
            data: new Array(labels.length).fill(dam.lowestWaterLevel),
            borderColor: 'rgba(239, 68, 68, 0.7)',
            borderDash: [6, 4],
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            order: 6
          }] : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              color: '#94a3b8',
              font: { size: 9 },
              boxWidth: 12,
              padding: 8,
              filter: (item) => !item.text.includes('上限') && !item.text.includes('下限') && !item.text.includes('レンジ')
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleColor: '#e2e8f0',
            bodyColor: '#cbd5e1',
            bodyFont: { size: 11 },
            callbacks: {
              label: function (context) {
                if (context.raw === null) return null;
                return `${context.dataset.label}: ${context.raw.toFixed(1)}m`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#64748b',
              font: { size: 9 },
              maxTicksLimit: 10,
              maxRotation: 0
            },
            grid: { color: 'rgba(51, 65, 85, 0.3)' }
          },
          y: {
            title: { display: true, text: '貯水位 (EL m)', color: '#94a3b8', font: { size: 10 } },
            ticks: { color: '#64748b', font: { size: 10 } },
            grid: { color: 'rgba(51, 65, 85, 0.3)' }
          }
        }
      }
    });

  } catch (e) {
    console.error('Forecast chart render error:', e);
  }
}

/**
 * モーダルを閉じる
 */
export function closeDamDetail() {
  const modal = document.getElementById('dam-detail-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * パネルの開閉を切り替え
 */
export function togglePanel() {
  const panel = document.getElementById('side-panel');
  if (panel) {
    panel.classList.toggle('panel-open');
    // CSSのtransition（widthの変更）完了に合わせてマップをリサイズ
    setTimeout(() => {
      resizeMap();
    }, 300);
  }
}

/* --- ユーティリティ --- */

function formatTime(isoString) {
  const d = new Date(isoString);
  const date = d.getDate();
  const hours = d.getHours();
  return `${date}日 ${hours}時`;
}

function animateNumberTo(element, target) {
  const duration = 600;
  const start = parseFloat(element.textContent) || 0;
  const diff = target - start;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    const current = start + diff * eased;
    element.textContent = current.toFixed(1);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

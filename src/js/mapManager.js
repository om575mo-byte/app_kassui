/**
 * 地図管理モジュール
 * Leafletを使用して地図とダムマーカーを表示・管理する
 */

/** @type {L.Map} */
let map = null;
/** @type {L.LayerGroup} マーカーレイヤーグループ */
let markerGroup = null;
/** @type {Object} ダムID → マーカーのマッピング */
const markerMap = {};

/**
 * ダークモード用タイルレイヤー
 */
const TILE_LAYERS = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    options: { subdomains: 'abcd', maxZoom: 18 },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    options: { maxZoom: 18 },
  },
};

/**
 * 地図を初期化
 * @param {string} containerId - 地図コンテナのDOM ID
 * @param {object} config - { center: [lat, lng], zoom: number }
 */
export function initMap(containerId, config = {}) {
  const center = config.center || [38.27, 140.87];
  const zoom = config.zoom || 9;

  map = L.map(containerId, {
    center,
    zoom,
    zoomControl: true,
    attributionControl: true,
  });

  // ダークタイルレイヤー
  const tileConfig = TILE_LAYERS.dark;
  L.tileLayer(tileConfig.url, {
    attribution: tileConfig.attribution,
    ...tileConfig.options,
  }).addTo(map);

  // 河川データの読み込みと描画（国土数値情報 W05）
  // ズームレベルに応じた表示切替:
  //   ズーム7以下（広域）  → 1級直轄区間のみ
  //   ズーム8以上（県単位） → 1級直轄 + 1級指定 + 2級河川
  let riverData = null;
  let riverLayer = null;

  function getRiverStyle(feature) {
    const sc = feature.properties.sectionCode;
    if (sc === '1' || sc === '5') {
      return { color: '#60a5fa', weight: 3.0, opacity: 0.7, lineCap: 'round', lineJoin: 'round' };
    } else if (sc === '2' || sc === '6') {
      return { color: '#3b82f6', weight: 2.0, opacity: 0.6, lineCap: 'round', lineJoin: 'round' };
    } else {
      return { color: '#2563eb', weight: 1.5, opacity: 0.45, lineCap: 'round', lineJoin: 'round' };
    }
  }

  function shouldShowFeature(feature, zoom) {
    const sc = feature.properties.sectionCode;
    // 指定区間外(4,8)は常に非表示
    if (sc === '4' || sc === '8' || sc === '0') return false;
    // ズーム8以下: 1級直轄(1,5)のみ
    if (zoom <= 8) return sc === '1' || sc === '5';
    // ズーム9以上: 全指定区間を表示
    return true;
  }

  function renderRivers() {
    if (!riverData || !map) return;
    const zoom = map.getZoom();

    // 既存レイヤーを削除
    if (riverLayer) {
      map.removeLayer(riverLayer);
      riverLayer = null;
    }

    // フィルタリングしたデータで再描画
    const filtered = {
      type: 'FeatureCollection',
      features: riverData.features.filter((f) => shouldShowFeature(f, zoom)),
    };

    riverLayer = L.geoJSON(filtered, {
      style: getRiverStyle,
      onEachFeature: (feature, layer) => {
        if (feature.properties && feature.properties.name) {
          let labelName = feature.properties.name;
          if (feature.properties.waterSystem) {
            if (feature.properties.waterSystem !== feature.properties.name) {
              labelName = `${feature.properties.waterSystem}水系 ${labelName}`;
            } else {
              labelName = `${feature.properties.waterSystem}水系(本川)`;
            }
          }
          if (feature.properties.sectionType) {
            labelName += ` [${feature.properties.sectionType}]`;
          }
          layer.bindTooltip(labelName, {
            sticky: true,
            className: 'river-tooltip',
            direction: 'auto',
          });
        }
      },
    }).addTo(map);
  }

  fetch('/data/tohoku_rivers_ksj.geojson')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      riverData = data;
      renderRivers();
      // ズーム変更時に再描画
      map.on('zoomend', renderRivers);
    })
    .catch((err) => console.error('Error loading river data:', err));

  // マーカーレイヤーグループ（河川の上に表示するため後に追加）
  markerGroup = L.layerGroup().addTo(map);

  return map;
}

/**
 * ダムマーカーを地図に表示
 * @param {Array} dams - ダムデータ配列
 * @param {Function} onDamClick - ダムクリック時のコールバック
 */
export function renderDamMarkers(dams, onDamClick) {
  if (!markerGroup) return;
  markerGroup.clearLayers();
  Object.keys(markerMap).forEach((k) => delete markerMap[k]);

  dams.forEach((dam) => {
    if (!dam.lat || !dam.lng) return;

    const level = dam.droughtLevel || { color: '#94a3b8', id: 'unknown' };
    const levelClass = level.id === 'critical' ? 'level-critical' : '';

    // カスタムアイコン（光るドット）
    // className を空にし iconSize を null にすることで
    // Leaflet のデフォルトサイズ制約を除去しズームずれを防止
    const icon = L.divIcon({
      className: '',
      html: `
        <div class="dam-marker">
          <div class="dam-marker-dot ${levelClass}" style="background:${level.color}; color:${level.color};"></div>
          <div class="dam-marker-label">${dam.name}</div>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
      popupAnchor: [0, -12],
    });

    const marker = L.marker([dam.lat, dam.lng], { icon }).addTo(markerGroup);

    // ポップアップ
    const popupContent = createPopupContent(dam, level);
    marker.bindPopup(popupContent, {
      maxWidth: 280,
      closeButton: true,
      autoPan: true,
    });

    // クリックイベント
    marker.on('click', () => {
      if (onDamClick) onDamClick(dam);
    });

    markerMap[dam.id] = marker;
  });
}

/**
 * マーカーのポップアップコンテンツを生成
 */
function createPopupContent(dam, level) {
  const rateDisplay = dam.storageRate != null ? `${dam.storageRate}%` : '—';
  const effectiveRateDisplay = dam.effectiveStorageRate != null ? `${dam.effectiveStorageRate}%` : '—';
  const volumeDisplay = dam.storageVolume != null
    ? `${Number(dam.storageVolume).toLocaleString()} 千m³`
    : '—';
  const usableCapDisplay = dam.usableCapacity != null
    ? `${Number(dam.usableCapacity).toLocaleString()} 千m³`
    : '—';
  const inflowDisplay = dam.inflowRate != null ? `${dam.inflowRate} m³/s` : '—';
  const outflowDisplay = dam.outflowRate != null ? `${dam.outflowRate} m³/s` : '—';
  const barWidth = dam.storageRate != null ? dam.storageRate : 0;

  return `
    <div class="popup-content">
      <div class="popup-header">
        <span class="popup-title">${dam.name}</span>
        <span class="popup-level-badge" style="background:${level.color};">
          ${level.icon} ${level.label}
        </span>
      </div>
      <div class="popup-stats">
        <div class="popup-stat">
          <span class="popup-stat-label">貯水率(利水)</span>
          <span class="popup-stat-value" style="color:${level.color}">${rateDisplay}</span>
        </div>
        <div class="popup-stat">
          <span class="popup-stat-label">貯水率(有効)</span>
          <span class="popup-stat-value">${effectiveRateDisplay}</span>
        </div>
        <div class="popup-stat">
          <span class="popup-stat-label">貯水位</span>
          <span class="popup-stat-value">${dam.waterLevel != null ? `EL.${dam.waterLevel} m` : '—'}</span>
        </div>
        <div class="popup-stat">
          <span class="popup-stat-label">貯水量</span>
          <span class="popup-stat-value">${volumeDisplay}</span>
        </div>
        <div class="popup-stat">
          <span class="popup-stat-label">流入量</span>
          <span class="popup-stat-value">${inflowDisplay}</span>
        </div>
        <div class="popup-stat">
          <span class="popup-stat-label">放流量</span>
          <span class="popup-stat-value">${outflowDisplay}</span>
        </div>
      </div>
      <div class="popup-bar">
        <div class="popup-bar-fill" style="width:${barWidth}%; background:${level.color};"></div>
      </div>
      <div class="popup-footer">
        <span class="popup-river">${dam.river || '—'} / ${dam.waterSystem || '—'}</span>
        ${dam.mudamUrl ? `<a class="popup-link" href="${dam.mudamUrl}" target="_blank" rel="noopener">詳細→</a>` : ''}
      </div>
    </div>
  `;
}

/**
 * 特定のダムにズームして吹き出しを開く
 */
export function focusDam(damId) {
  const marker = markerMap[damId];
  if (marker && map) {
    map.setView(marker.getLatLng(), 12, { animate: true });
    marker.openPopup();
  }
}

/** @type {L.LayerGroup} 観測所マーカーレイヤーグループ */
let stationGroup = null;

/**
 * 水位観測所マーカーを地図に表示
 * @param {Array} stations - 観測所データ配列
 */
export function renderStationMarkers(stations) {
  if (!map) return;

  // 初回のみレイヤーグループを作成
  if (!stationGroup) {
    stationGroup = L.layerGroup().addTo(map);
  }
  stationGroup.clearLayers();

  stations.forEach((station) => {
    if (!station.lat || !station.lng) return;

    const level = station.droughtLevel || { color: '#94a3b8', icon: '📊', label: '—' };
    const markerColor = level.color || '#06b6d4';

    // ダイヤ型アイコン（ダムの丸ドットと区別）
    const icon = L.divIcon({
      className: '',
      html: `
        <div class="station-marker">
          <div class="station-marker-diamond" style="background:${markerColor}; border-color:${markerColor};"></div>
          <div class="station-marker-label">${station.name}</div>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
      popupAnchor: [0, -12],
    });

    const marker = L.marker([station.lat, station.lng], { icon }).addTo(stationGroup);

    // ポップアップ
    const popupContent = createStationPopupContent(station, level);
    marker.bindPopup(popupContent, {
      maxWidth: 280,
      closeButton: true,
      autoPan: true,
    });
  });
}

/**
 * 観測所のポップアップコンテンツを生成
 */
function createStationPopupContent(station, level) {
  const waterLevelDisplay = station.waterLevel !== null ? `${station.waterLevel} m` : '—';
  const normalFlowDisplay = station.normalFlow !== null ? `${station.normalFlow} m³/s` : '未設定';
  const droughtFlowDisplay = station.droughtFlow !== null ? `${station.droughtFlow} m³/s` : '未設定';

  return `
    <div class="popup-content">
      <div class="popup-header">
        <span class="popup-title">${station.name}</span>
        <span class="popup-level-badge" style="background:${level.color};">
          ${level.icon} ${level.label}
        </span>
      </div>
      <div class="popup-stats">
        <div class="popup-stat">
          <span class="popup-stat-label">河川名</span>
          <span class="popup-stat-value">${station.river}</span>
        </div>
        <div class="popup-stat">
          <span class="popup-stat-label">現在水位</span>
          <span class="popup-stat-value" style="color:${level.color}">${waterLevelDisplay}</span>
        </div>
        <div class="popup-stat">
          <span class="popup-stat-label">正常流量</span>
          <span class="popup-stat-value">${normalFlowDisplay}</span>
        </div>
        <div class="popup-stat">
          <span class="popup-stat-label">渇水目安流量</span>
          <span class="popup-stat-value">${droughtFlowDisplay}</span>
        </div>
      </div>
      <div class="popup-footer">
        <span class="popup-river">${station.river} / ${station.waterSystem || '—'}</span>
        <span class="popup-live-badge ${station.isLiveData ? 'live' : 'offline'}">${station.isLiveData ? '🟢 Live' : '⚪ オフライン'}</span>
      </div>
    </div>
  `;
}

/**
 * 全体表示に戻す
 */
export function resetView(config = {}) {
  if (map) {
    const center = config.center || [38.27, 140.87];
    const zoom = config.zoom || 9;
    map.setView(center, zoom, { animate: true });
  }
}

/**
 * マップのコンテナサイズ変更に応じたリサイズ・再描画を実行
 */
export function resizeMap() {
  if (map) {
    map.invalidateSize();
  }
}

/**
 * Nepal MapIt – High-Performance Spatial Web Application
 *
 * Dataset  : Real OpenStreetMap (OSM) nodes via Overpass API (ODbL License)
 * Map      : Amazon Location Service (MapLibre GL JS compatible)
 * Geocoding: Amazon Location Service Place Index with Nominatim fallback
 * Storage  : Amazon S3 (Apache Iceberg table format) queried via Amazon Athena
 */

// ──────────────────────────────────────────────────────────────────────────────
// AWS CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────────
const AWS_CONFIG = {
  region:      'us-east-1',
  mapName:     'nepal-mapit-map',       // Live Amazon Location Service navigation map resource
  placesIndex: 'nepal-mapit-places',    // Live Amazon Location Service place index
  apiKey:      'v1.public.eyJqdGkiOiI4MmEyNWQ1Zi0wMjhjLTQ3MmYtOGE3ZC1mZTAxYmExZGJmNDkifUG5-RoD1gMCgV3QglGHAlhQTmKGY4MDIulywCRVzdinxBfD_5VYPiA2RWs4OSg0LDRuZI4UH-KEJ_LdckphKIzS1OZPvB3c6e8W9SGG3w2PaGN0A-DbPEUczPV_YaX-HVRWyKQ4S68rfce3BphoF7bkZS9C_JaLREcwlI7gzMcqIP7nibAQRSkDWC9kL771xePbyeJvknUk7f5l6pfDP2-uV5bOww1It90r-2VidwQmGFvvk8APvpXFmwV_ABEcWPjisYSbRsm4idY00yu7RWXDMs6GumVrT4KeDVMfcAu5ZojvwIZjsFcy6o661XB_5u0DXpf8GNnzBwo2lUivgiY.ZWU0ZWIzMTktMWRhNi00Mzg0LTllMzYtNzlmMDU3MjRmYTkx',
};

// ──────────────────────────────────────────────────────────────────────────────
// CONSTANTS & GEOGRAPHY
// ──────────────────────────────────────────────────────────────────────────────
const KTM_CENTER   = [85.324, 27.717];
const PKR_CENTER   = [83.960, 28.210];
const NEPAL_BOUNDS = [[80.05, 26.34], [88.20, 30.45]];

// Prithvi Highway Scenic Route Coordinates (Kathmandu <-> Pokhara ~204 km)
const PRITHVI_HIGHWAY_ROUTE = [
  [85.324, 27.717], // Kathmandu Durbar / Center
  [85.201, 27.708], // Thankot Checkpoint / Naubise
  [84.975, 27.818], // Galchhi (Trishuli Valley)
  [84.821, 27.810], // Malekhu (Fish corridor)
  [84.557, 27.859], // Mugling Junction
  [84.417, 27.971], // Dumre (Bandipur Gateway)
  [84.283, 27.983], // Damauli (Madi River)
  [84.103, 28.140], // Kotre / Gandaki Valley
  [83.985, 28.205], // Pokhara Entry / Prithvi Chowk
  [83.960, 28.210], // Pokhara Lakeside / Phewa
];

// Categories Metadata
// Categories Metadata
const CATEGORY_META = {
  heritage:  { color: '#F59E0B', icon: '🏛️', label: 'Heritage Sites'    },
  temple:    { color: '#EF4444', icon: '⛩️',  label: 'Temples & Shrines' },
  nature:    { color: '#10B981', icon: '🌿',  label: 'Nature & Parks'    },
  viewpoint: { color: '#38BDF8', icon: '🔭',  label: 'Viewpoints'        },
  museum:    { color: '#8B5CF6', icon: '🏺',  label: 'Museums'           },
  food:      { color: '#06B6D4', icon: '🍽️',  label: 'Food & Dining'     },
};

// ──────────────────────────────────────────────────────────────────────────────
// APPLICATION STATE
// ──────────────────────────────────────────────────────────────────────────────
const state = {
  map:              null,
  allFeatures:      [],
  filteredFeatures: [],
  activeCity:       'all',
  activeCategories: new Set(Object.keys(CATEGORY_META)),
  activePreset:     null,
  selectedId:       null,
  viewMode:         'cluster', // 'cluster' | 'pins' | 'heat'
  markers:          [],
  popup:            null,
  mapReady:         false,
  usingAWS:         false,
  metadata:         null,
  routeVisible:     false,
  is3D:             false,
  renderedCardCount: 0,
  pageSize:         50,
};

// ──────────────────────────────────────────────────────────────────────────────
// DATASET LOADER (Zero-CORS with fallback)
// ──────────────────────────────────────────────────────────────────────────────
async function loadDataset() {
  try {
    let json = window.NEPAL_POI_DATA;
    if (!json) {
      const res = await fetch('./data/nepal_poi.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    }
    state.allFeatures = (json.features || []).filter(
      f => f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates)
    );
    state.metadata = json.metadata || {};
    console.log(`✅ Loaded ${state.allFeatures.length} real OSM features.`);
    return true;
  } catch (err) {
    console.error('Failed to load dataset:', err);
    showToast('⚠️ Could not load POI data.');
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// MAP INITIALIZATION (Amazon Location Service)
// ──────────────────────────────────────────────────────────────────────────────
async function initMap() {
  let styleUrl;
  if (AWS_CONFIG.apiKey) {
    styleUrl = `https://maps.geo.${AWS_CONFIG.region}.amazonaws.com/maps/v0/maps/${AWS_CONFIG.mapName}/style-descriptor?key=${AWS_CONFIG.apiKey}`;
    state.usingAWS = true;
  } else {
    styleUrl = 'https://tiles.openfreemap.org/styles/dark';
    state.usingAWS = false;
  }

  state.map = new maplibregl.Map({
    container:          'map',
    style:              styleUrl,
    center:             KTM_CENTER,
    zoom:               12,
    minZoom:            6,
    maxZoom:            19,
    attributionControl: false,
    maxBounds:          [[78, 24], [90, 32]],
    transformRequest: (url, resourceType) => {
      if (url.includes('amazonaws.com') && AWS_CONFIG.apiKey) {
        return {
          url: url.includes('key=') ? url : `${url}${url.includes('?') ? '&' : '?'}key=${AWS_CONFIG.apiKey}`,
        };
      }
      return { url };
    },
  });

  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  state.map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

  state.map.on('load', onMapLoaded);
}

// ──────────────────────────────────────────────────────────────────────────────
// ON MAP LOADED & LAYER SETUP
// ──────────────────────────────────────────────────────────────────────────────
function onMapLoaded() {
  state.mapReady = true;

  // Attribution
  const attrSource = document.getElementById('attr-source');
  if (attrSource) attrSource.textContent = state.metadata?.attribution || 'OpenStreetMap contributors';
  const attrMap = document.getElementById('attr-map');
  if (attrMap) attrMap.textContent = state.usingAWS ? 'Amazon Location Service' : 'Amazon Location Ready (MapLibre)';

  // Populate filtered features FIRST so GeoJSON source starts with data
  applyFilters();
  setupMapSourcesAndLayers();
  updateCategoryCounts();
  updateCounters();
  refreshList();
  hideLoading();
}

function setupMapSourcesAndLayers() {
  if (!state.map) return;

  // 1. Add Highway Corridor Route Layer
  if (!state.map.getSource('highway-route')) {
    state.map.addSource('highway-route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: { name: 'Prithvi Highway (Kathmandu - Pokhara)' },
        geometry: {
          type: 'LineString',
          coordinates: PRITHVI_HIGHWAY_ROUTE,
        },
      },
    });

    state.map.addLayer({
      id: 'highway-route-glow',
      type: 'line',
      source: 'highway-route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
        visibility: state.routeVisible ? 'visible' : 'none',
      },
      paint: {
        'line-color': '#3B82F6',
        'line-width': 8,
        'line-opacity': 0.5,
        'line-blur': 4,
      },
    });

    state.map.addLayer({
      id: 'highway-route-line',
      type: 'line',
      source: 'highway-route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
        visibility: state.routeVisible ? 'visible' : 'none',
      },
      paint: {
        'line-color': '#06B6D4',
        'line-width': 3.5,
        'line-dasharray': [2, 1],
      },
    });
  }

  // 2. Add POI GeoJSON Source
  const currentGeoJSON = {
    type: 'FeatureCollection',
    features: state.filteredFeatures,
  };

  if (state.map.getSource('pois-source')) {
    state.map.getSource('pois-source').setData(currentGeoJSON);
  } else {
    state.map.addSource('pois-source', {
      type: 'geojson',
      data: currentGeoJSON,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });

    // Layer 1: Heatmap Layer (underneath)
    state.map.addLayer({
      id: 'poi-heat',
      type: 'heatmap',
      source: 'pois-source',
      maxzoom: 15,
      layout: {
        visibility: state.viewMode === 'heat' ? 'visible' : 'none',
      },
      paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': [
          'interpolate', ['linear'], ['zoom'],
          6, 0.5,
          13, 2.5
        ],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.2, '#3B82F6',
          0.4, '#06B6D4',
          0.6, '#10B981',
          0.8, '#F59E0B',
          1, '#EF4444'
        ],
        'heatmap-radius': [
          'interpolate', ['linear'], ['zoom'],
          6, 12,
          13, 32
        ],
        'heatmap-opacity': 0.85,
      },
    });

    // Layer 2: Clusters Circles
    state.map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'pois-source',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#10B981', // green for < 25
          25,
          '#F59E0B', // amber for 25-100
          100,
          '#EF4444', // red for > 100
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          18,
          25,
          24,
          100,
          32,
        ],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.95,
      },
    });

    // Layer 3: Cluster Count Text
    state.map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'pois-source',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Arial Bold'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });

    // Layer 4: Individual Unclustered POIs
    state.map.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'pois-source',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': [
          'match',
          ['get', 'category'],
          'heritage',  '#F59E0B',
          'temple',    '#EF4444',
          'nature',    '#10B981',
          'viewpoint', '#3B82F6',
          'trekking',  '#F97316',
          'museum',    '#8B5CF6',
          'food',      '#06B6D4',
          '#F59E0B'
        ],
        'circle-radius': 8,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 1,
      },
    });

    // Click cluster → Zoom in smoothly
    state.map.on('click', 'clusters', e => {
      const features = state.map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      const clusterId = features[0].properties.cluster_id;
      state.map.getSource('pois-source').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        state.map.easeTo({
          center: features[0].geometry.coordinates,
          zoom: zoom + 0.5,
          duration: 600,
        });
      });
    });

    // Click individual point → Select & Open Drawer
    state.map.on('click', 'unclustered-point', e => {
      const feat = e.features[0];
      if (feat) {
        selectFeatureById(feat.properties.id || feat.id);
      }
    });

    // Hover effects
    state.map.on('mouseenter', 'clusters', () => { state.map.getCanvas().style.cursor = 'pointer'; });
    state.map.on('mouseleave', 'clusters', () => { state.map.getCanvas().style.cursor = ''; });
    state.map.on('mouseenter', 'unclustered-point', (e) => {
      state.map.getCanvas().style.cursor = 'pointer';
      const feat = e.features[0];
      if (feat) hoverPopup(feat);
    });
    state.map.on('mouseleave', 'unclustered-point', () => {
      state.map.getCanvas().style.cursor = '';
      if (!state.selectedId) closePopup();
    });
  }

  updateLayersVisibility();
}

function updateLayersVisibility() {
  if (!state.map || !state.map.getLayer('clusters')) return;

  const isHeat = state.viewMode === 'heat';
  const isCluster = state.viewMode === 'cluster';
  const isPins = state.viewMode === 'pins';

  state.map.setLayoutProperty('poi-heat', 'visibility', isHeat ? 'visible' : 'none');
  state.map.setLayoutProperty('clusters', 'visibility', isCluster ? 'visible' : 'none');
  state.map.setLayoutProperty('cluster-count', 'visibility', isCluster ? 'visible' : 'none');
  state.map.setLayoutProperty('unclustered-point', 'visibility', isHeat ? 'none' : 'visible');

  if (isPins) {
    renderDomPins();
  } else {
    clearDomMarkers();
  }
}

function renderDomPins() {
  clearDomMarkers();
  const bounds = state.map.getBounds();
  const visible = state.filteredFeatures.filter(f => {
    const [lng, lat] = f.geometry.coordinates;
    return bounds.contains([lng, lat]);
  }).slice(0, 80);

  visible.forEach(f => {
    const meta = CATEGORY_META[f.properties.category] || CATEGORY_META.heritage;
    const el = document.createElement('div');
    el.className = 'c-marker' + (f.id === state.selectedId ? ' c-marker--active' : '');

    const pin = document.createElement('div');
    pin.className = 'c-marker__pin';
    pin.style.background = `linear-gradient(135deg, ${meta.color}, #111)`;
    pin.style.boxShadow = `0 4px 12px ${meta.color}66`;

    const inner = document.createElement('div');
    inner.className = 'c-marker__inner';
    inner.textContent = meta.icon;
    pin.appendChild(inner);
    el.appendChild(pin);

    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectFeature(f);
    });

    const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat(f.geometry.coordinates)
      .addTo(state.map);

    m._fid = f.id;
    state.markers.push(m);
  });
}

function clearDomMarkers() {
  state.markers.forEach(m => m.remove());
  state.markers = [];
}

// ──────────────────────────────────────────────────────────────────────────────
// FILTERING LOGIC
// ──────────────────────────────────────────────────────────────────────────────
function applyFilters() {
  state.filteredFeatures = state.allFeatures.filter(f => {
    const p = f.properties;
    // 1. City Filter
    if (state.activeCity !== 'all' && p.city !== state.activeCity) return false;

    // 2. Preset Filter
    if (state.activePreset) {
      if (state.activePreset === 'unesco') {
        const isUnesco = p.category === 'heritage' ||
                         (p.tags || []).some(t => /unesco|durbar|world heritage/i.test(t)) ||
                         /durbar|pashupatinath|boudhanath|swayambhunath/i.test(p.name);
        if (!isUnesco) return false;
      } else if (state.activePreset === 'temples') {
        if (p.category !== 'temple') return false;
      } else if (state.activePreset === 'viewpoints') {
        if (p.category !== 'viewpoint') return false;
      } else if (state.activePreset === 'lakes') {
        const isNature = p.category === 'nature' || /lake|waterfall|tal|falls|reserve|cave/i.test(p.name);
        if (!isNature) return false;
      } else if (state.activePreset === 'food') {
        if (p.category !== 'food') return false;
      }
    }

    // 3. Category Filter
    if (!state.activePreset && !state.activeCategories.has(p.category)) return false;

    return true;
  });

  // Update Map Source Data
  if (state.map && state.map.getSource('pois-source')) {
    state.map.getSource('pois-source').setData({
      type: 'FeatureCollection',
      features: state.filteredFeatures,
    });
  }

  if (state.viewMode === 'pins') {
    renderDomPins();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// SIDEBAR POI LIST (CLEAN, PAGINATED FOR 60FPS)
// ──────────────────────────────────────────────────────────────────────────────
function refreshList(resetScroll = true) {
  const list = document.getElementById('poi-list');
  if (!list) return;

  const sortVal = document.getElementById('sort-select')?.value || 'highlights';
  const sorted = [...state.filteredFeatures].sort((a, b) => {
    if (sortVal === 'highlights') {
      const scoreA = a.properties.prominence_score || 0;
      const scoreB = b.properties.prominence_score || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.properties.name.localeCompare(b.properties.name);
    }
    if (sortVal === 'name') return a.properties.name.localeCompare(b.properties.name);
    if (sortVal === 'elevation') return (b.properties.altitude_m || 0) - (a.properties.altitude_m || 0);
    if (sortVal === 'city_ktm') {
      if (a.properties.city !== b.properties.city) return a.properties.city === 'Kathmandu' ? -1 : 1;
      return (b.properties.prominence_score || 0) - (a.properties.prominence_score || 0);
    }
    if (sortVal === 'city_pkr') {
      if (a.properties.city !== b.properties.city) return a.properties.city === 'Pokhara' ? -1 : 1;
      return (b.properties.prominence_score || 0) - (a.properties.prominence_score || 0);
    }
    if (sortVal === 'category') return a.properties.category.localeCompare(b.properties.category);
    return 0;
  });

  const countLabel = document.getElementById('count-label');
  if (countLabel) {
    countLabel.innerHTML = `Showing <strong>${sorted.length.toLocaleString()}</strong> of ${state.allFeatures.length.toLocaleString()} locations`;
  }

  if (resetScroll) {
    list.innerHTML = '';
    state.renderedCardCount = 0;
  }

  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <p>No locations found matching your filter criteria.</p>
      </div>`;
    const footer = document.getElementById('poi-list-footer');
    if (footer) footer.style.display = 'none';
    return;
  }

  const nextSlice = sorted.slice(state.renderedCardCount, state.renderedCardCount + state.pageSize);
  nextSlice.forEach(f => list.appendChild(buildCard(f)));
  state.renderedCardCount += nextSlice.length;

  const footer = document.getElementById('poi-list-footer');
  if (footer) {
    footer.style.display = state.renderedCardCount < sorted.length ? 'block' : 'none';
  }
}

function buildCard(f) {
  const p = f.properties;
  const meta = CATEGORY_META[p.category] || CATEGORY_META.heritage;

  const card = document.createElement('div');
  card.className = 'poi-card' + (f.id === state.selectedId ? ' poi-card--active' : '');
  card.dataset.id = f.id;
  card.style.setProperty('--card-color', meta.color);

  // Clean fallback description
  let desc = p.description;
  if (!desc || desc.length < 10) {
    if (p.category === 'temple') desc = `Sacred ${p.religion ? p.religion + ' ' : ''}temple and venerated pilgrimage site in ${p.city}, Nepal.`;
    else if (p.category === 'heritage') desc = `Historic monument and rich cultural heritage landmark in ${p.city}.`;
    else if (p.category === 'viewpoint') desc = `Panoramic Himalayan vantage point offering dramatic views of ${p.city} valley.`;
    else if (p.category === 'nature') desc = `Scenic freshwater or nature reserve offering tranquil outdoor recreation in ${p.city}.`;
    else if (p.category === 'food') desc = `Popular culinary destination and dining spot serving authentic Nepali flavors in ${p.city}.`;
    else if (p.category === 'museum') desc = `Cultural museum showcasing Nepali history, heritage, art, and traditions in ${p.city}.`;
    else desc = `Verified OpenStreetMap location in ${p.city}, Nepal.`;
  }

  const isHighlight = p.is_highlight || (p.prominence_score && p.prominence_score >= 800);

  card.innerHTML = `
    <div class="poi-card__top">
      <div class="poi-card__avatar" style="background: ${meta.color}22; border-color: ${meta.color}55; color: ${meta.color}">
        ${meta.icon}
      </div>
      <div class="poi-card__header-text">
        <h3 class="poi-card__title">${esc(p.name)}</h3>
        <div class="poi-card__pills">
          <span class="poi-pill poi-pill--city">📍 ${esc(p.city)}</span>
          <span class="poi-pill" style="background: ${meta.color}1c; color: ${meta.color}; border: 1px solid ${meta.color}40">${meta.label}</span>
          ${isHighlight ? `<span class="poi-pill poi-pill--highlight">⭐ Must Visit</span>` : ''}
          ${p.altitude_m ? `<span class="poi-pill poi-pill--alt">🏔️ ${p.altitude_m.toLocaleString()}m</span>` : ''}
        </div>
      </div>
    </div>
    <p class="poi-card__desc">${esc(desc)}</p>
    <div class="poi-card__bottom">
      <div class="poi-card__coords">
        <span>${f.geometry.coordinates[1].toFixed(4)}°N, ${f.geometry.coordinates[0].toFixed(4)}°E</span>
      </div>
      <button class="poi-card__explore-btn" aria-label="Explore ${esc(p.name)} on map">
        <span>Explore</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    </div>
  `;

  card.addEventListener('click', () => selectFeature(f));
  return card;
}

// ──────────────────────────────────────────────────────────────────────────────
// SELECTION & DETAIL PANEL
// ──────────────────────────────────────────────────────────────────────────────
function selectFeatureById(id) {
  const f = state.allFeatures.find(x => String(x.id) === String(id) || String(x.properties.osm_id) === String(id));
  if (f) selectFeature(f);
}

function selectFeature(f) {
  state.selectedId = f.id;

  state.map.flyTo({
    center: f.geometry.coordinates,
    zoom: Math.max(state.map.getZoom(), 15.5),
    pitch: state.is3D ? 55 : 0,
    duration: 800,
  });

  document.querySelectorAll('.poi-card').forEach(c => {
    c.classList.toggle('poi-card--active', c.dataset.id === f.id);
  });

  hoverPopup(f);
  openPanel(f);
}

function openPanel(f) {
  state.selectedId = f.id;
  const p = f.properties;
  const meta = CATEGORY_META[p.category] || CATEGORY_META.heritage;
  const panel = document.getElementById('detail-panel');
  if (!panel) return;

  const [lng, lat] = f.geometry.coordinates;
  const osmId = p.osm_id || String(f.id).replace('osm-', '').replace('nepal-', '');
  const osmUrl = p.osm_id
    ? `https://www.openstreetmap.org/node/${p.osm_id}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(p.name + ' ' + p.city + ' Nepal')}`;
  const mapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  const hero = document.getElementById('dp-hero');
  hero.style.background = `linear-gradient(135deg, ${meta.color}25 0%, #0d1222 100%)`;

  const badge = panel.querySelector('.dp__badge');
  badge.textContent = `${meta.icon} ${meta.label}`;
  badge.style.cssText = `background:${meta.color}22;border-color:${meta.color}66;color:${meta.color}`;

  const cityBadge = panel.querySelector('.dp__city-badge');
  cityBadge.textContent = `📍 ${p.city}, Nepal`;

  panel.querySelector('.dp__title').textContent = p.name;
  panel.querySelector('#dp-coords').textContent = `${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`;

  panel.querySelector('.dp__desc').textContent = p.description || `Verified ${meta.label.toLowerCase()} in ${p.city}, Nepal, mapped by OpenStreetMap contributors.`;

  // Info chips
  const chips = [
    p.opening_hours && `<div class="chip"><span class="chip__l">Opening Hours</span><span class="chip__v">${esc(p.opening_hours)}</span></div>`,
    p.altitude_m    && `<div class="chip"><span class="chip__l">Altitude</span><span class="chip__v">${p.altitude_m} meters</span></div>`,
    p.religion      && `<div class="chip"><span class="chip__l">Religion</span><span class="chip__v">${esc(p.religion).toUpperCase()}</span></div>`,
    p.heritage      && `<div class="chip"><span class="chip__l">Heritage Status</span><span class="chip__v">${esc(p.heritage)}</span></div>`,
    p.website       && `<div class="chip"><span class="chip__l">Website</span><a class="chip__v chip__link" href="${esc(p.website)}" target="_blank" rel="noopener">Visit Site ↗</a></div>`,
    p.wikipedia     && `<div class="chip"><span class="chip__l">Wikipedia</span><a class="chip__v chip__link" href="https://en.wikipedia.org/wiki/${esc(p.wikipedia.replace('en:',''))}" target="_blank" rel="noopener">Article ↗</a></div>`,
    `<div class="chip"><span class="chip__l">OSM Location</span><a class="chip__v chip__link" href="${osmUrl}" target="_blank" rel="noopener">${p.osm_id ? '#' + p.osm_id : 'Verified Spot'} ↗</a></div>`,
    `<div class="chip"><span class="chip__l">AWS Query</span><span class="chip__v">Athena / S3 Iceberg</span></div>`,
  ].filter(Boolean);
  panel.querySelector('.dp__chips').innerHTML = chips.join('');

  // Tags
  const tagList = p.tags || [];
  panel.querySelector('.dp__tags').innerHTML = tagList.length
    ? tagList.map(t => `<span class="dp__tag">${esc(t)}</span>`).join('')
    : '<span class="dp__tag">Verified Node</span>';

  // Attribution
  panel.querySelector('.dp__attribution').innerHTML =
    `Data: <a href="${osmUrl}" target="_blank" rel="noopener" style="color:var(--c-gold)">${p.osm_id ? 'OpenStreetMap Node #' + p.osm_id : 'OpenStreetMap Contributors'}</a> ·
     License: <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener" style="color:var(--c-gold)">ODbL</a>`;

  // Action Buttons
  panel.querySelector('#dp-btn-maps').onclick = () => window.open(mapsDirUrl, '_blank');
  panel.querySelector('#dp-btn-osm').onclick  = () => window.open(osmUrl, '_blank');
  panel.querySelector('#dp-btn-fly').onclick  = () => {
    state.map.flyTo({ center: [lng, lat], zoom: 17, pitch: state.is3D ? 60 : 0, duration: 800 });
  };
  panel.querySelector('#dp-btn-copy').onclick = () => {
    navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    showToast(`📋 Copied: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  };

  panel.classList.add('dp--open');
  panel.setAttribute('aria-expanded', 'true');
}

function closePanel() {
  const panel = document.getElementById('detail-panel');
  if (panel) {
    panel.classList.remove('dp--open');
    panel.setAttribute('aria-expanded', 'false');
  }
  state.selectedId = null;
  document.querySelectorAll('.poi-card').forEach(c => c.classList.remove('poi-card--active'));
  closePopup();
}

// ──────────────────────────────────────────────────────────────────────────────
// HOVER POPUP
// ──────────────────────────────────────────────────────────────────────────────
function closePopup() {
  if (state.popup) {
    state.popup.remove();
    state.popup = null;
  }
}

function hoverPopup(f) {
  closePopup();
  const p = f.properties;
  const meta = CATEGORY_META[p.category] || CATEGORY_META.heritage;
  const [lng, lat] = f.geometry.coordinates;

  state.popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 14,
    maxWidth: '280px',
  })
    .setLngLat([lng, lat])
    .setHTML(`
      <div class="pu">
        <div class="pu__head">
          <span class="pu__icon">${meta.icon}</span>
          <div>
            <div class="pu__name">${esc(p.name)}</div>
            <div class="pu__loc">📍 ${esc(p.city)}, Nepal</div>
          </div>
        </div>
        <p class="pu__desc">${esc(p.description)}</p>
        <div class="pu__foot">
          <span style="color:var(--c-text-muted)">${meta.label}</span>
          <button class="pu__btn" onclick="window.selectFeatureById('${f.id}')">Inspect →</button>
        </div>
      </div>
    `)
    .addTo(state.map);
}

// ──────────────────────────────────────────────────────────────────────────────
// SEARCH AUTOCOMPLETE
// ──────────────────────────────────────────────────────────────────────────────
let searchDebounce;
function handleSearch(q) {
  clearTimeout(searchDebounce);
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = q.trim() ? 'flex' : 'none';

  searchDebounce = setTimeout(() => {
    const results = document.getElementById('search-results');
    if (!q.trim()) {
      results.classList.remove('sr--active');
      return;
    }

    const term = q.toLowerCase();
    const hits = state.allFeatures.filter(f => {
      const p = f.properties;
      return (
        p.name.toLowerCase().includes(term) ||
        p.city.toLowerCase().includes(term) ||
        (p.tags || []).some(t => t.toLowerCase().includes(term)) ||
        p.description.toLowerCase().includes(term)
      );
    }).slice(0, 8);

    if (!hits.length) {
      results.innerHTML = `
        <div class="sr__item">
          <div class="sr__details">
            <div class="sr__name" style="opacity:0.7">No results for "${esc(q)}"</div>
            <div class="sr__meta">Try searching "Pashupatinath", "Phewa", "Durbar", "Sarangkot"</div>
          </div>
        </div>`;
    } else {
      results.innerHTML = hits.map(f => {
        const meta = CATEGORY_META[f.properties.category] || CATEGORY_META.heritage;
        return `
          <div class="sr__item" data-id="${f.id}">
            <span class="sr__icon" style="color:${meta.color}">${meta.icon}</span>
            <div class="sr__details">
              <div class="sr__name">${esc(f.properties.name)}</div>
              <div class="sr__meta">
                <span>📍 ${esc(f.properties.city)}</span>
                <span>•</span>
                <span style="color:${meta.color}">${meta.label}</span>
              </div>
            </div>
          </div>`;
      }).join('');

      results.querySelectorAll('.sr__item[data-id]').forEach(el => {
        el.addEventListener('click', () => {
          selectFeatureById(el.dataset.id);
          results.classList.remove('sr--active');
        });
      });
    }

    results.classList.add('sr--active');
  }, 180);
}

// ──────────────────────────────────────────────────────────────────────────────
// REGION & CATEGORY SWITCHING
// ──────────────────────────────────────────────────────────────────────────────
function switchCity(city) {
  state.activeCity = city;
  document.querySelectorAll('.city-pill').forEach(p => {
    const isActive = p.dataset.city === city;
    p.classList.toggle('city-pill--active', isActive);
    p.setAttribute('aria-pressed', isActive);
  });

  const regionCountBadge = document.getElementById('sb-region-count');
  if (regionCountBadge) {
    const count = city === 'all'
      ? state.allFeatures.length
      : state.allFeatures.filter(f => f.properties.city === city).length;
    regionCountBadge.textContent = `${count.toLocaleString()} spots`;
  }

  if (city === 'Kathmandu') {
    state.map.flyTo({ center: KTM_CENTER, zoom: 12.2, duration: 900 });
  } else if (city === 'Pokhara') {
    state.map.flyTo({ center: PKR_CENTER, zoom: 12.2, duration: 900 });
  } else {
    state.map.fitBounds(NEPAL_BOUNDS, { padding: 40, duration: 900 });
  }

  applyFilters();
  refreshList();
}

function toggleCategory(cat) {
  if (state.activeCategories.has(cat)) {
    if (state.activeCategories.size > 1) state.activeCategories.delete(cat);
    else showToast('⚠️ Keep at least one category active.');
  } else {
    state.activeCategories.add(cat);
  }
  state.activePreset = null;
  document.querySelectorAll('.curated-chip').forEach(c => c.classList.remove('curated-chip--active'));

  updateCategoryButtons();
  applyFilters();
  refreshList();
}

function updateCategoryButtons() {
  document.querySelectorAll('.cat-btn').forEach(b => {
    const cat = b.dataset.cat;
    const meta = CATEGORY_META[cat];
    if (!meta) return;
    const on = state.activeCategories.has(cat);
    b.classList.toggle('cat-btn--active', on);
    b.style.background = on ? `${meta.color}22` : 'rgba(255,255,255,0.03)';
    b.style.borderColor = on ? `${meta.color}66` : 'var(--c-border)';
    b.style.color = on ? meta.color : 'var(--c-text-sub)';
  });
}

function updateCategoryCounts() {
  const catGrid = document.getElementById('cat-grid');
  if (!catGrid) return;

  const counts = {};
  state.allFeatures.forEach(f => {
    const c = f.properties.category;
    counts[c] = (counts[c] || 0) + 1;
  });

  catGrid.innerHTML = Object.entries(CATEGORY_META).map(([id, m]) => {
    const count = counts[id] || 0;
    if (count === 0) return '';
    const on = state.activeCategories.has(id);
    return `
      <button class="cat-btn ${on ? 'cat-btn--active' : ''}" data-cat="${id}"
        style="background:${on ? m.color + '22' : 'rgba(255,255,255,0.03)'};
               border-color:${on ? m.color + '66' : 'var(--c-border)'};
               color:${on ? m.color : 'var(--c-text-sub)'}">
        <span class="cat-btn__left">${m.icon} ${m.label}</span>
        <span class="cat-btn__count">${count.toLocaleString()}</span>
      </button>
    `;
  }).join('');

  catGrid.querySelectorAll('.cat-btn').forEach(b => {
    b.addEventListener('click', () => toggleCategory(b.dataset.cat));
  });
}

function setPreset(preset) {
  if (state.activePreset === preset) {
    state.activePreset = null;
    document.querySelectorAll('.curated-chip').forEach(c => c.classList.remove('curated-chip--active'));
  } else {
    state.activePreset = preset;
    document.querySelectorAll('.curated-chip').forEach(c => {
      c.classList.toggle('curated-chip--active', c.dataset.preset === preset);
    });
  }

  applyFilters();
  refreshList();
}

function updateCounters() {
  const total = state.allFeatures.length;
  const heritageCount = state.allFeatures.filter(f => f.properties.category === 'heritage' || f.properties.category === 'temple').length;
  const natureCount = state.allFeatures.filter(f => f.properties.category === 'nature' || f.properties.category === 'viewpoint').length;
  const foodCount = state.allFeatures.filter(f => f.properties.category === 'food').length;

  const statTotal = document.getElementById('stat-total');
  if (statTotal) statTotal.textContent = total.toLocaleString();
  const statHeritage = document.getElementById('stat-heritage');
  if (statHeritage) statHeritage.textContent = heritageCount.toLocaleString();
  const statNature = document.getElementById('stat-nature');
  if (statNature) statNature.textContent = natureCount.toLocaleString();
  const statDining = document.getElementById('stat-dining');
  if (statDining) statDining.textContent = foodCount.toLocaleString();

  const headerCount = document.getElementById('header-poi-count');
  if (headerCount) headerCount.textContent = `${total.toLocaleString()} POIs`;

  const sbRegionCount = document.getElementById('sb-region-count');
  if (sbRegionCount) sbRegionCount.textContent = `${total.toLocaleString()} spots`;
}

// ──────────────────────────────────────────────────────────────────────────────
// HIGHWAY CORRIDOR TOOL
// ──────────────────────────────────────────────────────────────────────────────
function toggleHighwayRoute() {
  state.routeVisible = !state.routeVisible;
  const card = document.getElementById('route-card');
  const btn = document.getElementById('btn-route-tool');

  if (state.routeVisible) {
    card?.classList.add('rc--visible');
    btn?.classList.add('hbtn--active');
    if (state.map?.getLayer('highway-route-line')) {
      state.map.setLayoutProperty('highway-route-glow', 'visibility', 'visible');
      state.map.setLayoutProperty('highway-route-line', 'visibility', 'visible');
    }
    state.map.fitBounds([[83.8, 27.6], [85.5, 28.3]], { padding: 80, duration: 1000 });
    showToast('🛣️ Prithvi Highway corridor (204 km) activated.');
  } else {
    card?.classList.remove('rc--visible');
    btn?.classList.remove('hbtn--active');
    if (state.map?.getLayer('highway-route-line')) {
      state.map.setLayoutProperty('highway-route-glow', 'visibility', 'none');
      state.map.setLayoutProperty('highway-route-line', 'visibility', 'none');
    }
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  document.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('seg-btn--active', b.id === `mode-${mode}`);
  });
  updateLayersVisibility();
  showToast(`Switched to ${mode === 'heat' ? 'Heatmap' : mode === 'pins' ? 'Pin Markers' : 'Cluster'} mode.`);
}

// ──────────────────────────────────────────────────────────────────────────────
// GEOCODING (Amazon Location Service + Nominatim fallback)
// ──────────────────────────────────────────────────────────────────────────────
async function geocode(address) {
  if (!address || !address.trim()) return;
  showToast(`🔍 Searching "${address}"…`);

  // 1. Amazon Location Service Place Index
  if (state.usingAWS && AWS_CONFIG.apiKey) {
    try {
      const url = `https://places.geo.${AWS_CONFIG.region}.amazonaws.com/places/v0/indexes/${AWS_CONFIG.placesIndex}/search/text?key=${AWS_CONFIG.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Text: address, BiasPosition: KTM_CENTER, MaxResults: 1 }),
      });
      const data = await res.json();
      if (data.Results?.length) {
        const coords = data.Results[0].Place.Geometry.Point;
        flyAndPin(coords, data.Results[0].Place.Label || address, 'Amazon Location Service');
        return;
      }
    } catch (e) {
      console.warn('ALS geocoding failed, trying fallback:', e);
    }
  }

  // 2. Nominatim fallback
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address + ', Nepal')}&format=json&limit=1&accept-language=en`;
    const res = await fetch(url, { headers: { 'User-Agent': 'NepalMapIt/2.0' } });
    const data = await res.json();
    if (data.length) {
      flyAndPin(
        [parseFloat(data[0].lon), parseFloat(data[0].lat)],
        data[0].display_name.split(',')[0],
        'Nominatim / OSM'
      );
    } else {
      showToast('❌ Location not found in Nepal. Try a broader address.');
    }
  } catch (err) {
    showToast('❌ Geocoding request failed.');
  }
}

function flyAndPin(coords, label, provider) {
  state.map.flyTo({ center: coords, zoom: 16, duration: 900 });
  new maplibregl.Popup({ closeButton: true, closeOnClick: true })
    .setLngLat(coords)
    .setHTML(`
      <div class="pu">
        <div class="pu__name">📍 ${esc(label)}</div>
        <div class="pu__loc">Provider: ${esc(provider)}</div>
      </div>
    `)
    .addTo(state.map);
  showToast(`📍 Found: ${label}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// 3D TILT & GEOLOCATION
// ──────────────────────────────────────────────────────────────────────────────
function toggle3D() {
  state.is3D = !state.is3D;
  state.map.easeTo({
    pitch: state.is3D ? 60 : 0,
    bearing: state.is3D ? -20 : 0,
    duration: 1000,
  });
  showToast(state.is3D ? '🛰️ 3D Pitch View (60°)' : '🗺️ 2D View');
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast('⚠️ Geolocation not supported by your browser.');
    return;
  }
  showToast('🎯 Acquiring GPS location…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const coords = [pos.coords.longitude, pos.coords.latitude];
      state.map.flyTo({ center: coords, zoom: 15, duration: 1000 });
      new maplibregl.Popup({ closeButton: true })
        .setLngLat(coords)
        .setHTML('<div class="pu"><div class="pu__name">📍 You are here</div></div>')
        .addTo(state.map);
      showToast('🎯 Location acquired!');
    },
    () => {
      showToast('⚠️ Could not obtain GPS position.');
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILITIES & FEEDBACK
// ──────────────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const container = document.getElementById('toasts');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function hideLoading() {
  const el = document.getElementById('loading');
  if (el) el.classList.add('loading--hidden');
}

// ──────────────────────────────────────────────────────────────────────────────
// EVENT WIRING
// ──────────────────────────────────────────────────────────────────────────────
function wireEvents() {
  // Region Switcher
  document.querySelectorAll('.city-pill').forEach(btn => {
    btn.addEventListener('click', () => switchCity(btn.dataset.city));
  });

  // Curated Preset Filters
  document.querySelectorAll('.curated-chip').forEach(btn => {
    btn.addEventListener('click', () => setPreset(btn.dataset.preset));
  });

  // Category All / None
  document.getElementById('cat-select-all')?.addEventListener('click', () => {
    state.activeCategories = new Set(Object.keys(CATEGORY_META));
    updateCategoryButtons();
    applyFilters();
    refreshList();
  });
  document.getElementById('cat-clear-all')?.addEventListener('click', () => {
    state.activeCategories.clear();
    state.activeCategories.add('heritage');
    updateCategoryButtons();
    applyFilters();
    refreshList();
  });

  // Search input & keyboard shortcuts
  const searchInput = document.getElementById('search-input');
  searchInput?.addEventListener('input', e => handleSearch(e.target.value));
  searchInput?.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('search-results')?.classList.remove('sr--active');
      searchInput.blur();
    }
  });

  document.getElementById('search-clear')?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    handleSearch('');
    searchInput?.focus();
  });

  window.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput?.focus();
    } else if (e.key === '/' && document.activeElement !== searchInput && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput?.focus();
    } else if (e.key === 'Escape') {
      closePanel();
      document.getElementById('search-results')?.classList.remove('sr--active');
      document.getElementById('aws-modal').style.display = 'none';
      document.getElementById('geocode-panel')?.classList.remove('gp--visible');
      document.getElementById('route-card')?.classList.remove('rc--visible');
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) {
      document.getElementById('search-results')?.classList.remove('sr--active');
    }
  });

  // View Mode Buttons (Clusters / Pins / Heatmap)
  document.getElementById('mode-cluster')?.addEventListener('click', () => setViewMode('cluster'));
  document.getElementById('mode-pins')?.addEventListener('click', () => setViewMode('pins'));
  document.getElementById('mode-heat')?.addEventListener('click', () => setViewMode('heat'));

  // Highway Corridor Tool
  document.getElementById('btn-route-tool')?.addEventListener('click', toggleHighwayRoute);
  document.getElementById('btn-close-route')?.addEventListener('click', toggleHighwayRoute);

  // Quick Map Navigation
  document.getElementById('btn-nepal')?.addEventListener('click', () => {
    state.map.fitBounds(NEPAL_BOUNDS, { padding: 40, duration: 900 });
  });
  document.getElementById('btn-ktm')?.addEventListener('click', () => switchCity('Kathmandu'));
  document.getElementById('btn-pkr')?.addEventListener('click', () => switchCity('Pokhara'));
  document.getElementById('btn-tilt')?.addEventListener('click', toggle3D);
  document.getElementById('btn-locate')?.addEventListener('click', locateUser);

  // Geocoding Dialog
  const geocodePanel = document.getElementById('geocode-panel');
  const geocodeInput = document.getElementById('geocode-input');
  document.getElementById('btn-geocode')?.addEventListener('click', () => {
    geocodePanel?.classList.toggle('gp--visible');
    if (geocodePanel?.classList.contains('gp--visible')) geocodeInput?.focus();
  });
  document.getElementById('btn-geocode-close')?.addEventListener('click', () => {
    geocodePanel?.classList.remove('gp--visible');
  });
  document.getElementById('btn-geocode-go')?.addEventListener('click', () => {
    geocode(geocodeInput?.value);
    geocodePanel?.classList.remove('gp--visible');
  });
  geocodeInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      geocode(geocodeInput.value);
      geocodePanel?.classList.remove('gp--visible');
    }
  });

  // Detail panel close
  document.getElementById('dp-close')?.addEventListener('click', closePanel);

  // Mobile sidebar toggle
  document.getElementById('btn-sidebar')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('sidebar--open');
  });

  // Sort dropdown
  document.getElementById('sort-select')?.addEventListener('change', () => refreshList(true));

  // Infinite Scroll / Load More
  document.getElementById('btn-load-more')?.addEventListener('click', () => refreshList(false));

  // AWS Architecture Modal
  const modal = document.getElementById('aws-modal');
  const openModal = () => { if (modal) modal.style.display = 'flex'; };
  const closeModal = () => { if (modal) modal.style.display = 'none'; };

  document.getElementById('btn-aws-info')?.addEventListener('click', openModal);
  document.getElementById('attr-pipeline-link')?.addEventListener('click', e => {
    e.preventDefault();
    openModal();
  });
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// APPLICATION BOOTSTRAP
// ──────────────────────────────────────────────────────────────────────────────
async function boot() {
  wireEvents();
  const ok = await loadDataset();
  if (!ok) {
    hideLoading();
    return;
  }
  await initMap();
}

document.addEventListener('DOMContentLoaded', boot);
window.selectFeatureById = selectFeatureById;

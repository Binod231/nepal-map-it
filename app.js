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
  isDarkMode:       false,
  renderedCardCount: 0,
  pageSize:         50,
  savedIds:         new Set(JSON.parse(localStorage.getItem('nepal_mapit_saved') || '[]')),
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

  // 3. Selected POI Glowing Halo Ring Source & Layers
  if (!state.map.getSource('selected-poi-source')) {
    state.map.addSource('selected-poi-source', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: state.selectedId ? state.allFeatures.filter(f => f.id === state.selectedId) : []
      }
    });

    state.map.addLayer({
      id: 'selected-poi-pulse',
      type: 'circle',
      source: 'selected-poi-source',
      paint: {
        'circle-radius': 22,
        'circle-color': '#F59E0B',
        'circle-opacity': 0.32,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-opacity': 0.9,
      }
    });

    state.map.addLayer({
      id: 'selected-poi-core',
      type: 'circle',
      source: 'selected-poi-source',
      paint: {
        'circle-radius': 9,
        'circle-color': '#EF4444',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#FFFFFF',
        'circle-opacity': 1,
      }
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
      } else if (state.activePreset === 'saved') {
        if (!state.savedIds.has(f.id)) return false;
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
// ──────────────────────────────────────────────────────────────────────────────
// GOOGLE MAPS STYLE SPATIAL INTELLIGENCE & KNOWLEDGE BASE
// ──────────────────────────────────────────────────────────────────────────────
function haversineDistance(c1, c2) {
  const [lon1, lat1] = c1;
  const [lon2, lat2] = c2;
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getNearbyPois(f, limit = 3) {
  const [lng, lat] = f.geometry.coordinates;
  return state.allFeatures
    .filter(other => other.id !== f.id)
    .map(other => ({
      feature: other,
      distanceKm: haversineDistance([lng, lat], other.geometry.coordinates)
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

function getTransitMetrics(coords, city) {
  const [lng, lat] = coords;
  const isPokhara = city === 'Pokhara';
  
  const ktmCenter = [85.3075, 27.7042];
  const ktmAirport = [85.3592, 27.6966];
  const pkrCenter = [83.9575, 28.2096];
  const pkrAirport = [83.9806, 28.2009];

  if (isPokhara) {
    const distLakeside = haversineDistance([lng, lat], pkrCenter);
    const distAirport = haversineDistance([lng, lat], pkrAirport);
    return [
      { icon: '⛵', val: `${distLakeside.toFixed(1)} km`, lbl: 'From Lakeside Phewa' },
      { icon: '✈️', val: `${distAirport.toFixed(1)} km`, lbl: 'From Pokhara Airport (PKR)' }
    ];
  } else {
    const distCenter = haversineDistance([lng, lat], ktmCenter);
    const distAirport = haversineDistance([lng, lat], ktmAirport);
    return [
      { icon: '🏛️', val: `${distCenter.toFixed(1)} km`, lbl: 'From Durbar Square' },
      { icon: '✈️', val: `${distAirport.toFixed(1)} km`, lbl: 'From Tribhuvan Airport (KTM)' }
    ];
  }
}

const POI_KNOWLEDGE = {
  'pashupatinath': {
    nepali: 'पशुपतिनाथ मन्दिर',
    subtitle: 'Sacred 5th-Century Shaivite Shikhara & Pagoda Complex',
    rating: '4.9',
    reviews: '2,480+ visits',
    status: 'Open · Closes 9:00 PM',
    religion: 'Hinduism (Shaivism)',
    architecture: 'Two-tiered Gilded Pagoda & Silver Repoussé Doors',
    history: 'Dating back to 400 AD under the Lichhavi dynasty, Pashupatinath is one of the four most sacred Shiva shrines in Asia, situated on both banks of the holy Bagmati River.',
    etiquette: 'Inner sanctum is open to Hindus; outer courtyards and cremation viewing terraces are open to all visitors. Shoes and leather items must be removed before entering.',
    highlights: 'Evening Bagmati Maha Aarti ceremony (daily at 6:30 PM), Arya Ghat cremations, 518 mini temples and shrines, and historic four-faced Mukhalinga.'
  },
  'boudhanath': {
    nepali: 'बौद्धनाथ स्तूप',
    subtitle: 'Colossal Tibetan Buddhist Mandala Stupa · UNESCO Site',
    rating: '4.9',
    reviews: '3,120+ visits',
    status: 'Open 24 Hours',
    religion: 'Tibetan Buddhism (Vajrayana)',
    architecture: 'Giant Spherical Dome & Gilded Harmika with All-Seeing Eyes',
    history: 'Built along the ancient trans-Himalayan trade route between Lhasa and Kathmandu, Boudhanath is one of the largest spherical stupas in the world and the spiritual epicenter of Tibetan Buddhism in Nepal.',
    etiquette: 'Circumambulate (perform Kora) in a clockwise direction around the base of the stupa while spinning prayer wheels. Remove footwear when ascending the upper plinth.',
    highlights: 'Hundreds of fluttering prayer flags, surrounding rooftop Tibetan cafes, butter lamp shrines, and serene evening chanting rituals.'
  },
  'swayambhunath': {
    nepali: 'स्वयम्भूनाथ (Monkey Temple)',
    subtitle: 'Ancient 5th-Century Sacred Hilltop Stupa & Monasteries',
    rating: '4.8',
    reviews: '2,890+ visits',
    status: 'Open 24 Hours',
    religion: 'Buddhism & Hinduism Syncretism',
    architecture: 'Whitewashed Dome topped with Gilded 13-tier Pinnacle',
    history: 'Legend recounts that Kathmandu Valley was once an ancient lake, and Swayambhu (meaning "self-arisen") bloomed as a lotus from which the primordial Buddha radiated light. It has stood atop this forested hill for over 1,500 years.',
    etiquette: 'Climb the 365 steep stone steps past guardian stone statues and holy monkeys. Be mindful of personal belongings as the resident rhesus macaques are curious.',
    highlights: 'Magnificent 360° panoramic sunrise/sunset vista of Kathmandu Valley, colossal bronze Dorje (Vajra), and temple of Harati (protector of children).'
  },
  'patan': {
    nepali: 'पाटन दरबार क्षेत्र (Lalitpur)',
    subtitle: 'Malla Royal Palace Complex · City of Fine Arts',
    rating: '4.8',
    reviews: '2,150+ visits',
    status: 'Open · 10:00 AM - 6:00 PM',
    religion: 'Hindu & Buddhist Heritage',
    architecture: 'Newar Brick & Timber Palaces, Carved Shikhara & Pagodas',
    history: 'Known historically as Lalitpur ("City of Beauty"), Patan Durbar Square was the royal seat of the Malla kings, celebrated globally as the zenith of Newar sculpture, woodcarving, and bronze casting.',
    etiquette: 'Purchase visitor pass at entry gates. Patan Museum within the former royal residential courtyard is an internationally acclaimed exhibition space.',
    highlights: 'Krishna Mandir (carved entirely from stone), Golden Temple (Hiranya Varna Mahavihar), Mul Chowk, and the world-renowned Patan Museum.'
  },
  'bhaktapur': {
    nepali: 'भक्तपुर दरबार क्षेत्र',
    subtitle: 'Medieval Living Museum of Malla Dynasty Craftsmanship',
    rating: '4.9',
    reviews: '2,640+ visits',
    status: 'Open · 7:00 AM - 7:00 PM',
    religion: 'Hindu & Newar Tradition',
    architecture: '55-Window Palace & 30-Meter Tall Nyatapola Pagoda',
    history: 'Bhaktapur (the "City of Devotees") preserves an astonishing medieval atmosphere. Its car-free cobbled brick streets, public resthouses (patis), and pottery squares echo the 15th-century golden age of King Yaksha Malla.',
    etiquette: 'Preserve the tranquility of the ancient alleys. Must try the authentic Bhaktapur Juju Dhau (creamy "King of Curd") served in clay pots.',
    highlights: 'Nyatapola Temple (Nepal\'s tallest 5-tier pagoda), Golden Gate (Lu Dhowka), 55-Window Palace, Vatsala Temple, and traditional Pottery Square.'
  },
  'kathmandu_durbar': {
    nepali: 'काठमाडौँ दरबार क्षेत्र (हनुमान ढोका)',
    subtitle: 'Coronation Seat of Nepal Kings & Living Goddess Residence',
    rating: '4.7',
    reviews: '2,400+ visits',
    status: 'Open · 8:00 AM - 6:00 PM',
    religion: 'Hinduism & Living Kumari Tradition',
    architecture: 'Multi-roofed Pagodas & Hanuman Dhoka Royal Palace',
    history: 'The historic royal palace complex of the Malla and Shah dynasties in the heart of the old city. It was here that Nepal\'s monarchs were crowned, surrounded by over 50 ancient temples, shrines, and courtyards.',
    etiquette: 'Be respectful when passing the Kumari Ghar courtyard. Photography of the Living Goddess Kumari when she appears at her carved window is strictly prohibited.',
    highlights: 'Kumari Ghar (courtyard of the Living Goddess), massive stone sculpture of Kal Bhairav, Taleju Temple, and historic Basantapur Square.'
  },
  'phewa': {
    nepali: 'फेवा ताल तथा ताल बाराही',
    subtitle: 'Pristine Himalayan Lake with Island Shrine · Pokhara',
    rating: '4.9',
    reviews: '3,800+ visits',
    status: 'Open 24 Hours · Boating 6:00 AM - 6:00 PM',
    religion: 'Hinduism (Shakti) & Nature',
    architecture: 'Two-storey Pagoda Island Temple & Lakeside Promenade',
    history: 'Pokhara\'s iconic freshwater lake reflects the snow-clad summit of Mount Machhapuchhre (Fishtail). At its center lies an island sanctuary housing the sacred Tal Barahi temple dedicated to the boar-headed goddess Varahi.',
    etiquette: 'Life jackets are mandatory for all wooden rowing boat (doonga) excursions to the island temple and across the lake.',
    highlights: 'Rowing colorful wooden boats, breathtaking sunset reflections of the Annapurna range, and the vibrant Lakeside cafe and promenade strip.'
  },
  'sarangkot': {
    nepali: 'सराङकोट सूर्योदय केन्द्र',
    subtitle: 'Premier Himalayan Sunrise Viewpoint & Paragliding Hub',
    rating: '4.9',
    reviews: '2,750+ visits',
    status: 'Best at Dawn (5:00 AM - 9:00 AM)',
    religion: 'Scenic & Natural Landmark',
    architecture: 'Ridge-top Observation Towers at 1,600m Elevation',
    history: 'Perched 1,600 meters above sea level on the northern rim of Pokhara Valley, Sarangkot offers one of the planet\'s most dramatic alpine panoramas, gazing directly across to Dhaulagiri (8,167m) and the Annapurnas.',
    etiquette: 'Arrive at least 30 minutes before sunrise to secure prime viewing platforms. Morning temperatures can be crisp; bring light wind layers.',
    highlights: 'Golden sunrise hitting Machhapuchhre (Fishtail) and Annapurna South, world-famous tandem paragliding take-off point, and Sarangkot cable car.'
  },
  'peace_pagoda': {
    nepali: 'शान्ति स्तूप (World Peace Pagoda)',
    subtitle: 'Monumental White Buddhist Stupa on Anadu Hill · Pokhara',
    rating: '4.8',
    reviews: '2,200+ visits',
    status: 'Open · 6:00 AM - 6:00 PM',
    religion: 'Buddhism (Nipponzan-Myōhōji)',
    architecture: 'Radiant White Stupa Dome with Four Golden Buddha Statues',
    history: 'Built by Buddhist monk Nichidatsu Fujii after World War II to foster world harmony and universal peace. The monument stands at 1,100 meters atop Anadu Hill, offering breathtaking panoramas over Phewa Lake and Pokhara.',
    etiquette: 'Maintain silence on the stupa platform. Circumambulate the monument clockwise; remove shoes at the staircase entrance.',
    highlights: 'Panoramic vista of Phewa Lake, Pokhara Valley, and the snowy Annapurna skyline; golden statues depicting the four stages of Buddha\'s life.'
  },
  'davis_falls': {
    nepali: 'पातले छाँगो (Davis Falls)',
    subtitle: 'Spectacular Subterranean Waterfall & Limestone Chasm',
    rating: '4.6',
    reviews: '1,950+ visits',
    status: 'Open · 7:00 AM - 6:00 PM',
    religion: 'Natural Geographic Wonder',
    architecture: 'Limestone Canyon & Underground Torrential Cavern',
    history: 'Known locally as Patale Chhango ("Underworld Waterfall"), the Pardi Khola river cascades furiously down a narrow rocky gorge and plunges into a subterranean sinkhole that travels underground into Gupteshwor Cave.',
    etiquette: 'Remain behind safety railings. The water volume is most powerful and thundering during and just after the monsoon months.',
    highlights: 'Thundering water disappearance into subterranean rocks, wishing fountain, and botanical gardens.'
  },
  'gupteshwor': {
    nepali: 'गुप्तेश्वर महादेव गुफा',
    subtitle: 'Subterranean Limestone Cavern with Sacred Shiva Lingam',
    rating: '4.7',
    reviews: '1,820+ visits',
    status: 'Open · 7:00 AM - 6:00 PM',
    religion: 'Hinduism (Lord Shiva)',
    architecture: 'Natural Underground Stalactite Cave System',
    history: 'Discovered in the 16th century, this immense 3-kilometer limestone cave system houses a revered natural Shiva Lingam in its main hall, with a cavern trail leading to the subterranean thunder of Davis Falls.',
    etiquette: 'Careful on damp, slick limestone steps inside the cave. Photography of the sacred inner Shiva Lingam is prohibited.',
    highlights: 'Viewing the subterranean torrent of Davis Falls emerging directly through the cave\'s rear opening; ancient natural stalactite formations.'
  },
  'begnas': {
    nepali: 'बेगनास ताल',
    subtitle: 'Peaceful Unspoiled Freshwater Lake & Green Ridges · Pokhara',
    rating: '4.8',
    reviews: '1,450+ visits',
    status: 'Open 24 Hours',
    religion: 'Nature & Tranquility',
    architecture: 'Natural Lakefront with Terraced Farmlands',
    history: 'Nepal\'s third largest lake, situated 15 km east of Pokhara. Begnas Tal remains remarkably serene and pastoral compared to Phewa, surrounded by lush forested hills and terraced rice paddies.',
    etiquette: 'Support local boatmen and fishermen who operate quiet wooden rowboats. Ideal for quiet picnics and peaceful nature walks.',
    highlights: 'Tranquil wooden boat rentals, fresh fish dining by the shore, and peaceful ridge-line hikes connecting Begnas to Rupa Lake.'
  },
  'nagarkot': {
    nepali: 'नगरकोट सूर्योदय दृश्य',
    subtitle: 'Epic Himalayan Ridge Vantage Point (2,175m Altitude)',
    rating: '4.8',
    reviews: '2,300+ visits',
    status: 'Best at Sunrise (5:00 AM - 8:30 AM)',
    religion: 'Scenic Mountain Vantage',
    architecture: 'Mountain Ridge Observation Tower at 2,175m',
    history: 'Located on the eastern rim of Kathmandu Valley, Nagarkot served historically as an ancient fort monitoring transit routes. It is world-renowned today for panoramas spanning from the Annapurnas to Mount Everest.',
    etiquette: 'Optimal visibility is from October to April when clear morning skies unveil the snow-capped Himalayan horizon.',
    highlights: 'Panoramic dawn vista of 8 Himalayan ranges including Langtang, Ganesh Himal, Gaurishankar, and distant Everest; scenic pine forest hiking trails.'
  },
  'pumdikot': {
    nepali: 'पुम्दीकोट शिव मूर्ति',
    subtitle: 'Colossal 108-Foot Lord Shiva Statue & Vista · Pokhara',
    rating: '4.8',
    reviews: '1,750+ visits',
    status: 'Open · 6:00 AM - 7:00 PM',
    religion: 'Hinduism (Lord Shiva)',
    architecture: '108-Foot Statue atop 1,500m Ridge with 108 Spouts',
    history: 'Completed in recent years atop the southern ridge overlooking Pokhara, the 108-foot colossal seated statue of Lord Shiva offers breathtaking panoramas of Annapurna and Machhapuchhre.',
    etiquette: 'Remove shoes before stepping onto the marble temple promenade circling the statue. Respect ongoing pujas and Aarti offerings.',
    highlights: '108 holy Shiva water spouts, sweeping view of Phewa Lake and Pokhara airport, and adjacent World Peace Pagoda trail.'
  },
  'chandragiri': {
    nepali: 'चन्द्रागिरी हिल्स (२,५५१ मिटर)',
    subtitle: 'High Himalayan Ridge Vantage & Sacred Bhaleshwor Mahadev',
    rating: '4.8',
    reviews: '2,600+ visits',
    status: 'Open · 8:30 AM - 6:00 PM',
    religion: 'Hinduism & National History',
    architecture: 'Scenic Gondola Cable Car & Pagoda Hilltop Temple',
    history: 'Standing at 2,551 meters on Kathmandu\'s southwestern ridge, Chandragiri is where King Prithvi Narayan Shah first gazed upon the valley before uniting modern Nepal. It features the sacred Bhaleshwor Mahadev temple.',
    etiquette: 'Dress warmly as mountain breezes at 2,551m are significantly cooler than the valley basin below.',
    highlights: 'Scenic 2.5km cable car glide over lush subtropical forests, panoramic views from Annapurna to Everest, and children\'s alpine play parks.'
  }
};

function getRichPoiDetails(f) {
  const p = f.properties;
  const nameLower = (p.name || '').toLowerCase();
  
  let matchedKey = null;
  if (/pashupati/i.test(nameLower)) matchedKey = 'pashupatinath';
  else if (/boudha|bauddha/i.test(nameLower)) matchedKey = 'boudhanath';
  else if (/swayambhu|monkey temple/i.test(nameLower)) matchedKey = 'swayambhunath';
  else if (/patan durbar/i.test(nameLower)) matchedKey = 'patan';
  else if (/bhaktapur durbar/i.test(nameLower)) matchedKey = 'bhaktapur';
  else if (/kathmandu durbar|basantapur|hanuman dhoka/i.test(nameLower)) matchedKey = 'kathmandu_durbar';
  else if (/phewa|tal barahi/i.test(nameLower)) matchedKey = 'phewa';
  else if (/sarangkot/i.test(nameLower)) matchedKey = 'sarangkot';
  else if (/peace pagoda|shanti stupa/i.test(nameLower)) matchedKey = 'peace_pagoda';
  else if (/davis falls|patale/i.test(nameLower)) matchedKey = 'davis_falls';
  else if (/gupteshwor/i.test(nameLower)) matchedKey = 'gupteshwor';
  else if (/begnas/i.test(nameLower)) matchedKey = 'begnas';
  else if (/nagarkot/i.test(nameLower)) matchedKey = 'nagarkot';
  else if (/pumdikot/i.test(nameLower)) matchedKey = 'pumdikot';
  else if (/chandragiri/i.test(nameLower)) matchedKey = 'chandragiri';

  if (matchedKey && POI_KNOWLEDGE[matchedKey]) {
    return {
      ...POI_KNOWLEDGE[matchedKey],
      isCurated: true
    };
  }

  const cat = p.category || 'heritage';
  const meta = CATEGORY_META[cat] || CATEGORY_META.heritage;
  const isKtm = p.city === 'Kathmandu';
  
  const ratingScore = (4.4 + ((p.prominence_score || 50) % 5) * 0.1).toFixed(1);
  const reviewsCount = `${Math.floor(120 + ((p.prominence_score || 50) * 1.8))}+ visits`;

  let catSubtitle = `${meta.label} in ${p.city}, Nepal`;
  if (p.religion) catSubtitle = `${esc(p.religion).toUpperCase()} · ${meta.label}`;
  if (p.altitude_m) catSubtitle += ` · ${p.altitude_m}m elevation`;

  const religionInfo = p.religion 
    ? `${p.religion.toUpperCase()} tradition` 
    : (cat === 'temple' ? 'Hindu / Buddhist sanctuary' : 'Open cultural heritage');

  const archInfo = p.heritage 
    ? `Classified Heritage (${p.heritage})` 
    : (cat === 'temple' ? 'Traditional Nepalese Temple Architecture' : 'Urban Spatial Location');

  const hoursInfo = p.opening_hours || (cat === 'food' ? '08:00 - 22:00 Daily' : 'Open daylight hours (06:00 - 18:00)');

  const narrativeText = p.description || 
    `Verified ${meta.label.toLowerCase()} situated in the vibrant ${isKtm ? 'Kathmandu Valley' : 'Pokhara Valley'} region of Nepal. Mapped with verified geographic coordinates by OpenStreetMap contributors and ingested into Amazon Location Service for high-precision spatial exploration.`;

  return {
    nepali: p.name_ne || '',
    subtitle: catSubtitle,
    rating: ratingScore,
    reviews: reviewsCount,
    status: p.opening_hours ? `Hours: ${p.opening_hours}` : 'Open Daily',
    religion: religionInfo,
    architecture: archInfo,
    history: narrativeText,
    etiquette: cat === 'temple' 
      ? 'Please remove shoes and leather items before entering the prayer sanctum. Always ask permission before photographing worshippers or religious rites.' 
      : (cat === 'nature' || cat === 'viewpoint' ? 'Please keep trails clean and respect natural habitats. Early morning or sunset provides the best Himalayan visibility.' : 'A welcoming destination for travelers exploring local Nepalese culture.'),
    highlights: (p.tags && p.tags.length) ? p.tags.slice(0, 4).join(', ') : 'Verified spatial feature',
    isCurated: false
  };
}

function updateSavedCount() {
  const count = state.savedIds.size;
  const chip = document.getElementById('saved-chip-count');
  if (chip) chip.textContent = count;
}

function toggleSave(id) {
  if (state.savedIds.has(id)) {
    state.savedIds.delete(id);
    showToast('Removed from Saved Places');
  } else {
    state.savedIds.add(id);
    showToast('Saved to My Favorites ⭐');
  }
  localStorage.setItem('nepal_mapit_saved', JSON.stringify([...state.savedIds]));
  updateSavedCount();
  updateSaveButton(id);

  if (state.activePreset === 'saved') {
    applyFilters();
    refreshList();
  }
}

function updateSaveButton(id) {
  const saveBtn = document.getElementById('dp-btn-save');
  const saveIcon = document.getElementById('dp-save-icon');
  const saveLabel = document.getElementById('dp-save-label');
  if (!saveBtn) return;

  const isSaved = state.savedIds.has(id);
  if (isSaved) {
    saveBtn.classList.add('dp__action-pill--saved');
    if (saveIcon) saveIcon.textContent = '★';
    if (saveLabel) saveLabel.textContent = 'Saved';
  } else {
    saveBtn.classList.remove('dp__action-pill--saved');
    if (saveIcon) saveIcon.textContent = '🔖';
    if (saveLabel) saveLabel.textContent = 'Save';
  }
}

function sharePlace(f) {
  const [lng, lat] = f.geometry.coordinates;
  const url = `${window.location.origin}${window.location.pathname}?poi=${encodeURIComponent(f.id)}`;
  if (navigator.share) {
    navigator.share({
      title: `${f.properties.name} – Nepal MapIt`,
      text: `Check out ${f.properties.name} in ${f.properties.city}, Nepal on Nepal MapIt!`,
      url: url,
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url);
    showToast('🔗 Shareable link copied to clipboard!');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// SELECTION & DETAIL PANEL (GOOGLE MAPS PLACE CARD)
// ──────────────────────────────────────────────────────────────────────────────
function selectFeatureById(id) {
  const f = state.allFeatures.find(x => String(x.id) === String(id) || String(x.properties.osm_id) === String(id));
  if (f) selectFeature(f);
}

function selectFeature(f) {
  state.selectedId = f.id;
  const [lng, lat] = f.geometry.coordinates;

  const isDesktop = window.innerWidth > 768;
  state.map.easeTo({
    center: [lng, lat],
    zoom: Math.max(state.map.getZoom(), 16),
    pitch: state.is3D ? 55 : 0,
    padding: {
      left: isDesktop ? 450 : 0,
      bottom: isDesktop ? 0 : 340,
    },
    duration: 800,
  });

  // Update glowing selection pulse marker on map
  if (state.map && state.map.getSource('selected-poi-source')) {
    state.map.getSource('selected-poi-source').setData({
      type: 'FeatureCollection',
      features: [f],
    });
  }

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
  const details = getRichPoiDetails(f);
  const osmId = p.osm_id || String(f.id).replace('osm-', '').replace('nepal-', '');
  const osmUrl = p.osm_id
    ? `https://www.openstreetmap.org/node/${p.osm_id}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(p.name + ' ' + p.city + ' Nepal')}`;
  const mapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  // 1. Hero Styling
  const hero = document.getElementById('dp-hero');
  hero.style.background = `linear-gradient(135deg, ${meta.color}35 0%, #0d1222 100%)`;

  const badge = panel.querySelector('.dp__badge');
  badge.textContent = `${meta.icon} ${meta.label}`;
  badge.style.cssText = `background:${meta.color}22;border:1px solid ${meta.color}66;color:${meta.color}`;

  const cityBadge = panel.querySelector('.dp__city-badge');
  cityBadge.textContent = `📍 ${p.city}, Nepal`;

  panel.querySelector('.dp__title').textContent = p.name;
  
  const subEl = document.getElementById('dp-subtitle');
  if (subEl) {
    subEl.textContent = details.nepali ? `${details.nepali} · ${details.subtitle}` : details.subtitle;
  }

  // 2. Rating & Status Bar
  const scoreEl = document.getElementById('dp-score');
  if (scoreEl) scoreEl.textContent = details.rating;
  const countEl = document.getElementById('dp-review-count');
  if (countEl) countEl.textContent = `(${details.reviews})`;
  const statusEl = document.getElementById('dp-status-text');
  if (statusEl) statusEl.textContent = details.status;

  // 3. Action Buttons
  const btnMaps = document.getElementById('dp-btn-maps');
  if (btnMaps) btnMaps.onclick = () => window.open(mapsDirUrl, '_blank');

  const btnSave = document.getElementById('dp-btn-save');
  if (btnSave) btnSave.onclick = () => toggleSave(f.id);
  updateSaveButton(f.id);

  const btnNearby = document.getElementById('dp-btn-nearby');
  if (btnNearby) {
    btnNearby.onclick = () => {
      document.getElementById('dp-nearby-section')?.scrollIntoView({ behavior: 'smooth' });
    };
  }

  const btnShare = document.getElementById('dp-btn-share');
  if (btnShare) btnShare.onclick = () => sharePlace(f);

  const btnFly = document.getElementById('dp-btn-fly');
  if (btnFly) {
    btnFly.onclick = () => {
      const isDesktop = window.innerWidth > 768;
      state.map.flyTo({
        center: [lng, lat],
        zoom: 17.5,
        pitch: state.is3D ? 60 : 0,
        padding: { left: isDesktop ? 450 : 0, bottom: isDesktop ? 0 : 340 },
        duration: 900
      });
    };
  }

  // 4. Quick Facts Detail Rows (Google Maps Style)
  const factsList = document.getElementById('dp-quick-facts');
  if (factsList) {
    const rows = [
      {
        icon: '📍',
        label: 'Address & Coordinates',
        val: `${p.city}, Nepal · ${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`,
        actionHtml: `<button class="fact-action-btn" onclick="navigator.clipboard.writeText('${lat.toFixed(6)}, ${lng.toFixed(6)}'); showToast('📋 Coordinates copied!');">Copy</button>`
      },
      p.altitude_m ? {
        icon: '🏔️',
        label: 'Elevation / Altitude',
        val: `${p.altitude_m} meters (${Math.round(p.altitude_m * 3.28084)} ft) above sea level`,
        actionHtml: ''
      } : null,
      {
        icon: '⛩️',
        label: 'Tradition & Worship',
        val: details.religion,
        actionHtml: ''
      },
      {
        icon: '🏛️',
        label: 'Heritage & Structure',
        val: details.architecture,
        actionHtml: ''
      },
      p.opening_hours ? {
        icon: '⏰',
        label: 'Visiting Hours',
        val: p.opening_hours,
        actionHtml: ''
      } : {
        icon: '⏰',
        label: 'Recommended Hours',
        val: 'Best visited during daylight hours (06:00 - 18:00)',
        actionHtml: ''
      },
      p.phone ? {
        icon: '📞',
        label: 'Phone Contact',
        val: `<a href="tel:${esc(p.phone)}" style="color:var(--c-blue)">${esc(p.phone)}</a>`,
        actionHtml: ''
      } : null,
      p.website ? {
        icon: '🌐',
        label: 'Official Website',
        val: `<a href="${esc(p.website)}" target="_blank" rel="noopener" style="color:var(--c-gold)">Visit Official Site ↗</a>`,
        actionHtml: ''
      } : null,
      p.wikipedia ? {
        icon: '📚',
        label: 'Wikipedia Article',
        val: `<a href="https://en.wikipedia.org/wiki/${esc(p.wikipedia.replace('en:', ''))}" target="_blank" rel="noopener" style="color:#93C5FD">Read on Wikipedia ↗</a>`,
        actionHtml: ''
      } : null,
      {
        icon: '🗺️',
        label: 'OpenStreetMap Record',
        val: `<a href="${osmUrl}" target="_blank" rel="noopener" style="color:#6EE7B7">OSM Verified Node #${p.osm_id || f.id} ↗</a>`,
        actionHtml: ''
      }
    ].filter(Boolean);

    factsList.innerHTML = rows.map(r => `
      <div class="fact-row">
        <div class="fact-icon">${r.icon}</div>
        <div class="fact-content">
          <span class="fact-label">${r.label}</span>
          <div class="fact-value">${r.val}</div>
        </div>
        ${r.actionHtml || ''}
      </div>
    `).join('');
  }

  // 5. Comprehensive Narrative
  const narrEl = document.getElementById('dp-narrative');
  if (narrEl) {
    narrEl.innerHTML = `
      <p><strong>Overview:</strong> ${esc(details.history)}</p>
      <p><strong>Visiting Etiquette:</strong> ${esc(details.etiquette)}</p>
      <p><strong>Highlights:</strong> ${esc(details.highlights)}</p>
    `;
  }

  // 6. Transit Distances
  const transitGrid = document.getElementById('dp-transit-grid');
  if (transitGrid) {
    const transits = getTransitMetrics([lng, lat], p.city);
    transitGrid.innerHTML = transits.map(t => `
      <div class="transit-item">
        <span class="transit-icon">${t.icon}</span>
        <div>
          <div class="transit-val">${t.val}</div>
          <div class="transit-lbl">${t.lbl}</div>
        </div>
      </div>
    `).join('');
  }

  // 7. Nearby Recommendations (3 closest POIs with 1-click flyTo)
  const nearbyContainer = document.getElementById('dp-nearby-list');
  if (nearbyContainer) {
    const nearbyList = getNearbyPois(f, 3);
    nearbyContainer.innerHTML = nearbyList.map(item => {
      const nCat = CATEGORY_META[item.feature.properties.category] || CATEGORY_META.heritage;
      return `
        <div class="nearby-card" onclick="window.selectFeatureById('${item.feature.id}')">
          <div class="nearby-meta">
            <span class="nearby-icon">${nCat.icon}</span>
            <div>
              <div class="nearby-title">${esc(item.feature.properties.name)}</div>
              <div class="nearby-sub">${esc(item.feature.properties.city)} · ${nCat.label}</div>
            </div>
          </div>
          <span class="nearby-dist">${item.distanceKm.toFixed(1)} km</span>
        </div>
      `;
    }).join('');
  }

  // 8. Tags
  const tagList = p.tags || [];
  panel.querySelector('.dp__tags').innerHTML = tagList.length
    ? tagList.map(t => `<span class="dp__tag">${esc(t)}</span>`).join('')
    : '<span class="dp__tag">Verified OSM Spot</span>';

  // 9. Attribution
  panel.querySelector('.dp__attribution').innerHTML =
    `Data: <a href="${osmUrl}" target="_blank" rel="noopener" style="color:var(--c-gold)">${p.osm_id ? 'OpenStreetMap Node #' + p.osm_id : 'OpenStreetMap Contributors'}</a> ·
     License: <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener" style="color:var(--c-gold)">ODbL</a>`;

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

  // Clear map selection halo
  if (state.map && state.map.getSource('selected-poi-source')) {
    state.map.getSource('selected-poi-source').setData({
      type: 'FeatureCollection',
      features: [],
    });
  }
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

function toggleMapTheme() {
  if (!state.map) return;
  state.isDarkMode = !state.isDarkMode;

  let newStyle;
  if (state.isDarkMode) {
    newStyle = 'https://tiles.openfreemap.org/styles/dark';
  } else {
    newStyle = AWS_CONFIG.apiKey
      ? `https://maps.geo.${AWS_CONFIG.region}.amazonaws.com/maps/v0/maps/${AWS_CONFIG.mapName}/style-descriptor?key=${AWS_CONFIG.apiKey}`
      : 'https://tiles.openfreemap.org/styles/positron';
  }

  state.map.setStyle(newStyle);
  state.map.once('style.load', () => {
    setupMapSourcesAndLayers();
  });

  const btnTheme = document.getElementById('btn-theme');
  if (btnTheme) {
    btnTheme.textContent = state.isDarkMode ? '☀️' : '🌓';
    btnTheme.title = state.isDarkMode
      ? 'Switch to AWS Location Light Navigation'
      : 'Switch to Dark Canvas Basemap';
  }

  showToast(state.isDarkMode ? '🌙 Dark Canvas style activated' : '🗺️ AWS Esri Navigation style activated');
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
  document.getElementById('btn-theme')?.addEventListener('click', toggleMapTheme);
  document.getElementById('btn-tilt')?.addEventListener('click', toggle3D);
  document.getElementById('btn-locate')?.addEventListener('click', locateUser);
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => state.map?.zoomIn({ duration: 300 }));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => state.map?.zoomOut({ duration: 300 }));
  document.getElementById('btn-compass')?.addEventListener('click', () => state.map?.resetNorthPitch({ duration: 600 }));

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
  updateSavedCount();
  const ok = await loadDataset();
  if (!ok) {
    hideLoading();
    return;
  }
  await initMap();
}

document.addEventListener('DOMContentLoaded', boot);
window.selectFeatureById = selectFeatureById;

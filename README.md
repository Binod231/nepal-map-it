# 🗺️ Nepal MapIt

> **An interactive map explorer for Nepal's most iconic destinations** — built with Amazon Location Service, MapLibre GL JS, and a curated open tourism dataset.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-AWS%20CloudFront-orange?logo=amazon-aws)](https://drohapn4pfg6d.cloudfront.net)
[![S3 Website](https://img.shields.io/badge/S3%20Website-Live%20Endpoint-blue?logo=amazons3)](http://nepal-mapit-848175179383.s3-website-us-east-1.amazonaws.com)
[![AWS Location](https://img.shields.io/badge/AWS-Amazon%20Location%20Service-orange?logo=amazon-aws)](https://aws.amazon.com/location/)
[![MapLibre](https://img.shields.io/badge/Map-MapLibre%20GL%20JS-blue)](https://maplibre.org/)
[![Dataset](https://img.shields.io/badge/Dataset-2%2C821%20Real%20POIs-green)](./data/nepal_poi.json)

---

## 🎯 What It Is

Nepal MapIt places **2,876+ real Points of Interest** across Kathmandu Valley and Pokhara on an interactive, explorable map. Users can:

- 🏛️ Explore **UNESCO World Heritage Sites** (Pashupatinath, Boudhanath, Swayambhunath, Patan, Bhaktapur & Kathmandu Durbar Squares)
- ⛩️ Discover **thousands of temples and shrines** across Kathmandu and Pokhara
- 🔭 Find the best **viewpoints** for Himalayan sunrises (Nagarkot, Sarangkot, World Peace Pagoda)
- 🌿 Locate **nature spots**: Phewa Lake, Begnas Lake, Davis Falls, Gupteshwor Cave, Shivapuri
- 🍽️ Browse authentic **food and dining hotspots** like Thamel and Lakeside Pokhara
- 🏺 Visit **cultural museums** and historical landmarks
- 📍 **Geocode any Nepal address** via Amazon Location Service (with Nominatim fallback)

---

## 📊 The Real Dataset

**Source**: Real spatial data queried from **OpenStreetMap (OSM)** via the Overpass API (ODbL License). No mock data is used.

| Metric / Field | Detail |
|----------------|--------|
| **Total Features** | **2,876 Real Points of Interest** |
| **Regions Covered** | Kathmandu Valley (Kathmandu, Lalitpur, Bhaktapur) & Pokhara Valley |
| **Categories** | Heritage Sites, Temples & Shrines, Nature & Parks, Viewpoints, Museums, Food & Dining |
| **Attributes** | Coordinates, English & Local Names, Descriptions, Wikipedia/Wikidata Links, Religious Denominations, Heritage status, Tags |
| **Fetcher Script** | [`fetch_real_data.py`](./fetch_real_data.py) — automated Overpass API ingestion pipeline |
| **Files** | [`data/nepal_poi.json`](./data/nepal_poi.json) & [`data/nepal_poi.js`](./data/nepal_poi.js) |

### Production Data Pipeline (AWS Architecture)

```
OpenStreetMap (Overpass API)
    ↓
fetch_real_data.py
    ↓
Amazon S3 (s3://nepal-mapit-data/ -- Apache Iceberg table format)
    ↓
Amazon Athena (Serverless SQL analytics on Iceberg)
    ↓
Amazon Location Service (Map Tiles + Place Index Geocoding)
    ↓
Frontend Explorer (MapLibre GL JS on S3 / Amplify)
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Nepal MapIt Frontend                │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │   Sidebar    │  │  MapLibre GL │  │  Detail   │  │
│  │  Filters +   │  │     Map      │  │   Panel   │  │
│  │  POI List    │  │   + Markers  │  │           │  │
│  └──────────────┘  └──────┬───────┘  └───────────┘  │
└─────────────────────────── │ ────────────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │    Amazon Location Service      │
              │  ┌───────────┐ ┌─────────────┐ │
              │  │  Maps API │ │ Places Index│ │
              │  │ (Tiles)   │ │ (Geocoding) │ │
              │  └───────────┘ └─────────────┘ │
              └────────────────────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │            Amazon S3            │
              │   nepal_poi.json (Iceberg)      │
              │   (production data store)       │
              └────────────────────────────────┘
```

---

## ✨ Features

### Map Features
- 🎯 **Custom category markers** — Color-coded pins with emoji icons per category
- 🗺️ **Route visualization** — Dashed polylines for trekking routes with glow effects
- 💬 **Hover popups** — Quick info on hover: name, rating, city, description snippet
- 🖱️ **Click to explore** — Click any marker or route to open the detail panel
- ✈️ **Animated fly-to** — Smooth camera animation when selecting a location

### Filtering & Search
- 🏙️ **City toggle** — Switch between Kathmandu, Pokhara, or both
- 📂 **Category filters** — Toggle any of 7 categories on/off
- 🔍 **Full-text search** — Searches across name, description, city, and tags
- ⭐ **Sort** — By rating, reviews count, or alphabetically

### AWS Integration
- 📍 **Amazon Location Service** — Base map tiles + geocoding Place Index
- 🔑 **API Key auth** — Zero-backend browser-side auth using ALS API Keys
- ☁️ **S3 + Iceberg ready** — Data pipeline architecture documented
- 🔄 **Graceful fallback** — Uses OpenFreeMap tiles if ALS not configured

---

## 🚀 Quick Start

### Prerequisites
- Python 3 (or Node.js for `npx serve`)

### 1. Clone & Serve
```bash
git clone https://github.com/binodprasadjoshi/map-it
cd map-it
python3 -m http.server 8080
# Open: http://localhost:8080
```

### 2. Configure Amazon Location Service (Optional but Recommended)

1. Create an **Amazon Location Service** Map resource named `nepal-mapit-map` (use the "Esri Light" or "HERE Explore" style)
2. Create a **Place Index** named `nepal-mapit-places` (Esri or HERE data provider)
3. Create an **API Key** with permissions for Maps + Places
4. Edit [`app.js`](./app.js) and set:

```js
const AWS_CONFIG = {
  region:      'us-east-1',
  mapName:     'nepal-mapit-map',
  placesIndex: 'nepal-mapit-places',
  apiKey:      'YOUR_API_KEY_HERE',
};
```

5. Refresh — the map will now use Amazon Location Service tiles + geocoding!

### 3. Deploy to AWS (Production)

**Option A: Amazon S3 Static Website Hosting**
```bash
aws s3 sync . s3://your-bucket-name/ --exclude ".git/*" --acl public-read
aws s3 website s3://your-bucket-name/ --index-document index.html
```

**Option B: AWS Amplify (Recommended)**
```bash
npm install -g @aws-amplify/cli
amplify init
amplify add hosting
amplify publish
```

---

## 📦 Project Structure

```
map-it/
├── index.html          # Main HTML shell (semantic, accessible)
├── style.css           # Dark-mode design system (CSS Variables + animations)
├── app.js              # Application logic (map, filters, search, geocoding)
├── data/
│   ├── nepal_poi.json  # Curated GeoJSON dataset (2,821 real POIs)
│   └── nepal_poi.js    # Zero-CORS offline-ready dataset bundle
├── fetch_real_data.py  # Automated Overpass API ingestion pipeline
├── package.json        # Dev scripts & dependencies
└── README.md           # Documentation & Architecture Guide
```

---

## 🔧 AWS Services Used

| Service | Role |
|---------|------|
| **Amazon Location Service** | Interactive map tiles + geocoding (Place Index) |
| **Amazon S3** | Static website hosting + data storage |
| **Apache Iceberg on S3** | Production table format for POI data |
| **Amazon Athena** | SQL queries over S3/Iceberg data |



## 📝 License

MIT License — free to use, modify, and reuse. See [LICENSE](./LICENSE).

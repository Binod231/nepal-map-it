#!/usr/bin/env python3
"""
fetch_real_data.py  v2
======================
Fetches REAL location data from Overpass API (OpenStreetMap, ODbL license).
Covers: Kathmandu Valley + Pokhara Valley, Nepal.

Usage:  python3 fetch_real_data.py
Output: data/nepal_poi.json   (GeoJSON FeatureCollection)
"""

import urllib.request
import urllib.parse
import json, time, sys, os

OVERPASS = "https://overpass-api.de/api/interpreter"
HEADERS  = {"User-Agent": "NepalMapIt/2.0 (open-source hackathon; contact=github/binodprasadjoshi)"}

# ── category inference ───────────────────────────────────────────────────────
def infer_category(tags):
    h   = tags.get("historic", "")
    t   = tags.get("tourism", "")
    a   = tags.get("amenity", "")
    n   = tags.get("natural", "")
    rel = tags.get("religion", "")
    lei = tags.get("leisure", "")
    hrt = tags.get("heritage", "")

    if hrt or h in ("heritage", "archaeological_site", "monument", "ruins"):
        return "heritage"
    if a == "place_of_worship" or h == "temple":
        return "temple"
    if t == "viewpoint":
        return "viewpoint"
    if t == "museum":
        return "museum"
    if n in ("peak", "waterfall", "water") or lei in ("park", "nature_reserve"):
        return "nature"
    if a in ("restaurant", "cafe", "fast_food"):
        return "food"
    if t == "attraction":
        return "heritage"
    return "heritage"

def build_name(tags):
    for k in ("name:en", "name", "official_name", "alt_name"):
        v = tags.get(k, "").strip()
        if v and len(v) > 1:
            return v
    return None

def build_description(tags, cat):
    if tags.get("description"):
        return tags["description"][:500]
    rel = tags.get("religion", "")
    denom = tags.get("denomination", "")
    nat = tags.get("natural", "")
    cuisine = tags.get("cuisine", "")
    descmap = {
        "heritage": f"A historic heritage site in Nepal.{' Religion: ' + rel if rel else ''}",
        "temple":   f"A {'Buddhist' if rel == 'buddhist' else 'Hindu'} {denom + ' ' if denom else ''}temple or shrine in Nepal.",
        "viewpoint": "A scenic viewpoint offering panoramic views of Nepal's landscape and Himalayan peaks.",
        "museum":   "A museum or cultural institution in Nepal.",
        "nature":   f"A natural {'waterfall' if nat == 'waterfall' else 'lake' if nat == 'water' else 'peak' if nat == 'peak' else 'area'} in Nepal.",
        "food":     f"A {'restaurant' if tags.get('amenity') == 'restaurant' else 'café'}{' serving ' + cuisine if cuisine else ''} in Nepal.",
    }
    return descmap.get(cat, "A point of interest in Nepal.")

def extract_tags(tags):
    result = []
    for k in ("historic", "tourism", "natural", "leisure", "heritage",
              "religion", "denomination", "cuisine", "sport", "artwork_type"):
        v = tags.get(k, "")
        if v and v not in ("yes", "no", ""):
            result.append(v.replace("_", " ").title())
    if tags.get("heritage") or tags.get("wikidata"):
        if "UNESCO" not in result:
            pass  # only add if actually UNESCO
    if tags.get("wikidata"):
        result.append(f"Wikidata")
    return list(dict.fromkeys(result))[:6]

# ── single combined query per region ────────────────────────────────────────
def run_query(city, s, w, n, e):
    """Run one consolidated Overpass query for the bounding box."""
    ql = f"""
[out:json][timeout:90];
(
  node["tourism"="attraction"]({s},{w},{n},{e});
  node["tourism"="viewpoint"]({s},{w},{n},{e});
  node["tourism"="museum"]({s},{w},{n},{e});
  node["amenity"="place_of_worship"]["religion"="hindu"]({s},{w},{n},{e});
  node["amenity"="place_of_worship"]["religion"="buddhist"]({s},{w},{n},{e});
  node["historic"="temple"]({s},{w},{n},{e});
  node["historic"="monument"]({s},{w},{n},{e});
  node["historic"="archaeological_site"]({s},{w},{n},{e});
  node["historic"="ruins"]({s},{w},{n},{e});
  node["heritage"]({s},{w},{n},{e});
  node["natural"="peak"]({s},{w},{n},{e});
  node["natural"="waterfall"]({s},{w},{n},{e});
  node["natural"="water"]["water"="lake"]({s},{w},{n},{e});
  node["leisure"="park"]({s},{w},{n},{e});
  node["amenity"="restaurant"]["cuisine"]({s},{w},{n},{e});
  node["amenity"="cafe"]["name"]({s},{w},{n},{e});
);
out body;
""".strip()

    print(f"  Querying Overpass for {city}…", flush=True)
    data = urllib.parse.urlencode({"data": ql}).encode("utf-8")
    req  = urllib.request.Request(OVERPASS, data=data, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
        result = json.loads(raw)
        elems  = result.get("elements", [])
        print(f"  ✔  {len(elems)} raw nodes returned", flush=True)
        return elems
    except Exception as ex:
        print(f"  ✗ Error: {ex}", file=sys.stderr)
        return []

# ── process elements into GeoJSON features ───────────────────────────────────
def process(city, elements):
    features = []
    seen = set()
    for el in elements:
        if el.get("type") != "node":
            continue
        oid = el["id"]
        if oid in seen:
            continue
        seen.add(oid)

        tags = el.get("tags", {})
        lat, lon = el.get("lat"), el.get("lon")
        if lat is None or lon is None:
            continue

        name = build_name(tags)
        if not name:
            continue

        cat  = infer_category(tags)
        desc = build_description(tags, cat)
        kws  = extract_tags(tags)

        features.append({
            "id": f"osm-{oid}",
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "name":          name,
                "city":          city,
                "category":      cat,
                "osm_id":        oid,
                "description":   desc,
                "opening_hours": tags.get("opening_hours", ""),
                "website":       tags.get("website", tags.get("url", "")),
                "phone":         tags.get("phone", tags.get("contact:phone", "")),
                "wikipedia":     tags.get("wikipedia", ""),
                "wikidata":      tags.get("wikidata", ""),
                "altitude_m":    (int(float(tags["ele"])) if tags.get("ele") else None),
                "tags":          kws,
                "source":        "OpenStreetMap contributors",
                "license":       "ODbL – https://opendatacommons.org/licenses/odbl/",
            },
        })
    print(f"  → {len(features)} named features kept for {city}", flush=True)
    return features

# ── regions ──────────────────────────────────────────────────────────────────
REGIONS = [
    # city,         south,  west,   north,  east
    ("Kathmandu",  27.60,  85.20,  27.80,  85.46),
    ("Pokhara",    28.15,  83.85,  28.30,  84.10),
]

def main():
    all_features = []
    for (city, s, w, n, e) in REGIONS:
        print(f"\n{'='*50}\nCity: {city}\n{'='*50}")
        elems = run_query(city, s, w, n, e)
        feats = process(city, elems)
        all_features.extend(feats)
        if city != REGIONS[-1][0]:
            print("  Sleeping 3s to be polite to Overpass…")
            time.sleep(3)

    print(f"\n{'='*50}")
    print(f"Total features: {len(all_features)}")

    # Category breakdown
    from collections import Counter
    cats = Counter(f["properties"]["category"] for f in all_features)
    for cat, cnt in sorted(cats.items()):
        print(f"  {cat:12s}: {cnt}")

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "nepal_poi.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "name":            "Nepal POI Dataset – Kathmandu & Pokhara",
            "description":     "Real points of interest fetched from OpenStreetMap via Overpass API. Covers heritage sites, temples, shrines, viewpoints, nature, museums, restaurants across Kathmandu Valley and Pokhara.",
            "source":          "OpenStreetMap contributors",
            "license":         "Open Database License (ODbL) – https://opendatacommons.org/licenses/odbl/",
            "attribution":     "© OpenStreetMap contributors",
            "overpass_query":  "https://overpass-api.de/api/interpreter",
            "fetched_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_features":  len(all_features),
            "cities":          [r[0] for r in REGIONS],
        },
        "features": all_features,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    out_js_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "nepal_poi.js")
    with open(out_js_path, "w", encoding="utf-8") as f:
        f.write("window.NEPAL_POI_DATA = ")
        json.dump(geojson, f, ensure_ascii=False)
        f.write(";\n")

    size_kb = os.path.getsize(out_path) // 1024
    print(f"\n✅ Saved → {out_path}  ({size_kb} KB)")
    print(f"✅ Saved → {out_js_path}")

if __name__ == "__main__":
    main()

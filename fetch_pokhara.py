#!/usr/bin/env python3
"""
fetch_pokhara.py  – retry just Pokhara and merge into existing dataset
"""
import urllib.request, urllib.parse, json, time, sys, os

OVERPASS = "https://overpass-api.de/api/interpreter"
HEADERS  = {"User-Agent": "NepalMapIt/2.0 (hackathon; binodprasadjoshi@github)"}

def infer_category(tags):
    h=tags.get("historic",""); t=tags.get("tourism",""); a=tags.get("amenity","")
    n=tags.get("natural",""); lei=tags.get("leisure",""); hrt=tags.get("heritage","")
    if hrt or h in ("heritage","archaeological_site","monument","ruins"): return "heritage"
    if a=="place_of_worship" or h=="temple": return "temple"
    if t=="viewpoint": return "viewpoint"
    if t=="museum":    return "museum"
    if n in ("peak","waterfall","water") or lei in ("park","nature_reserve"): return "nature"
    if a in ("restaurant","cafe","fast_food"): return "food"
    if t=="attraction": return "heritage"
    return "heritage"

def build_name(tags):
    for k in ("name:en","name","official_name","alt_name"):
        v=tags.get(k,"").strip()
        if v and len(v)>1: return v
    return None

def build_description(tags, cat):
    if tags.get("description"): return tags["description"][:500]
    rel=tags.get("religion",""); denom=tags.get("denomination","")
    nat=tags.get("natural",""); cuisine=tags.get("cuisine","")
    return {
        "heritage":  f"A historic heritage site in Nepal.{' Religion: '+rel if rel else ''}",
        "temple":    f"A {'Buddhist' if rel=='buddhist' else 'Hindu'} {denom+' ' if denom else ''}temple or shrine in Nepal.",
        "viewpoint": "A scenic viewpoint with panoramic views over Nepal's landscape and Himalayan peaks.",
        "museum":    "A museum or cultural institution in Nepal.",
        "nature":    f"A natural {'waterfall' if nat=='waterfall' else 'lake' if nat=='water' else 'peak' if nat=='peak' else 'area'} in Nepal.",
        "food":      f"A {'restaurant' if tags.get('amenity')=='restaurant' else 'café'}{' serving '+cuisine if cuisine else ''} in Nepal.",
    }.get(cat, "A point of interest in Nepal.")

def extract_tags(tags):
    r=[]
    for k in ("historic","tourism","natural","leisure","heritage","religion","denomination","cuisine"):
        v=tags.get(k,"")
        if v and v not in ("yes","no",""): r.append(v.replace("_"," ").title())
    return list(dict.fromkeys(r))[:6]

def run_query(s,w,n,e, attempt=1):
    ql=f"""
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
    data=urllib.parse.urlencode({"data":ql}).encode("utf-8")
    req=urllib.request.Request(OVERPASS,data=data,headers=HEADERS)
    try:
        with urllib.request.urlopen(req,timeout=120) as resp:
            raw=resp.read()
        elems=json.loads(raw).get("elements",[])
        print(f"  ✔ {len(elems)} nodes (attempt {attempt})")
        return elems
    except Exception as ex:
        if attempt < 4:
            wait=10*attempt
            print(f"  Retry in {wait}s… ({ex})")
            time.sleep(wait)
            return run_query(s,w,n,e, attempt+1)
        print(f"  ✗ Failed: {ex}", file=sys.stderr)
        return []

def process(city, elements):
    features=[]; seen=set()
    for el in elements:
        if el.get("type")!="node": continue
        oid=el["id"]
        if oid in seen: continue
        seen.add(oid)
        tags=el.get("tags",{}); lat=el.get("lat"); lon=el.get("lon")
        if lat is None or lon is None: continue
        name=build_name(tags)
        if not name: continue
        cat=infer_category(tags)
        features.append({
            "id": f"osm-{oid}", "type":"Feature",
            "geometry":{"type":"Point","coordinates":[round(lon,6),round(lat,6)]},
            "properties":{
                "name":name,"city":city,"category":cat,
                "osm_id":oid,"description":build_description(tags,cat),
                "opening_hours":tags.get("opening_hours",""),
                "website":tags.get("website",tags.get("url","")),
                "phone":tags.get("phone",""),
                "wikipedia":tags.get("wikipedia",""),
                "wikidata":tags.get("wikidata",""),
                "altitude_m":(int(float(tags["ele"])) if tags.get("ele") else None),
                "tags":extract_tags(tags),
                "source":"OpenStreetMap contributors",
                "license":"ODbL – https://opendatacommons.org/licenses/odbl/",
            }
        })
    print(f"  → {len(features)} named features for {city}")
    return features

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "nepal_poi.json")

# Load existing
with open(out_path, encoding="utf-8") as f:
    existing = json.load(f)
existing_ids = {feat["id"] for feat in existing["features"]}
print(f"Existing features: {len(existing['features'])}")

# Fetch Pokhara
print("\nFetching Pokhara (28.15,83.85,28.30,84.10)…")
elems = run_query(28.15, 83.85, 28.30, 84.10)
pkr_feats = process("Pokhara", elems)

# Merge
new_feats = [f for f in pkr_feats if f["id"] not in existing_ids]
print(f"\nNew Pokhara features to add: {len(new_feats)}")
existing["features"].extend(new_feats)
existing["metadata"]["total_features"] = len(existing["features"])
existing["metadata"]["fetched_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

from collections import Counter
cats = Counter(f["properties"]["category"] for f in existing["features"])
print("\nCategory breakdown:")
for cat, cnt in sorted(cats.items()):
    print(f"  {cat:12s}: {cnt}")

with open(out_path,"w",encoding="utf-8") as f:
    json.dump(existing,f,ensure_ascii=False,indent=2)
print(f"\n✅ Saved → {out_path}  ({os.path.getsize(out_path)//1024} KB)")
print(f"   Total features: {len(existing['features'])}")

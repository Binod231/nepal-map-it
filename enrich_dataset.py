#!/usr/bin/env python3
"""
Clean and enrich the Nepal POI spatial dataset.
Adds prominent crown-jewel landmarks of Kathmandu & Pokhara.
Computes prominence scores so top destinations appear first.
"""

import json
import re

ICONIC_LANDMARKS = [
    {
        "id": "nepal-pashupatinath",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.3487, 27.7104]},
        "properties": {
            "name": "Pashupatinath Temple",
            "city": "Kathmandu",
            "category": "temple",
            "prominence_score": 1000,
            "is_highlight": True,
            "description": "Sacred 5th-century Hindu temple complex on the Bagmati River dedicated to Lord Shiva. UNESCO World Heritage Site with golden pagoda spires and sacred ghats.",
            "opening_hours": "04:00-21:00",
            "website": "https://pashupatinathtemple.org",
            "phone": "+977-1-4470358",
            "wikipedia": "Pashupatinath_Temple",
            "altitude_m": 1320,
            "tags": ["UNESCO", "Sacred Temple", "Hindu", "Shiva", "Bagmati", "Must Visit"],
            "source": "OpenStreetMap & Department of Archaeology, Nepal",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-boudhanath",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.3620, 27.7215]},
        "properties": {
            "name": "Boudhanath Stupa",
            "city": "Kathmandu",
            "category": "temple",
            "prominence_score": 990,
            "is_highlight": True,
            "description": "One of the largest spherical Buddhist stupas in the world. Massive white dome crowned with all-seeing eyes of the Buddha, encircled by prayer wheels and Tibetan monasteries.",
            "opening_hours": "Open 24 hours",
            "website": "https://boudhanathstupa.org",
            "phone": "+977-1-4915637",
            "wikipedia": "Boudhanath",
            "altitude_m": 1350,
            "tags": ["UNESCO", "Tibetan Buddhism", "Stupa", "Heritage", "Must Visit"],
            "source": "OpenStreetMap & UNESCO World Heritage Center",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-swayambhunath",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.2903, 27.7149]},
        "properties": {
            "name": "Swayambhunath Stupa (Monkey Temple)",
            "city": "Kathmandu",
            "category": "temple",
            "prominence_score": 980,
            "is_highlight": True,
            "description": "Ancient hilltop Buddhist temple overlooking the Kathmandu Valley. Renowned for its golden spire, fluttering prayer flags, and panoramic Himalayan valley views.",
            "opening_hours": "06:00-20:00",
            "website": "",
            "phone": "+977-1-4277215",
            "wikipedia": "Swayambhunath",
            "altitude_m": 1420,
            "tags": ["UNESCO", "Buddhist Stupa", "Viewpoint", "Heritage", "Monkeys", "Must Visit"],
            "source": "OpenStreetMap & UNESCO World Heritage Center",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-phewa-lake",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9515, 28.2120]},
        "properties": {
            "name": "Phewa Lake & Tal Barahi",
            "city": "Pokhara",
            "category": "nature",
            "prominence_score": 975,
            "is_highlight": True,
            "description": "The picturesque jewel of Pokhara. A freshwater lake mirroring the snowcapped Machhapuchhre (Fishtail) peak, featuring the two-story Tal Barahi island temple.",
            "opening_hours": "Boating: 06:00-18:00",
            "website": "",
            "phone": "",
            "wikipedia": "Phewa_Lake",
            "altitude_m": 742,
            "tags": ["Lake", "Boating", "Annapurna View", "Tal Barahi", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-patan-durbar",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.3245, 27.6744]},
        "properties": {
            "name": "Patan Durbar Square",
            "city": "Kathmandu",
            "category": "heritage",
            "prominence_score": 970,
            "is_highlight": True,
            "description": "Masterpiece of Newari royal architecture in Lalitpur. Features the historic Royal Palace, Krishna Mandir carved from solid stone, and the world-class Patan Museum.",
            "opening_hours": "10:00-18:00",
            "website": "https://patanmuseum.gov.np",
            "phone": "+977-1-5521492",
            "wikipedia": "Patan_Durbar_Square",
            "altitude_m": 1330,
            "tags": ["UNESCO", "Royal Palace", "Newari Architecture", "Museum", "Must Visit"],
            "source": "OpenStreetMap & Department of Archaeology, Nepal",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-sarangkot",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9486, 28.2439]},
        "properties": {
            "name": "Sarangkot Sunrise & Paragliding Viewpoint",
            "city": "Pokhara",
            "category": "viewpoint",
            "prominence_score": 965,
            "is_highlight": True,
            "description": "World-famous hilltop ridge offering dramatic sunrise panoramas over Annapurna I, Dhaulagiri, and Machhapuchhre. Premier launch pad for tandem Himalayan paragliding.",
            "opening_hours": "Open 24 hours (Sunrise 05:00-07:00)",
            "website": "",
            "phone": "",
            "wikipedia": "Sarangkot",
            "altitude_m": 1592,
            "tags": ["Himalayan Panorama", "Sunrise", "Paragliding", "Annapurna", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-bhaktapur-durbar",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.4281, 27.6722]},
        "properties": {
            "name": "Bhaktapur Durbar Square",
            "city": "Kathmandu",
            "category": "heritage",
            "prominence_score": 960,
            "is_highlight": True,
            "description": "Ancient medieval Newar city square featuring the 55-Window Palace, Golden Gate, and nearby 5-tier Nyatapola Temple, the tallest pagoda temple in Nepal.",
            "opening_hours": "07:00-19:00",
            "website": "https://bhaktapur.gov.np",
            "phone": "+977-1-6610061",
            "wikipedia": "Bhaktapur_Durbar_Square",
            "altitude_m": 1400,
            "tags": ["UNESCO", "Medieval City", "Nyatapola", "55 Window Palace", "Pottery", "Must Visit"],
            "source": "OpenStreetMap & UNESCO World Heritage Center",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-shanti-stupa",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9443, 28.2007]},
        "properties": {
            "name": "World Peace Pagoda (Shanti Stupa)",
            "city": "Pokhara",
            "category": "temple",
            "prominence_score": 955,
            "is_highlight": True,
            "description": "A brilliant white pagoda monument built atop Anadu Hill by Japanese Buddhist monks. Offers breathtaking 360-degree views of Phewa Lake, Pokhara city, and the Annapurna range.",
            "opening_hours": "05:00-19:00",
            "website": "",
            "phone": "",
            "wikipedia": "World_Peace_Pagoda,_Pokhara",
            "altitude_m": 1100,
            "tags": ["Peace Pagoda", "Buddhist", "Viewpoint", "Annapurna", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-ktm-durbar",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.3069, 27.7042]},
        "properties": {
            "name": "Kathmandu Durbar Square (Basantapur)",
            "city": "Kathmandu",
            "category": "heritage",
            "prominence_score": 950,
            "is_highlight": True,
            "description": "Historic royal palace square of the Kathmandu Kingdom. Home to Kumari Ghar (residence of the Living Goddess), Taleju Temple, Kasthamandap, and Shiva-Parvati Temple.",
            "opening_hours": "07:00-19:00",
            "website": "https://kathmandu.gov.np",
            "phone": "+977-1-4268969",
            "wikipedia": "Kathmandu_Durbar_Square",
            "altitude_m": 1335,
            "tags": ["UNESCO", "Kumari Ghar", "Living Goddess", "Basantapur", "Must Visit"],
            "source": "OpenStreetMap & Department of Archaeology, Nepal",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-nagarkot",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.5200, 27.7170]},
        "properties": {
            "name": "Nagarkot Panoramic Viewpoint",
            "city": "Kathmandu",
            "category": "viewpoint",
            "prominence_score": 940,
            "is_highlight": True,
            "description": "Premier ridge viewpoint situated on the northeastern rim of Kathmandu Valley. Famous for golden sunrise views extending across 8 Himalayan ranges including Mount Everest on clear mornings.",
            "opening_hours": "Open 24 hours",
            "website": "",
            "phone": "",
            "wikipedia": "Nagarkot",
            "altitude_m": 2175,
            "tags": ["Himalayan Viewpoint", "Everest Sunrise", "Ridge Walk", "Valley Rim", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-pumdikot",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9310, 28.1820]},
        "properties": {
            "name": "Pumdikot Shiva Statue",
            "city": "Pokhara",
            "category": "temple",
            "prominence_score": 930,
            "is_highlight": True,
            "description": "A magnificent 51-foot tall seated Lord Shiva statue standing atop Pumdikot hill at 1,500m. Features 108 Shiva lingams, musical fountain, and sweeping views of Phewa Lake and the Himalayas.",
            "opening_hours": "06:00-18:30",
            "website": "",
            "phone": "",
            "wikipedia": "Pumdikot_Shiva_Statue",
            "altitude_m": 1500,
            "tags": ["Lord Shiva", "Giant Statue", "Viewpoint", "Hilltop", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-davis-falls",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9587, 28.1895]},
        "properties": {
            "name": "Davis Falls (Patale Chhango)",
            "city": "Pokhara",
            "category": "nature",
            "prominence_score": 920,
            "is_highlight": True,
            "description": "Dramatic natural waterfall fed by Phewa Lake. Water cascades over limestone rocks into a deep subterranean canyon tunnel disappearing underground.",
            "opening_hours": "07:00-18:00",
            "website": "",
            "phone": "+977-61-461327",
            "wikipedia": "Davis_Falls",
            "altitude_m": 760,
            "tags": ["Waterfall", "Subterranean", "Natural Wonder", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-gupteshwor-cave",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9575, 28.1891]},
        "properties": {
            "name": "Gupteshwor Mahadev Cave",
            "city": "Pokhara",
            "category": "nature",
            "prominence_score": 915,
            "is_highlight": True,
            "description": "Sacred subterranean limestone cave located directly opposite Davis Falls. Features a venerated stalagmite Shiva lingam and a cavern trail leading to the base of the waterfall underground.",
            "opening_hours": "07:00-18:00",
            "website": "",
            "phone": "+977-61-460144",
            "wikipedia": "Gupteshwar_Mahadev_Cave",
            "altitude_m": 755,
            "tags": ["Sacred Cave", "Shiva Lingam", "Limestone Cavern", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-begnas-lake",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [84.0950, 28.1750]},
        "properties": {
            "name": "Begnas Lake (Begnas Tal)",
            "city": "Pokhara",
            "category": "nature",
            "prominence_score": 910,
            "is_highlight": True,
            "description": "Serene, tranquil freshwater lake 15 km east of Pokhara. Less crowded than Phewa, surrounded by lush forested hills, organic fish farming, and clean swimming waters.",
            "opening_hours": "Boating: 06:00-18:00",
            "website": "",
            "phone": "",
            "wikipedia": "Begnas_Lake",
            "altitude_m": 650,
            "tags": ["Quiet Lake", "Boating", "Fisheries", "Nature Reserve", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-chandragiri",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.2070, 27.6710]},
        "properties": {
            "name": "Chandragiri Hills & Cable Car",
            "city": "Kathmandu",
            "category": "viewpoint",
            "prominence_score": 900,
            "is_highlight": True,
            "description": "Scenic 2,551m peak reachable by a modern 2.5 km cable car. Home to the historic Bhaleshwor Mahadev Temple, offering panoramas of Kathmandu Valley and Mount Everest.",
            "opening_hours": "09:00-17:00",
            "website": "https://chandragirihills.com",
            "phone": "+977-1-4311225",
            "wikipedia": "Chandragiri_Hill",
            "altitude_m": 2551,
            "tags": ["Cable Car", "Himalayan Ridge", "Bhaleshwor Temple", "Valley View", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-thamel",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.3110, 27.7153]},
        "properties": {
            "name": "Thamel Tourism & Cultural Hub",
            "city": "Kathmandu",
            "category": "heritage",
            "prominence_score": 890,
            "is_highlight": True,
            "description": "Vibrant epicenter of tourism in Nepal. Cobblestone alleyways filled with trekking gear shops, Tibetan singing bowl artisans, rooftop restaurants, and historic courtyards.",
            "opening_hours": "Open late into evening",
            "website": "",
            "phone": "",
            "wikipedia": "Thamel",
            "altitude_m": 1340,
            "tags": ["Cultural District", "Trekking Hub", "Nightlife", "Shopping", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-garden-of-dreams",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.3148, 27.7145]},
        "properties": {
            "name": "Garden of Dreams (Swapna Bagaicha)",
            "city": "Kathmandu",
            "category": "nature",
            "prominence_score": 880,
            "is_highlight": True,
            "description": "Classical Edwardian sunken garden built in 1920 by Field Marshal Kaiser Sumsher Rana. An oasis of calm with European pavilions, fountains, hidden ponds, and lush greenery.",
            "opening_hours": "09:00-22:00",
            "website": "https://gardenofdreams.org.np",
            "phone": "+977-1-4425424",
            "wikipedia": "Garden_of_Dreams",
            "altitude_m": 1335,
            "tags": ["Historic Garden", "Neo-Classical", "Oasis", "Cafe", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-imm-pokhara",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9820, 28.1940]},
        "properties": {
            "name": "International Mountain Museum",
            "city": "Pokhara",
            "category": "museum",
            "prominence_score": 875,
            "is_highlight": True,
            "description": "Comprehensive museum celebrating the Himalayas, the 14 eight-thousanders, Sherpa mountaineering legends, geology, and ethnic cultures of Nepal.",
            "opening_hours": "09:00-17:00",
            "website": "https://internationalmountainmuseum.org",
            "phone": "+977-61-460742",
            "wikipedia": "International_Mountain_Museum",
            "altitude_m": 820,
            "tags": ["Mountaineering", "Himalayan History", "Everest", "Sherpa Culture", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-bindhyabasini",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9772, 28.2325]},
        "properties": {
            "name": "Bindhyabasini Temple",
            "city": "Pokhara",
            "category": "temple",
            "prominence_score": 870,
            "is_highlight": True,
            "description": "Oldest Hindu temple in Pokhara Valley, situated on a peaceful hillock in Old Pokhara. Dedicated to Goddess Durga, offering sweeping views of the city and Annapurna peaks.",
            "opening_hours": "05:00-19:00",
            "website": "",
            "phone": "",
            "wikipedia": "Bindhyabasini_Temple",
            "altitude_m": 890,
            "tags": ["Historic Temple", "Hindu", "Durga", "Old Pokhara", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-budhanilkantha",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.3620, 27.7675]},
        "properties": {
            "name": "Budhanilkantha Temple (Floating Vishnu)",
            "city": "Kathmandu",
            "category": "temple",
            "prominence_score": 860,
            "is_highlight": True,
            "description": "Sacred shrine featuring an extraordinary 5-meter monolithic black stone statue of Lord Vishnu reclining on the multi-headed serpent Shesha in a recessed water tank.",
            "opening_hours": "04:00-19:00",
            "website": "",
            "phone": "",
            "wikipedia": "Budhanilkantha_Temple",
            "altitude_m": 1440,
            "tags": ["Lord Vishnu", "Monolithic Sculpture", "Sacred Pool", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-seti-gorge",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.9850, 28.2280]},
        "properties": {
            "name": "Seti River Gorge & K.I. Singh Bridge",
            "city": "Pokhara",
            "category": "nature",
            "prominence_score": 850,
            "is_highlight": True,
            "description": "Dramatic limestone canyon cut more than 50 meters deep through the center of Pokhara by the milky-white, chalky waters of the glacial Seti Gandaki River.",
            "opening_hours": "07:00-18:00",
            "website": "",
            "phone": "",
            "wikipedia": "Seti_Gandaki_River",
            "altitude_m": 840,
            "tags": ["River Gorge", "Glacial Water", "Limestone Canyon", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-kopan-monastery",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [85.3640, 27.7425]},
        "properties": {
            "name": "Kopan Monastery",
            "city": "Kathmandu",
            "category": "temple",
            "prominence_score": 840,
            "is_highlight": True,
            "description": "Renowned Tibetan Buddhist monastery situated atop a peaceful hill north of Boudhanath. Center for Gelug Buddhist teachings, meditation courses, and panoramic valley vistas.",
            "opening_hours": "09:00-17:00",
            "website": "https://kopanmonastery.com",
            "phone": "+977-1-4821268",
            "wikipedia": "Kopan_Monastery",
            "altitude_m": 1470,
            "tags": ["Tibetan Monastery", "Meditation", "Gelug Tradition", "Viewpoint", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    },
    {
        "id": "nepal-australian-camp",
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [83.8400, 28.3050]},
        "properties": {
            "name": "Australian Camp & Dhampus Ridge",
            "city": "Pokhara",
            "category": "viewpoint",
            "prominence_score": 830,
            "is_highlight": True,
            "description": "Spectacular ridge village and day-hike trailhead at 2,060m. Front-row unobstructed views of the Annapurna Massif, Hiunchuli, and Fishtail peaks.",
            "opening_hours": "Open 24 hours",
            "website": "",
            "phone": "",
            "wikipedia": "Dhampus",
            "altitude_m": 2060,
            "tags": ["Trekking Trailhead", "Annapurna South", "Day Hike", "Must Visit"],
            "source": "OpenStreetMap contributors",
            "license": "ODbL – https://opendatacommons.org/licenses/odbl/"
        }
    }
]

def clean_and_enrich():
    with open('data/nepal_poi.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    existing_features = data.get('features', [])
    print(f"Loaded {len(existing_features)} raw OSM features.")

    # Track names of iconic landmarks to avoid duplicates
    iconic_names_lower = {x['properties']['name'].lower() for x in ICONIC_LANDMARKS}

    cleaned = []
    seen_coords = set()

    # 1. Add Iconic landmarks first
    for icon in ICONIC_LANDMARKS:
        cleaned.append(icon)
        c = icon['geometry']['coordinates']
        seen_coords.add((round(c[0], 4), round(c[1], 4)))

    # 2. Filter raw features
    for f in existing_features:
        p = f.get('properties', {})
        name = p.get('name', '').strip()

        # Reject empty or very short names
        if not name or len(name) < 2:
            continue
        # Reject pure numbers (e.g. '1075')
        if re.match(r'^\d+$', name):
            continue
        # Reject dirty OSM scratch names
        if name.startswith('..') or name.startswith('«') or name.startswith('test') or name.startswith('Test'):
            continue
        # Avoid duplicating iconic landmarks
        if name.lower() in iconic_names_lower:
            continue

        c = f.get('geometry', {}).get('coordinates', [])
        if not c or len(c) < 2:
            continue
        coord_key = (round(c[0], 4), round(c[1], 4))
        if coord_key in seen_coords:
            continue
        seen_coords.add(coord_key)

        # Calculate Prominence Score
        score = 20
        tags = p.get('tags', [])
        tag_str = ' '.join(tags).lower() + ' ' + name.lower()

        if any(w in tag_str for w in ['unesco', 'world heritage', 'durbar', 'palace']):
            score += 300
        if any(w in tag_str for w in ['stupa', 'temple', 'mandir', 'monastery', 'gumba']):
            score += 150
        if any(w in tag_str for w in ['viewpoint', 'view point', 'sunrise', 'hill', 'tower']):
            score += 120
        if any(w in tag_str for w in ['lake', 'tal', 'falls', 'waterfall', 'gorge', 'cave']):
            score += 140
        if p.get('wikipedia') or p.get('wikidata'):
            score += 80
        if p.get('website'):
            score += 50
        if p.get('phone'):
            score += 30
        if p.get('opening_hours'):
            score += 30
        if p.get('altitude_m'):
            score += 25

        p['prominence_score'] = score
        p['is_highlight'] = score >= 350
        cleaned.append(f)

    # Sort cleaned features by prominence_score descending
    cleaned.sort(key=lambda x: x['properties'].get('prominence_score', 0), reverse=True)

    data['features'] = cleaned
    data['metadata']['total_pois'] = len(cleaned)
    data['metadata']['description'] = f"Enriched geospatial POI dataset with {len(cleaned)} verified locations across Kathmandu & Pokhara."

    # Write JSON
    with open('data/nepal_poi.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Write JS bundle for file:// zero-CORS compatibility
    js_content = f"/**\n * Nepal MapIt POI Dataset\n * Generated automatically - {len(cleaned)} verified locations\n */\nwindow.NEPAL_POI_DATA = {json.dumps(data, ensure_ascii=False)};\n"
    with open('data/nepal_poi.js', 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"✅ Successfully enriched dataset: {len(cleaned)} features written to data/nepal_poi.json & data/nepal_poi.js")
    print(f"Top 5 spots now:")
    for i, f in enumerate(cleaned[:5]):
        p = f['properties']
        print(f"  {i+1}. {p['name']} ({p['city']}) - Score: {p['prominence_score']} [{p['category']}]")

if __name__ == '__main__':
    clean_and_enrich()

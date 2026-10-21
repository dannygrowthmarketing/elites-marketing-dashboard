#!/usr/bin/env python3
"""Partnerships agent — step 1: fetch candidate partners near the clinic from Overture Maps Places.

Reads only the public, openly licensed Overture release files (anonymous HTTPS range requests;
DuckDB reads just the row groups covering the area). Sends candidates to the dashboard's
`partners-ingest` function, where they are audited, scored and stored with a run record.

Usage:
  PARTNER_INGEST_SECRET=... python3 fetch_overture.py [--radius 2] [--min-confidence 0.6] [--dry-run]
Requires: pip install duckdb==1.1.3
"""
import argparse, json, os, re, sys, time, urllib.request

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
CLINIC = {"name": "Elites Dental Care", "lat": 13.02312, "lon": 77.695679}   # Overture place for the clinic, verified 21 Oct 2026
INGEST = "https://pymwnsjjztahucqzlqkl.supabase.co/functions/v1/partners-ingest"
UA = "EliteDentalCare-PartnerAgent/1.0 (contact: danieldeepak3519@gmail.com)"

# Place categories worth looking at. The partner type for each is decided in SQL (partner_type_for).
CATEGORIES = [
    "school", "private_school", "public_school", "preschool", "elementary_school", "middle_school", "high_school",
    "montessori_school", "kindergarten", "day_care_preschool", "child_care_and_day_care",
    "college_university", "nursing_school", "vocational_and_technical_school",
    "information_technology_company", "corporate_or_business_office", "biotechnology_company", "pharmaceutical_company",
    "industrial_company", "clothing_company", "telecommunications_company", "manufacturer", "software_development",
    "gym", "fitness_studio", "yoga_studio", "sport_or_fitness_facility", "fitness_trainer", "pilates_studio", "martial_arts_club",
    "pharmacy", "pharmacy_and_drug_store", "drugstore",
    "diagnostic_imaging", "laboratory_testing", "doctors_office", "pediatrician", "general_practitioner", "ent_doctor",
    "family_practice", "physical_therapy",
]


def http(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def latest_release():
    xml = http(f"{BUCKET}/?list-type=2&prefix=release/&delimiter=/").decode()
    rels = sorted(re.findall(r"<Prefix>release/([^/<]+)/</Prefix>", xml))
    if not rels:
        raise RuntimeError("no Overture releases listed")
    return rels[-1]


def place_files(release):
    xml = http(f"{BUCKET}/?list-type=2&prefix=release/{release}/theme=places/type=place/").decode()
    keys = re.findall(r"<Key>([^<]+\.parquet)</Key>", xml)
    if not keys:
        raise RuntimeError(f"no place files in release {release}")
    return [f"{BUCKET}/{k}" for k in keys]


def fetch(release, radius_km):
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    # Bounding box a little larger than the radius; exact distance is checked in SQL.
    dlat = radius_km / 111.0 * 1.1
    dlon = radius_km / (111.0 * 0.974) * 1.1   # cos(13°) ≈ 0.974
    lat, lon = CLINIC["lat"], CLINIC["lon"]
    cats = ", ".join(f"'{c}'" for c in CATEGORIES)
    q = f"""
      select id, names.primary as name, taxonomy.primary as category, confidence, operating_status,
             brand.names.primary as brand, websites, phones, socials,
             addresses[1].freeform as address, addresses[1].locality as locality, addresses[1].postcode as postcode,
             (bbox.xmin + bbox.xmax) / 2 as lon, (bbox.ymin + bbox.ymax) / 2 as lat,
             list_transform(sources, s -> struct_pack(dataset := s.dataset, record_id := s.record_id,
                                                      update_time := s.update_time, confidence := s.confidence)) as records
      from read_parquet({json.dumps(place_files(release))})
      where bbox.xmin between {lon - dlon} and {lon + dlon} and bbox.ymin between {lat - dlat} and {lat + dlat}
        and taxonomy.primary in ({cats})
    """
    cur = con.execute(q)
    cols = [d[0] for d in cur.description]
    out = []
    for row in cur.fetchall():
        r = dict(zip(cols, row))
        out.append({
            "source_id": r["id"], "name": r["name"], "category": r["category"],
            "lat": r["lat"], "lon": r["lon"], "confidence": r["confidence"],
            "operating_status": r["operating_status"], "brand": r["brand"],
            "address": r["address"], "locality": r["locality"], "postcode": r["postcode"],
            "websites": r["websites"] or [], "phones": r["phones"] or [], "socials": r["socials"] or [],
            "records": [{k: (str(v) if k == "update_time" and v is not None else v) for k, v in rec.items()} for rec in (r["records"] or [])],
        })
    return out


def post(payload, secret):
    body = json.dumps(payload, default=str).encode()
    return json.loads(http(INGEST, data=body, headers={"Content-Type": "application/json", "x-partner-secret": secret}, timeout=120))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--radius", type=float, default=2.0)
    ap.add_argument("--min-confidence", type=float, default=0.6)
    ap.add_argument("--trigger", default="manual")
    ap.add_argument("--by", default=os.environ.get("PARTNER_AGENT_BY", "agent"))
    ap.add_argument("--dry-run", action="store_true", help="fetch and print a summary, don't send")
    a = ap.parse_args()
    secret = os.environ.get("PARTNER_INGEST_SECRET", "")
    if not a.dry_run and not secret:
        sys.exit("PARTNER_INGEST_SECRET is not set")

    run = {"source_key": "overture_places", "trigger": a.trigger, "triggered_by": a.by,
           "params": {"center_lat": CLINIC["lat"], "center_lon": CLINIC["lon"], "radius_km": a.radius,
                      "min_confidence": a.min_confidence, "categories": CATEGORIES}}
    t = time.time()
    try:
        run["release"] = latest_release()
        rows = fetch(run["release"], a.radius)
    except Exception as e:  # record the failure so it shows in the run history
        print("fetch failed:", e, file=sys.stderr)
        if not a.dry_run:
            print(post({"run": run, "error": f"fetch failed: {e}"}, secret))
        sys.exit(1)
    run["params"]["fetch_seconds"] = round(time.time() - t, 1)
    print(f"release {run['release']}: {len(rows)} candidates in {run['params']['fetch_seconds']}s", file=sys.stderr)
    if a.dry_run:
        print(json.dumps(rows[:5], indent=1, default=str))
        return
    print(json.dumps(post({"run": run, "rows": rows}, secret), indent=1))


if __name__ == "__main__":
    main()

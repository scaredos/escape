"""Download raw geodata into Data/raw/ (stdlib only). Skips files already present.

OSM: Geofabrik israel-and-palestine (ODbL, (c) OpenStreetMap contributors).
DEM: Copernicus GLO-30 COG + WBM water mask from the public AWS bucket.
"""
import os, pathlib, shutil, sys, urllib.request

RAW = pathlib.Path(os.path.abspath(__file__)).parents[2] / "Data" / "raw"
TILES = ["N32_00_E034_00",  # Tel Aviv, Haifa (west)
         "N32_00_E035_00",  # Haifa (east: downtown/port straddle 35.0E)
         "N31_00_E035_00",  # Jerusalem
         "N29_00_E034_00"]  # Eilat
S3 = "https://copernicus-dem-30m.s3.amazonaws.com"

FILES = [("https://download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf",
          "israel-and-palestine-latest.osm.pbf")]
for t in TILES:
    d = f"Copernicus_DSM_COG_10_{t}_DEM"
    FILES += [(f"{S3}/{d}/{d}.tif", f"{d}.tif"),
              (f"{S3}/{d}/AUXFILES/Copernicus_DSM_COG_10_{t}_WBM.tif", f"Copernicus_DSM_COG_10_{t}_WBM.tif")]


def fetch(url, dest):
    if dest.exists():
        print(f"skip {dest.name} ({dest.stat().st_size:,} B)")
        return
    part = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "EscapeIsrael-geo/0.1 (private game build)"})
    print(f"get  {url}", flush=True)
    with urllib.request.urlopen(req, timeout=60) as r, open(part, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    part.replace(dest)  # rename only after a complete download
    print(f"ok   {dest.name} ({dest.stat().st_size:,} B)", flush=True)


if __name__ == "__main__":
    RAW.mkdir(parents=True, exist_ok=True)
    for url, name in FILES:
        fetch(url, RAW / name)
    sys.exit(0)

#!/usr/bin/env python3
"""Assemble l'Atelier parcours de CAIRN : dist/index.html (Leaflet embarqué), manifeste, service worker, icônes."""
import json
import pathlib
import shutil

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"
VENDOR = ROOT / "vendor" / "leaflet" / "dist"
DIST = ROOT / "dist"
VERSION = (SRC / "VERSION").read_text(encoding="utf-8").strip()

head = (SRC / "head.html").read_text(encoding="utf-8")
css = (SRC / "styles.css").read_text(encoding="utf-8")
dark = (SRC / "tokens-dark.css").read_text(encoding="utf-8").rstrip()
assert css.count("/*DARK*/") == 3
css = css.replace("/*DARK*/", dark)
leaflet_css = (VENDOR / "leaflet.css").read_text(encoding="utf-8")
leaflet_js = (VENDOR / "leaflet.js").read_text(encoding="utf-8")
icons = (SRC / "icons.svg").read_text(encoding="utf-8")
js_parts = sorted((SRC / "js").glob("*.js"))
js = "\n".join(p.read_text(encoding="utf-8") for p in js_parts)
js = js.replace("__VERSION__", VERSION)

page = (
    head
    + "<style>\n" + leaflet_css + "\n" + css + "\n</style>\n</head>\n<body>\n"
    + icons
    + '<div id="map" role="application" aria-label="Carte"></div>\n<div id="app"></div>\n'
    + "<script>\n" + leaflet_js + "\n</script>\n"
    + "<script>\n(function () {\n'use strict';\n" + js + "\n})();\n</script>\n</body>\n</html>\n"
)
DIST.mkdir(parents=True, exist_ok=True)
(DIST / "index.html").write_text(page, encoding="utf-8")

manifest = {
    "id": "./",
    "name": "CAIRN Atelier parcours",
    "short_name": "Atelier",
    "description": "Boucles calées sur tes séances, côtes, tracé à la main et export GPX vers Garmin.",
    "lang": "fr",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#E9EDEE",
    "theme_color": "#172024",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        {"src": "icon.svg", "sizes": "any", "type": "image/svg+xml"},
    ],
}
(DIST / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
sw = (SRC / "sw.js").read_text(encoding="utf-8").replace("__VERSION__", VERSION)
(DIST / "sw.js").write_text(sw, encoding="utf-8")
for f in ("icon.svg", "icon-192.png", "icon-512.png", "icon-maskable.png", "README.md", ".nojekyll"):
    p = SRC / "static" / f
    if p.exists():
        shutil.copy(p, DIST / f)
print(f"{DIST / 'index.html'} — {len(page.encode('utf-8')) / 1024:.1f} Ko, {len(js_parts)} fichiers JS, v{VERSION}")

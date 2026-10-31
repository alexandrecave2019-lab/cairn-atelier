import os, json, pathlib, base64
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
CH = "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"
TILE = (ROOT / "test" / "tile.png").read_bytes()
brief = {"id": "x", "date": "2026-11-01", "type": "endurance", "title": "Sortie relief tranquille", "min": 75, "km": 7, "dp": 300, "blocks": []}
url = (ROOT / "dist" / "index.html").as_uri() + "#s=" + base64.urlsafe_b64encode(json.dumps(brief).encode()).decode().rstrip("=")
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    ctx.route("**/*", lambda r: r.fulfill(status=200, content_type="image/png", body=TILE) if ("wmts" in r.request.url or "opentopomap" in r.request.url) else (r.abort() if r.request.url.startswith("http") else r.continue_()))
    ctx.add_init_script((ROOT / "test" / "mock-geo.js").read_text())
    ctx.add_init_script("localStorage.setItem('atelier:start', JSON.stringify({ p: [5.7564, 43.3326], label: 'Hôtellerie', src: 'search' }));")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.locator(".panel").wait_for(); pg.wait_for_timeout(400)
    pg.locator("[data-act=generate]").click()
    pg.wait_for_function("() => !window.__atelier.S.gen.busy", timeout=60000); pg.wait_for_timeout(1500)
    pg.screenshot(path=str(ROOT / "test" / "shots" / "30-results-top.png"))
    pg.locator(".prof").first.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
    bb = pg.locator(".prof").first.bounding_box()
    pg.mouse.move(bb["x"] + bb["width"] * 0.4, bb["y"] + bb["height"] * 0.4)
    pg.mouse.move(bb["x"] + bb["width"] * 0.5, bb["y"] + bb["height"] * 0.5)
    pg.wait_for_timeout(300)
    out["bubble"] = pg.locator(".prof .bubble").first.inner_text()
    out["scrub_marker"] = pg.locator(".pin-scrub").count()
    pg.screenshot(path=str(ROOT / "test" / "shots" / "31-scrub.png"))
    # tap (touch) on a mobile context
    out["errors"] = errs
    b.close()
print(json.dumps(out, ensure_ascii=False))

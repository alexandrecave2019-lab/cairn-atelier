"""Parcours complet de l'Atelier sur un relief simulé : côte, boucles, aller-retour, tracé à la main, course, GPX."""
import base64
import json
import os
import pathlib
import sys

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "test" / "shots"
SHOTS.mkdir(exist_ok=True)
MOCK = (ROOT / "test" / "mock-geo.js").read_text()
TILE = (ROOT / "test" / "tile.png").read_bytes()
CHROME = "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"
W, H = (int(x) for x in os.environ.get("VP", "390x844").split("x"))
THEME = os.environ.get("THEME", "light")


def b64url(s):
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


BRIEF = {
    "id": "soggtest", "date": "2026-11-05", "type": "sortie_longue", "title": "Sortie longue en pente douce",
    "min": 80, "km": 11.5, "dp": 250, "terrain": "chemins roulants avec une côte régulière",
    "blocks": [
        {"k": "echauffement", "min": 15, "z": "Z1", "l": "Footing facile à plat", "n": "FC 131-146 bpm"},
        {"k": "corps", "min": 50, "z": "Z2", "l": "4 × 8 min à 6 % de pente, récupération 6 min à plat", "n": "Pente 6 % à environ 7,5 km/h"},
        {"k": "retour", "min": 15, "z": "Z1", "l": "Retour au calme à plat", "n": ""},
    ],
    "pz": {"Z1": [5.27, 6.23], "Z2": [5.9, 6.6], "Z3": [5.2, 5.8], "Z4": [4.7, 5.1], "Z5": [4.2, 4.6]},
    "th": THEME,
}
URL = (ROOT / "dist" / "index.html").as_uri() + "#s=" + b64url(json.dumps(BRIEF))
res, errors = {}, []

SNAP = """() => { const S = window.__atelier.S; const sum = (r) => r && ({ name: r.name, kind: r.kind, km: +(r.dist/1000).toFixed(2), dplus: Math.round(r.dplus), share: r.share && Math.round(r.share.route*100), overlap: +r.overlap.toFixed(2), climb: r.climb && { len: Math.round(r.climb.len), avg: +(r.climb.avg*100).toFixed(1), reps: r.climb.reps, app: Math.round(r.climb.approach||0) }, pts: r.pts.length });
  return { gen: S.gen.results.map(sum), err: S.gen.err, draw: sum(S.draw.route), race: S.rplan.results.map(sum), rerr: S.rplan.err, stats: window.__mockStats }; }"""


def wait_idle(page, sel="[data-act=generate], .rcard", timeout=90000):
    page.wait_for_function("() => !window.__atelier.S.gen.busy && !window.__atelier.S.rplan.busy && !window.__atelier.S.draw.busy", timeout=timeout)
    page.wait_for_timeout(400)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2, accept_downloads=True)

    def route(r):
        u = r.request.url
        if "opentopomap" in u or "wmts" in u:
            return r.fulfill(status=200, content_type="image/png", body=TILE)
        if u.startswith("http"):
            return r.abort()
        return r.continue_()

    ctx.route("**/*", route)
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "Failed to load" not in m.text else None)
    page.goto(URL)
    page.locator(".panel").wait_for(timeout=10000)
    page.wait_for_timeout(600)
    page.screenshot(path=str(SHOTS / "01-seance.png"))

    # Départ par la recherche d'adresse
    page.locator("[data-act=start-search]").click()
    page.locator("[data-in=q]").fill("sainte baume")
    page.locator("[data-act=search-pick]").first.wait_for(timeout=8000)
    page.screenshot(path=str(SHOTS / "02-search.png"))
    page.locator("[data-act=search-pick]").first.click()
    page.wait_for_timeout(500)
    res["spec_cote"] = page.evaluate("() => { const s = window.__atelier.currentSpec(); return { mode: s.mode, D: s.D, H: s.H, climb: s.climb, warm: Math.round(s.warm) }; }")
    page.screenshot(path=str(SHOTS / "03-start.png"))

    # 1. Côte
    page.locator("[data-act=generate]").click()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "04-progress.png"))
    wait_idle(page)
    res["cote"] = page.evaluate(SNAP)
    page.screenshot(path=str(SHOTS / "05-cote.png"))
    page.locator(".panel-scroll").evaluate("el => el.scrollTop = el.scrollHeight")
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "06-cote-detail.png"))

    # GPX
    with page.expect_download() as dl:
        page.locator("[data-act=gpx]").first.click()
    path = dl.value.path()
    gpx = pathlib.Path(path).read_text()
    res["gpx"] = {"name": dl.value.suggested_filename, "trkpt": gpx.count("<trkpt"), "ele": gpx.count("<ele>"), "wpt": gpx.count("<wpt"), "head": gpx[:120]}
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "07-gpx-modal.png"))
    page.locator(".modal [data-act=modal-close]").first.click()

    # 2. Boucles classiques
    page.locator("[data-act=edit-inputs]").click()
    page.locator("[data-act=climb-off]").click()
    page.locator("[data-act=generate]").click()
    wait_idle(page)
    res["boucles"] = page.evaluate(SNAP)
    page.screenshot(path=str(SHOTS / "08-boucles.png"))
    # profil : lecture au doigt
    prof = page.locator(".prof").first
    bb = prof.bounding_box()
    page.mouse.move(bb["x"] + bb["width"] * 0.55, bb["y"] + bb["height"] * 0.5)
    page.wait_for_timeout(200)
    res["bubble"] = page.locator(".prof .bubble").first.inner_text()
    page.screenshot(path=str(SHOTS / "09-scrub.png"))
    page.locator("[data-act=pick-result]").nth(1).click()
    page.wait_for_timeout(300)
    page.locator("[data-act=save-route]").first.click()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "10-saved-toast.png"))

    # Autres idées
    page.locator("[data-act=regen]").click()
    wait_idle(page)
    res["autres"] = page.evaluate(SNAP)["gen"]

    # 3. Aller-retour
    page.locator("[data-act=edit-inputs]").click()
    page.locator("[data-act=shape-set][data-v=ar]").click()
    page.locator("[data-act=generate]").click()
    wait_idle(page)
    res["ar"] = page.evaluate(SNAP)["gen"]
    page.screenshot(path=str(SHOTS / "11-ar.png"))

    # 4. Modifier un parcours → tracé à la main
    page.locator("[data-act=edit-route]").first.click()
    wait_idle(page)
    res["edit"] = page.evaluate(SNAP)["draw"]
    page.screenshot(path=str(SHOTS / "12-edit.png"))
    page.locator("[data-act=draw-clear]").click()

    # 5. Tracé à la main : 4 points puis boucler
    m = page.locator("#map").bounding_box()
    cx, cy = m["width"] / 2, m["height"] * 0.3
    for dx, dy in [(0, 0), (90, -40), (120, 60), (20, 90)]:
        page.mouse.click(cx + dx, cy + dy)
        page.wait_for_timeout(250)
    wait_idle(page)
    page.locator("[data-act=draw-loop]").click()
    wait_idle(page)
    res["main"] = page.evaluate(SNAP)["draw"]
    page.screenshot(path=str(SHOTS / "13-main.png"))

    # 6. Course : import GPX et tronçons
    page.locator("[data-act=mode][data-mode=course]").click()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "14-course-empty.png"))
    page.locator("input[data-file=race]").set_input_files(str(ROOT / "test" / "race-test.gpx"))
    page.wait_for_function("() => !!window.__atelier.S.race", timeout=20000)
    page.wait_for_timeout(600)
    res["race"] = page.evaluate("() => { const r = window.__atelier.S.race; return { name: r.name, km: +(r.dist/1000).toFixed(1), dplus: Math.round(r.dplus), climbs: r.climbs.map(c => [+(c.from/1000).toFixed(1), +(c.to/1000).toFixed(1), Math.round(c.gain), +(c.avg*100).toFixed(1)]) }; }")
    page.screenshot(path=str(SHOTS / "15-course.png"))
    page.locator("[data-act=race-plan]").click()
    wait_idle(page)
    res["race_ar"] = page.evaluate(SNAP)["race"]
    page.screenshot(path=str(SHOTS / "16-course-ar.png"))
    page.locator("[data-act=race-how][data-v=boucle]").click()
    page.locator("[data-act=race-plan]").click()
    wait_idle(page)
    res["race_boucle"] = page.evaluate(SNAP)["race"]
    res["race_err"] = page.evaluate(SNAP)["rerr"]
    page.screenshot(path=str(SHOTS / "17-course-boucle.png"))

    # 7. Enregistrés
    page.locator("[data-act=mode][data-mode=mes]").click()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "18-mes.png"))
    page.locator("[data-act=open-saved]").first.click()
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / "19-mes-detail.png"))

    # 8. Réglages
    page.locator("[data-act=settings]").click()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "20-settings.png"))
    res["stats"] = page.evaluate("() => window.__mockStats")
    res["errors"] = errors
    b.close()

print(json.dumps(res, ensure_ascii=False, indent=1))

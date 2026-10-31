import os, json, pathlib
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
CH = "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"
host = ROOT / "test" / "probe-host.html"
host.write_text(f"""<!doctype html><body><script>
window.addEventListener('message', (e) => {{ if (e.data && e.data.atelierProbe) window.__probe = e.data.atelierProbe; }});
const f = document.createElement('iframe'); f.src = {json.dumps((ROOT / 'dist' / 'index.html').as_uri() + '#probe')}; document.body.appendChild(f);
</script></body>""")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CH)
    pg = b.new_page()
    pg.route("**/*", lambda r: r.abort() if r.request.url.startswith("http") else r.continue_())
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(host.as_uri())
    pg.wait_for_function("() => !!window.__probe", timeout=20000)
    print(json.dumps({"probe": pg.evaluate("() => window.__probe"), "errors": errs}))
    b.close()

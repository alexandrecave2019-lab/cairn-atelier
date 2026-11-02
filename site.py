#!/usr/bin/env python3
"""Assemble le site publié (branche gh-pages) dans public/ :
   /          redirection vers l'Atelier + retrait de l'ancien service worker
   /atelier/  l'Atelier parcours (sortie de build.py)
   /cairn/    le lanceur CAIRN pour l'écran d'accueil
Chaque appli a sa propre portée, sinon Chrome considère l'une installée quand l'autre l'est."""
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent
PUB = ROOT / "public"
subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
if PUB.exists():
    shutil.rmtree(PUB)
shutil.copytree(ROOT / "site" / "root", PUB)
shutil.copytree(ROOT / "dist", PUB / "atelier")
shutil.copytree(ROOT / "site" / "cairn", PUB / "cairn")
(PUB / "atelier" / "README.md").unlink(missing_ok=True)
(PUB / "atelier" / ".nojekyll").unlink(missing_ok=True)
print("site :", sorted(str(p.relative_to(PUB)) for p in PUB.rglob("*") if p.is_file()))

#!/usr/bin/env python3
"""
metadata_pass: run recipe-scrapers against a URL. Emit {ok, confidence, recipe, error?} JSON.
Reads {url: str} from stdin. Always exits 0.
"""
import json
import sys
from pathlib import Path

# Ensure sibling imports resolve when invoked by Node from any cwd
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from python.schema import Recipe, confidence_score  # noqa: E402

try:
    from recipe_scrapers import scrape_me
except ImportError:
    scrape_me = None


def run(url: str) -> dict:
    if scrape_me is None:
        return {"ok": False, "error": "recipe-scrapers not installed"}
    try:
        s = scrape_me(url, wild_mode=True)
        # recipe-scrapers raises on unsupported sites even with wild_mode
    except Exception as e:
        return {"ok": False, "error": f"scrape-failed: {type(e).__name__}: {e}"}

    # Each call is guarded — not all sites provide every field
    def safe(fn, default):
        try:
            v = fn()
            return v if v is not None else default
        except Exception:
            return default

    recipe = Recipe(
        name=safe(s.title, "") or "",
        ingredients=safe(s.ingredients, []) or [],
        directions=[line.strip() for line in (safe(s.instructions, "") or "").splitlines() if line.strip()],
        prepTime=str(safe(s.prep_time, "") or "") or None,
        cookTime=str(safe(s.cook_time, "") or "") or None,
        image=safe(s.image, "") or None,
    )
    try:
        recipe.yield_ = str(safe(s.yields, "") or "") or None
    except Exception:
        pass

    conf = confidence_score(recipe)
    return {"ok": True, "confidence": conf, "recipe": recipe.model_dump(by_alias=True, exclude_none=True)}


if __name__ == "__main__":
    raw = sys.stdin.read() or "{}"
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = {}
    url = payload.get("url")
    if not url:
        print(json.dumps({"ok": False, "error": "no-url"}))
        sys.exit(0)
    print(json.dumps(run(url)))

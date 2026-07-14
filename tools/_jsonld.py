"""Shared JSON-LD parsing helper (extracted from SEO Suite's tools/blog_audit.py)."""

import json

from bs4 import BeautifulSoup


def _iter_jsonld(soup: BeautifulSoup):
    """Yield each parsed JSON-LD object (flattens @graph arrays)."""
    for script in soup.find_all("script", type="application/ld+json"):
        raw = (script.string or script.get_text() or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            graph = node.get("@graph")
            if isinstance(graph, list):
                for g in graph:
                    if isinstance(g, dict):
                        yield g
            else:
                yield node

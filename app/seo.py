"""Public documents. Same content for people/crawlers, independent of sessions.

The catalog is also imported by React. Keep text here out of markup strings so
translations, metadata and the no-JavaScript document cannot silently diverge.
"""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from html import escape, unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "app" / "static"
PAGES = json.loads((ROOT / "shared" / "public-pages.json").read_text(encoding="utf-8"))
LANGUAGES = ("ru", "en")
ALIASES = {"how": "how", "leaderboards": "leaderboards"}
LEGAL = {
    "privacy": ("privacyDocument", "Политика конфиденциальности", "Privacy notice"),
    "terms": ("termsDocument", "Условия использования", "Terms of use"),
    "support": ("supportDocument", "Поддержка", "Support"),
    "status": ("statusDocument", "Статус сервиса", "Service status"),
    "changelog": ("changelogDocument", "Журнал обновлений", "Changelog"),
    "data-sources": ("dataSourcesDocument", "Источники данных", "Data sources"),
}


def public_path(page: str, language: str) -> str:
    return f"/{language}/{PAGES[page]['slug']}"


def resolve_public_path(path: str) -> tuple[str, str, str | None] | None:
    """Resolve only known paths; never turn a random path into the homepage."""
    if path == "/":
        return "home", "ru", None  # Preserve the Steam callback/dashboard entry.
    parts = path.strip("/").split("/")
    language = parts.pop(0) if parts[0] in LANGUAGES else "ru"
    if len(parts) > 1:
        return None
    slug = parts[0] if parts else ""
    page = next((key for key, data in PAGES.items() if data["slug"] == slug), ALIASES.get(slug))
    if page is None:
        return None
    target = public_path(page, language)
    return page, language, target if path != target else None


def frontend_shell() -> str:
    # Docker copies Vite's output into STATIC. Local Python development may use
    # frontend/dist. Never revive the obsolete legacy app.js/index UI.
    for path in (STATIC / "index.html", ROOT / "frontend" / "dist" / "index.html"):
        if path.is_file():
            source = path.read_text(encoding="utf-8")
            if '<div id="root"></div>' in source:
                return source
    return ('<!doctype html><html lang="ru"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<link rel="stylesheet" href="/static/nightshift-documents.css"></head>'
            '<body><div id="root"></div></body></html>')


def metadata(*, title: str, description: str, language: str, base: str,
             path: str | None, index: bool = True,
             alternates: dict[str, str] | None = None) -> str:
    """All URLs originate in configured APP_BASE_URL, never request Host/query."""
    base = base.rstrip("/")
    canonical = base + path if path is not None else None
    robots = "index, follow" if index else "noindex, follow"
    image = base + "/social-preview.jpg"
    tags = [f"<title>{escape(title)}</title>",
            f'<meta name="description" content="{escape(description, quote=True)}">',
            f'<meta name="robots" content="{robots}">',
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="Deadlock Contracts">',
            f'<meta property="og:title" content="{escape(title, quote=True)}">',
            f'<meta property="og:description" content="{escape(description, quote=True)}">',
            f'<meta property="og:locale" content="{"ru_RU" if language == "ru" else "en_US"}">',
            f'<meta property="og:image" content="{escape(image, quote=True)}">',
            '<meta property="og:image:type" content="image/jpeg">',
            '<meta property="og:image:width" content="1280">',
            '<meta property="og:image:height" content="640">',
            '<meta property="og:image:alt" content="Deadlock Contracts">',
            '<meta name="twitter:card" content="summary_large_image">',
            f'<meta name="twitter:title" content="{escape(title, quote=True)}">',
            f'<meta name="twitter:description" content="{escape(description, quote=True)}">',
            f'<meta name="twitter:image" content="{escape(image, quote=True)}">',
            '<meta name="twitter:image:alt" content="Deadlock Contracts">']
    if canonical:
        tags += [f'<link rel="canonical" href="{escape(canonical, quote=True)}">',
                 f'<meta property="og:url" content="{escape(canonical, quote=True)}">']
    for lang, url in (alternates or {}).items():
        tags.append(f'<link rel="alternate" hreflang="{lang}" href="{escape(base + url, quote=True)}">')
    if canonical and index:
        data = {"@context": "https://schema.org", "@graph": [
            {"@type": "WebSite", "@id": base + "/#website", "url": base + "/",
             "name": "Deadlock Contracts", "inLanguage": list(LANGUAGES)},
            {"@type": "WebPage", "@id": canonical + "#webpage", "url": canonical,
             "name": title, "description": description, "inLanguage": language,
             "isPartOf": {"@id": base + "/#website"}},
        ]}
        encoded = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        tags.append(f'<script type="application/ld+json">{encoded}</script>')
    return "\n".join(tags)


def _with_metadata(shell: str, tags: str, language: str) -> str:
    # The input is our own build/template, not arbitrary supplied HTML.
    shell = re.sub(r"<title\b[^>]*>.*?</title>", "", shell, flags=re.S | re.I)
    shell = re.sub(r'<meta\b(?=[^>]*\bname=["\']description["\'])[^>]*>', "", shell, flags=re.I)
    shell = re.sub(r'<html\b[^>]*>', f'<html lang="{language}">', shell, count=1, flags=re.I)
    return shell.replace("</head>", tags + "\n</head>", 1)


def render_document(*, title: str, description: str, body: str, language: str,
                    base: str, path: str | None, shell: str | None = None,
                    index: bool = True, alternates: dict[str, str] | None = None) -> str:
    source = frontend_shell() if shell is None else shell
    source = _with_metadata(source, metadata(title=title, description=description,
        language=language, base=base, path=path, index=index, alternates=alternates), language)
    # A self-contained style owner keeps server documents readable before hydration.
    assets = ""
    if '/static/nightshift-documents.css' not in source:
        assets += '<link rel="stylesheet" href="/static/nightshift-documents.css">'
    if '/static/document-appearance.js' not in source:
        assets += '<script src="/static/document-appearance.js" defer></script>'
    source = source.replace("</head>", assets + "</head>", 1)
    return source.replace('<div id="root"></div>', f'<div id="root">{body}</div>', 1)


def render_public_page(page: str, language: str, base: str, shell: str | None = None) -> str:
    data = PAGES[page][language]
    links = "".join(f'<a href="{public_path(key, language)}"'
                    f'{" aria-current=\"page\"" if key == page else ""}>{escape(value[language]["label"])}</a>'
                    for key, value in PAGES.items())
    languages = " ".join(f'<a href="{public_path(page, lang)}" lang="{lang}" hreflang="{lang}">{lang.upper()}</a>'
                         for lang in LANGUAGES)
    sections = "".join(f'<section><h2>{escape(section["heading"])}</h2><p>{escape(section["text"])}</p></section>'
                       for section in data["sections"])
    footer = " · ".join(f'<a href="/{language}/{slug}">{escape(labels[1 if language == "ru" else 2])}</a>'
                        for slug, labels in LEGAL.items())
    sign_in = "Войти через Steam" if language == "ru" else "Sign in through Steam"
    edition = "ГОРОД НЕ СПИТ · ГИД ПО КОНТРАКТАМ" if language == "ru" else "CITY NEVER SLEEPS · CONTRACTS GUIDE"
    body = (f'<div class="city-public bureau-public min-h-screen"><header class="bureau-header"><div class="bureau-header-inner">'
            f'<a class="bureau-brand" href="/{language}/" aria-label="Deadlock Contracts">DEADLOCK<small>CONTRACTS</small></a><nav class="bureau-nav">{links}</nav>'
            f'<div class="bureau-account">{languages}</div></div></header>'
            f'<main class="public-document"><p class="city-document-edition">{edition}</p><h1>{escape(data["heading"])}</h1><p>{escape(data["intro"])}</p>'
            f'{sections}<p><a class="btn-primary" href="/auth/steam">{sign_in}</a></p>'
            f'<nav class="public-document-links">{links}</nav></main><footer class="public-document">{footer}</footer></div>')
    payload = json.dumps({"page": page, "language": language, "content": data}, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    source = frontend_shell() if shell is None else shell
    source = source.replace("</head>", f'<script id="dc-public-page" type="application/json">{payload}</script></head>', 1)
    return render_document(title=data["title"], description=data["description"], body=body,
        language=language, base=base, path=public_path(page, language), shell=source,
        index=PAGES[page]["index"], alternates={lang: public_path(page, lang) for lang in LANGUAGES})


def render_legal_page(slug: str, language: str, base: str) -> str:
    source = (STATIC / ("legal_en.html" if language == "en" else "legal.html")).read_text(encoding="utf-8")
    article_id, ru_title, en_title = LEGAL[slug]
    def select_article(match: re.Match) -> str:
        article = match.group(0)
        return article.replace('class="legal-document hidden"', 'class="legal-document"') if f'id="{article_id}"' in article else ""
    source = re.sub(r"<article\b.*?</article>", select_article, source, flags=re.S)
    source = re.sub(r'(data-document-language="(?:en|ru)" href="/(?:en|ru))/[^"\s]+', rf'\1/{slug}', source)
    title = ru_title if language == "ru" else en_title
    # Existing reviewed text, exposed as the document description, not rewritten legal advice.
    article = re.search(r"<article\b.*?</article>", source, flags=re.S)
    paragraph = re.search(r"<p>(.*?)</p>", article.group(0), flags=re.S) if article else None
    description = unescape(re.sub(r"<[^>]+>", "", paragraph.group(1))) if paragraph else title
    return _with_metadata(source, metadata(title=f"{title} | Deadlock Contracts",
        description=description[:220], language=language, base=base, path=f"/{language}/{slug}",
        alternates={lang: f"/{lang}/{slug}" for lang in LANGUAGES}), language)


def render_not_found(base: str, language: str = "ru") -> str:
    title = "Страница не найдена" if language == "ru" else "Page not found"
    body = f'<div class="city-public"><main class="public-document city-not-found"><p class="city-document-edition">DEADLOCK CONTRACTS / 404</p><h1>{title}</h1><p><a href="/ru/">На главную</a> · <a href="/en/">Home</a></p></main></div>'
    return render_document(title=title + " | Deadlock Contracts", description=title,
        body=body, language=language, base=base, path=None, index=False)


def indexable_paths() -> list[str]:
    slugs = [data["slug"] for data in PAGES.values() if data["index"]] + list(LEGAL)
    return [f"/{language}/{slug}" for language in LANGUAGES for slug in slugs]


def sitemap(base: str) -> bytes:
    namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
    alternate = "http://www.w3.org/1999/xhtml"
    ET.register_namespace("", namespace)
    ET.register_namespace("xhtml", alternate)
    root = ET.Element(f"{{{namespace}}}urlset")
    for path in indexable_paths():
        node = ET.SubElement(root, f"{{{namespace}}}url")
        ET.SubElement(node, f"{{{namespace}}}loc").text = base.rstrip("/") + path
        slug = path.split("/", 2)[2]
        for language in LANGUAGES:
            ET.SubElement(node, f"{{{alternate}}}link", {
                "rel": "alternate", "hreflang": language, "href": f"{base.rstrip('/')}/{language}/{slug}",
            })
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def robots(base: str) -> str:
    restrictions = "Disallow: /api\nDisallow: /auth\nDisallow: /reviewer\nDisallow: /admin\nAllow: /\n"
    return (f"User-agent: *\n{restrictions}\nUser-agent: OAI-SearchBot\n{restrictions}"
            f"\nSitemap: {base.rstrip('/')}/sitemap.xml\n")


def valid_indexnow_key(key: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9-]{8,128}", key))


def llms_summary(base: str) -> str:
    lines = ["# Deadlock Contracts", "",
        "> An unofficial, open-beta community website for Deadlock players; not affiliated with Valve.", "",
        "Match contracts use verified results. Browser ciphers, archive tokens, collectible cards and player bureaus are separate website activities.",
        "The Companion is in development/Overwolf review; it is not required for website ciphers, collections or bureaus.", "",
        "## Public guides", ""]
    for language in LANGUAGES:
        for page, data in PAGES.items():
            if data["index"]:
                lines.append(f'- [{data[language]["title"]}]({base.rstrip("/")}{public_path(page, language)}): {data[language]["description"]}')
    lines += ["", f"- [Support]({base.rstrip('/')}/en/support)", f"- [Data sources]({base.rstrip('/')}/en/data-sources)", "",
              "This optional summary is not a search-engine indexing protocol or a promise of AI recommendations.", ""]
    return "\n".join(lines)

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
I18N = (ROOT / 'frontend/src/i18n.tsx').read_text(encoding='utf-8')
LANDING = (ROOT / 'frontend/src/Landing.tsx').read_text(encoding='utf-8')
DASHBOARD = (ROOT / 'frontend/src/Dashboard.tsx').read_text(encoding='utf-8')
PROFILE = (ROOT / 'frontend/src/ProfileStudio.tsx').read_text(encoding='utf-8')
PUBLIC = (ROOT / 'frontend/src/PublicDossier.tsx').read_text(encoding='utf-8')
CSS = (ROOT / 'frontend/src/index.css').read_text(encoding='utf-8')
HEADER = (ROOT / 'frontend/src/BureauHeader.tsx').read_text(encoding='utf-8')


def test_auto_language_and_manual_override_are_present() -> None:
    assert "navigator.languages" in I18N
    assert re.search(
        r"""window\.addEventListener\(\s*["']languagechange["']""",
        I18N,
    )
    assert "dc.ui.language" in I18N
    for mode in ("auto", "en", "ru"):
        assert re.search(
            rf"""setMode\(\s*["']{mode}["']\s*\)""",
            I18N,
        )
    assert "document.documentElement.lang = language" in I18N


def test_mcg_credit_is_global_and_uses_official_link() -> None:
    assert 'https://t.me/MandarinCreatorGroup' in I18N
    assert 'MANDARIN CREATOR GROUP' in I18N
    assert '<MCGCredit' in LANDING
    assert '<MCGCredit' in DASHBOARD
    assert '<MCGCredit' in PUBLIC


def test_language_switch_is_available_on_public_and_authenticated_surfaces() -> None:
    assert '<BureauHeader' in LANDING
    assert '<BureauHeader' in DASHBOARD
    assert '<LanguageSwitch' in HEADER
    assert '<BureauHeader' in PUBLIC
    assert '.dc-language-switch' in CSS


def test_player_facing_translation_calls_have_english_entries() -> None:
    dictionary_source = (
        I18N.split("const EN", 1)[1]
        .split("export function t", 1)[0]
    )

    # Oxfmt uses quoteProps="as-needed" by default, so valid
    # IdentifierName keys may legitimately appear without quotes.
    key_pattern = re.compile(
        r"""(?m)^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_$А-Яа-яЁё][A-Za-z0-9_$А-Яа-яЁё]*))\s*:"""
    )

    keys = {
        next(
            value
            for value in match.groups()
            if value is not None
        )
        for match in key_pattern.finditer(dictionary_source)
    }

    for source in (LANDING, DASHBOARD, PROFILE):
        literals = re.findall(
            r't\(language,\s*"((?:[^"\\]|\\.)*)"\)',
            source,
        )
        literals += re.findall(
            r"t\(language,\s*'((?:[^'\\]|\\.)*)'\)",
            source,
        )

        missing = {
            value
            for value in literals
            if re.search(r"[А-Яа-яЁё]", value)
            and value not in keys
        }

        assert not missing, sorted(missing)


def test_public_profile_numbers_follow_active_locale() -> None:
    hardcoded_ru_locale = re.compile(
        r"""toLocaleString\(\s*["']ru-RU["']\s*\)"""
    )

    assert not hardcoded_ru_locale.search(PROFILE)
    assert not hardcoded_ru_locale.search(PUBLIC)
    dossier = (ROOT / "frontend/src/community/DossierView.tsx").read_text(encoding="utf-8")
    assert "<DossierView" in PROFILE and "<DossierView" in PUBLIC
    assert "toLocaleString(locale)" in dossier


from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
I18N = (ROOT / 'frontend/src/i18n.tsx').read_text(encoding='utf-8')
LANDING = (ROOT / 'frontend/src/Landing.tsx').read_text(encoding='utf-8')
DASHBOARD = (ROOT / 'frontend/src/Dashboard.tsx').read_text(encoding='utf-8')
PROFILE = (ROOT / 'frontend/src/ProfileStudio.tsx').read_text(encoding='utf-8')
PUBLIC = (ROOT / 'frontend/src/PublicDossier.tsx').read_text(encoding='utf-8')
CSS = (ROOT / 'frontend/src/index.css').read_text(encoding='utf-8')


def test_auto_language_and_manual_override_are_present() -> None:
    assert 'navigator.languages' in I18N
    assert "window.addEventListener('languagechange'" in I18N
    assert "dc.ui.language" in I18N
    assert "setMode('auto')" in I18N
    assert "setMode('en')" in I18N
    assert "setMode('ru')" in I18N
    assert 'document.documentElement.lang = language' in I18N


def test_mcg_credit_is_global_and_uses_official_link() -> None:
    assert 'https://t.me/MandarinCreatorGroup' in I18N
    assert 'MANDARIN CREATOR GROUP' in I18N
    assert '<MCGCredit' in LANDING
    assert '<MCGCredit' in DASHBOARD
    assert '<MCGCredit' in PUBLIC


def test_language_switch_is_available_on_public_and_authenticated_surfaces() -> None:
    assert '<LanguageSwitch' in LANDING
    assert '<LanguageSwitch' in DASHBOARD
    assert '<LanguageSwitch' in PUBLIC
    assert '.dc-language-switch' in CSS


def test_player_facing_translation_calls_have_english_entries() -> None:
    dictionary_source = I18N.split('export function t', 1)[0]
    keys = set(re.findall(r"'((?:[^'\\]|\\.)*)'\s*:\s*'", dictionary_source))
    for source in (LANDING, DASHBOARD, PROFILE):
        literals = re.findall(r"t\(language,\s*'((?:[^'\\]|\\.)*)'\)", source)
        missing = {value for value in literals if re.search(r'[А-Яа-яЁё]', value) and value not in keys}
        assert not missing, sorted(missing)


def test_public_profile_numbers_follow_active_locale() -> None:
    assert "toLocaleString('ru-RU')" not in PROFILE
    assert "toLocaleString('ru-RU')" not in PUBLIC
    assert 'toLocaleString(locale)' in PROFILE
    assert 'toLocaleString(locale)' in PUBLIC

from __future__ import annotations

import base64
import ipaddress
import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _secret(name: str, default: str = "") -> str:
    """Read a secret from NAME_FILE when present, otherwise from NAME.

    Docker secrets and systemd credentials can mount a file without putting the
    secret in the Compose YAML or the process command line.
    """
    file_name = os.getenv(f"{name}_FILE", "").strip()
    if file_name:
        try:
            return Path(file_name).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise RuntimeError(f"Cannot read {name}_FILE") from exc
    return os.getenv(name, default).strip()


def _csv(name: str, default: str = "") -> tuple[str, ...]:
    value = os.getenv(name, default)
    return tuple(item.strip() for item in value.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Deadlock Contracts")
    app_version: str = os.getenv("APP_VERSION", "0.10.1-alpha.12")
    app_env: str = os.getenv("APP_ENV", "development").strip().lower()
    service_role: str = os.getenv("SERVICE_ROLE", "web").strip().lower()
    app_base_url: str = os.getenv("APP_BASE_URL", "http://localhost:8080").rstrip("/")
    contact_email: str = os.getenv("CONTACT_EMAIL", "").strip()
    database_url: str = _secret("DATABASE_URL", "sqlite:///./runtime/deadlock_contracts.db")

    session_secret: str = _secret("SESSION_SECRET", "dev-only-change-me")
    session_ttl_days: int = int(os.getenv("SESSION_TTL_DAYS", "14"))
    cookie_secure: bool = _bool("COOKIE_SECURE", False)
    # Closed-alpha access control. Normal users must be explicitly allowlisted.
    # Overwolf reviewers use the temporary /reviewer gateway and the private
    # first-build QA code; the code itself is never stored, only its SHA-256.
    closed_alpha: bool = _bool("CLOSED_ALPHA", False)
    alpha_allowed_steam_ids: tuple[str, ...] = _csv("ALPHA_ALLOWED_STEAM_IDS", "")
    overwolf_qa_access_enabled: bool = _bool("OVERWOLF_QA_ACCESS_ENABLED", False)
    overwolf_qa_access_code_hash: str = os.getenv("OVERWOLF_QA_ACCESS_CODE_HASH", "").strip().lower()
    overwolf_qa_access_until: str = os.getenv("OVERWOLF_QA_ACCESS_UNTIL", "").strip()
    trusted_hosts: tuple[str, ...] = _csv("TRUSTED_HOSTS", "localhost,127.0.0.1,testserver")
    trust_proxy_headers: bool = _bool("TRUST_PROXY_HEADERS", False)
    trusted_proxy_networks: tuple[str, ...] = _csv("TRUSTED_PROXY_NETWORKS", "127.0.0.1/32,::1/128")
    rate_limit_redis_url: str = os.getenv("RATE_LIMIT_REDIS_URL", "").strip()
    docs_enabled: bool = _bool("DOCS_ENABLED", True)

    allow_demo_auth: bool = _bool("ALLOW_DEMO_AUTH", False)
    allow_dev_endpoints: bool = _bool("ALLOW_DEV_ENDPOINTS", False)

    provider: str = os.getenv("MATCH_PROVIDER", "mock").strip().lower()
    deadlock_api_base_url: str = os.getenv("DEADLOCK_API_BASE_URL", "https://api.deadlock-api.com").rstrip("/")
    deadlock_api_key: str = _secret("DEADLOCK_API_KEY", "")
    deadlock_api_key_header: str = os.getenv("DEADLOCK_API_KEY_HEADER", "X-API-Key").strip()
    deadlock_force_refetch: bool = _bool("DEADLOCK_FORCE_REFETCH", False)
    store_provider_raw: bool = _bool("STORE_PROVIDER_RAW", False)

    steam_web_api_key: str = _secret("STEAM_WEB_API_KEY", "")
    steam_openid_url: str = os.getenv("STEAM_OPENID_URL", "https://steamcommunity.com/openid/login").strip()

    worker_poll_seconds: float = float(os.getenv("WORKER_POLL_SECONDS", "2"))
    discovery_retry_seconds: int = int(os.getenv("DISCOVERY_RETRY_SECONDS", "600"))
    max_discovery_attempts: int = int(os.getenv("MAX_DISCOVERY_ATTEMPTS", "180"))
    request_timeout_seconds: float = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "15"))
    request_connect_timeout_seconds: float = float(os.getenv("REQUEST_CONNECT_TIMEOUT_SECONDS", "5"))
    max_provider_response_bytes: int = int(os.getenv("MAX_PROVIDER_RESPONSE_BYTES", str(4 * 1024 * 1024)))
    max_request_body_bytes: int = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(64 * 1024)))
    min_match_duration_seconds: int = int(os.getenv("MIN_MATCH_DURATION_SECONDS", "600"))

    global_rate_limit_per_minute: int = int(os.getenv("GLOBAL_RATE_LIMIT_PER_MINUTE", "240"))
    auth_rate_limit_per_10_minutes: int = int(os.getenv("AUTH_RATE_LIMIT_PER_10_MINUTES", "30"))
    sync_rate_limit_per_hour: int = int(os.getenv("SYNC_RATE_LIMIT_PER_HOUR", "30"))

    evaluator_version: str = os.getenv("EVALUATOR_VERSION", "contracts-3.0.0-alpha.1")
    adapter_version: str = os.getenv("ADAPTER_VERSION", "deadlock-api-openapi-2026-08-15")
    mode_classifier_version: str = os.getenv("MODE_CLASSIFIER_VERSION", "mode-1.4.0")

    evidence_dir: str = os.getenv("EVIDENCE_DIR", "/app/runtime/evidence")
    evidence_max_files: int = int(os.getenv("EVIDENCE_MAX_FILES", "4"))
    evidence_max_file_bytes: int = int(os.getenv("EVIDENCE_MAX_FILE_BYTES", str(3 * 1024 * 1024)))
    evidence_retention_days: int = int(os.getenv("EVIDENCE_RETENTION_DAYS", "30"))
    admin_steam_ids: tuple[str, ...] = _csv("ADMIN_STEAM_IDS", "")
    admin_totp_secret: str = _secret("ADMIN_TOTP_SECRET", "")
    admin_session_ttl_minutes: int = int(os.getenv("ADMIN_SESSION_TTL_MINUTES", "30"))

    # System announcements are deployed fail-closed. Admin draft/history APIs
    # remain available while these delivery switches are disabled.
    announcements_enabled: bool = _bool("ANNOUNCEMENTS_ENABLED", False)
    announcements_site_enabled: bool = _bool(
        "ANNOUNCEMENTS_SITE_ENABLED",
        False,
    )
    announcements_companion_enabled: bool = _bool(
        "ANNOUNCEMENTS_COMPANION_ENABLED",
        False,
    )
    announcements_telegram_mirror_enabled: bool = _bool(
        "ANNOUNCEMENTS_TELEGRAM_MIRROR_ENABLED",
        False,
    )
    announcements_poll_seconds: int = int(
        os.getenv("ANNOUNCEMENTS_POLL_SECONDS", "60")
    )
    announcements_max_active: int = int(
        os.getenv("ANNOUNCEMENTS_MAX_ACTIVE", "5")
    )
    announcements_max_duration_days: int = int(
        os.getenv("ANNOUNCEMENTS_MAX_DURATION_DAYS", "30")
    )

    telegram_bot_token: str = _secret("TELEGRAM_BOT_TOKEN", "")
    telegram_review_chat_id: str = os.getenv("TELEGRAM_REVIEW_CHAT_ID", "").strip()
    telegram_webhook_secret: str = _secret("TELEGRAM_WEBHOOK_SECRET", "")
    # Stage 5B inbound webhook remains fail-closed until explicitly enabled.
    telegram_webhook_enabled: bool = _bool(
        "TELEGRAM_WEBHOOK_ENABLED",
        False,
    )
    telegram_webhook_max_body_bytes: int = int(
        os.getenv("TELEGRAM_WEBHOOK_MAX_BODY_BYTES", str(32 * 1024))
    )
    # Stage 5C interactive moderation remains fail-closed until explicitly enabled.
    telegram_review_callbacks_enabled: bool = _bool(
        "TELEGRAM_REVIEW_CALLBACKS_ENABLED",
        False,
    )
    # Stage 4 is outbound-only. Merely providing a bot token must not enable
    # moderation notifications until this explicit feature flag is set.
    telegram_moderation_notifications_enabled: bool = _bool(
        "TELEGRAM_MODERATION_NOTIFICATIONS_ENABLED",
        False,
    )
    telegram_review_thread_id: int = int(
        os.getenv("TELEGRAM_REVIEW_THREAD_ID", "0")
    )
    telegram_system_thread_id: int = int(
        os.getenv("TELEGRAM_SYSTEM_THREAD_ID", "0")
    )
    telegram_review_protect_content: bool = _bool(
        "TELEGRAM_REVIEW_PROTECT_CONTENT",
        True,
    )
    telegram_bot_username: str = os.getenv(
        "TELEGRAM_BOT_USERNAME",
        "",
    ).strip().lstrip("@")
    telegram_link_token_ttl_minutes: int = int(
        os.getenv("TELEGRAM_LINK_TOKEN_TTL_MINUTES", "10")
    )
    discord_review_webhook_url: str = _secret("DISCORD_REVIEW_WEBHOOK_URL", "")

    companion_pairing_ttl_minutes: int = int(os.getenv("COMPANION_PAIRING_TTL_MINUTES", "10"))
    companion_online_seconds: int = int(os.getenv("COMPANION_ONLINE_SECONDS", "90"))
    # GEP can expose the previous match outcome for a short period after a new
    # match ID appears. Never use outcome alone as finality. After a strong
    # terminal signal, give the GEP state a short grace period to settle before
    # a resolver consumes the final snapshot/result.
    companion_finalization_grace_seconds: int = int(os.getenv("COMPANION_FINALIZATION_GRACE_SECONDS", "5"))
    # Final provider metadata can lag behind a confirmed Companion match_end.
    # Keep the board in VERIFYING and retry exact metadata before escalating to
    # internal review. This does not consume additional contract attempts.
    post_match_verification_max_attempts: int = int(os.getenv("POST_MATCH_VERIFICATION_MAX_ATTEMPTS", "12"))
    provisional_post_match_max_attempts: int = int(
        os.getenv("PROVISIONAL_POST_MATCH_MAX_ATTEMPTS", "144")
    )
    companion_event_retention_days: int = int(os.getenv("COMPANION_EVENT_RETENTION_DAYS", "14"))
    companion_ingest_enabled: bool = _bool("COMPANION_INGEST_ENABLED", True)

    # Companion-first settlement is fail-closed during Alpha.11 rollout.
    # Merely deploying the foundation must not change production scoring.
    gep_settlement_enabled: bool = _bool("GEP_SETTLEMENT_ENABLED", False)
    gep_settlement_allow_all: bool = _bool("GEP_SETTLEMENT_ALLOW_ALL", False)
    gep_settlement_allowlist: tuple[str, ...] = _csv(
        "GEP_SETTLEMENT_ALLOWLIST",
        "",
    )
    gep_settlement_leaderboard_eligible: bool = _bool(
        "GEP_SETTLEMENT_LEADERBOARD_ELIGIBLE",
        False,
    )

    # Deadlock API will later move to this asynchronous audit path.
    # It remains disabled until the actual audit worker is implemented.
    match_audit_enabled: bool = _bool("MATCH_AUDIT_ENABLED", False)
    match_audit_max_attempts: int = int(
        os.getenv("MATCH_AUDIT_MAX_ATTEMPTS", "24")
    )
    match_audit_retry_seconds: int = int(
        os.getenv("MATCH_AUDIT_RETRY_SECONDS", "900")
    )

    companion_ads_enabled: bool = _bool("COMPANION_ADS_ENABLED", False)
    companion_minimum_version: str = os.getenv("COMPANION_MINIMUM_VERSION", "").strip()
    reward_settlement_enabled: bool = _bool("REWARD_SETTLEMENT_ENABLED", True)
    case_ttl_hours: int = int(os.getenv("CASE_TTL_HOURS", "24"))
    board_reset_hour_utc: int = int(os.getenv("BOARD_RESET_HOUR_UTC", "3"))
    case_max_attempts: int = int(os.getenv("CASE_MAX_ATTEMPTS", "3"))
    companion_download_url: str = os.getenv("COMPANION_DOWNLOAD_URL", "").strip()

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def app_origin(self) -> str:
        parsed = urlparse(self.app_base_url)
        port = f":{parsed.port}" if parsed.port else ""
        return f"{parsed.scheme}://{parsed.hostname}{port}"

    def validate(self) -> None:
        parsed = urlparse(self.app_base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.path not in {"", "/"}:
            raise RuntimeError("APP_BASE_URL must be an origin such as https://example.com")

        if self.contact_email and (len(self.contact_email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", self.contact_email)):
            raise RuntimeError("CONTACT_EMAIL must be a valid email address")

        if not 1 <= self.session_ttl_days <= 90:
            raise RuntimeError("SESSION_TTL_DAYS must be between 1 and 90")
        for steam_id in self.alpha_allowed_steam_ids:
            if not re.fullmatch(r"\d{17,20}", steam_id):
                raise RuntimeError("ALPHA_ALLOWED_STEAM_IDS contains an invalid SteamID64")
        if self.overwolf_qa_access_enabled:
            if not self.closed_alpha:
                raise RuntimeError("OVERWOLF_QA_ACCESS_ENABLED requires CLOSED_ALPHA=true")
            if not re.fullmatch(r"[0-9a-f]{64}", self.overwolf_qa_access_code_hash):
                raise RuntimeError("OVERWOLF_QA_ACCESS_CODE_HASH must be a lowercase SHA-256 hex digest")
            try:
                qa_until = datetime.fromisoformat(self.overwolf_qa_access_until.replace("Z", "+00:00"))
            except ValueError as exc:
                raise RuntimeError("OVERWOLF_QA_ACCESS_UNTIL must be a valid ISO-8601 timestamp") from exc
            if qa_until.tzinfo is None:
                raise RuntimeError("OVERWOLF_QA_ACCESS_UNTIL must include a timezone")
        if self.is_production and self.closed_alpha and not self.alpha_allowed_steam_ids:
            raise RuntimeError("CLOSED_ALPHA requires ALPHA_ALLOWED_STEAM_IDS to fail closed")
        for value in self.trusted_proxy_networks:
            try:
                network = ipaddress.ip_network(value, strict=False)
            except ValueError as exc:
                raise RuntimeError("TRUSTED_PROXY_NETWORKS contains an invalid CIDR") from exc
            if self.is_production and network.prefixlen == 0:
                raise RuntimeError("TRUSTED_PROXY_NETWORKS must not trust the entire internet")
        if self.service_role not in {"web", "worker"}:
            raise RuntimeError("SERVICE_ROLE must be web or worker")
        for steam_id in self.admin_steam_ids:
            if not re.fullmatch(r"\d{17,20}", steam_id):
                raise RuntimeError("ADMIN_STEAM_IDS contains an invalid SteamID64")
        if not 5 <= self.admin_session_ttl_minutes <= 120:
            raise RuntimeError("ADMIN_SESSION_TTL_MINUTES must be between 5 and 120")

        if not 15 <= self.announcements_poll_seconds <= 3600:
            raise RuntimeError(
                "ANNOUNCEMENTS_POLL_SECONDS must be between 15 and 3600"
            )
        if not 1 <= self.announcements_max_active <= 10:
            raise RuntimeError(
                "ANNOUNCEMENTS_MAX_ACTIVE must be between 1 and 10"
            )
        if not 1 <= self.announcements_max_duration_days <= 365:
            raise RuntimeError(
                "ANNOUNCEMENTS_MAX_DURATION_DAYS must be between 1 and 365"
            )
        if self.admin_totp_secret:
            normalized_totp = self.admin_totp_secret.upper()
            if not re.fullmatch(r"[A-Z2-7]{16,128}", normalized_totp):
                raise RuntimeError("ADMIN_TOTP_SECRET must be a Base32 secret")
            try:
                padding = "=" * ((8 - len(normalized_totp) % 8) % 8)
                totp_bytes = base64.b32decode(normalized_totp + padding, casefold=False)
            except (ValueError, base64.binascii.Error) as exc:
                raise RuntimeError("ADMIN_TOTP_SECRET must be valid Base32") from exc
            if len(totp_bytes) < 20:
                raise RuntimeError("ADMIN_TOTP_SECRET must contain at least 160 bits")

        if self.telegram_bot_username and not re.fullmatch(
            r"[A-Za-z0-9_]{5,32}",
            self.telegram_bot_username,
        ):
            raise RuntimeError("TELEGRAM_BOT_USERNAME is invalid")
        if not 5 <= self.telegram_link_token_ttl_minutes <= 30:
            raise RuntimeError(
                "TELEGRAM_LINK_TOKEN_TTL_MINUTES must be between 5 and 30"
            )

        if not 4096 <= self.telegram_webhook_max_body_bytes <= 131072:
            raise RuntimeError(
                "TELEGRAM_WEBHOOK_MAX_BODY_BYTES must be between 4096 and 131072"
            )
        if self.telegram_webhook_enabled:
            if not re.fullmatch(
                r"[A-Za-z0-9_-]{32,256}",
                self.telegram_webhook_secret,
            ):
                raise RuntimeError(
                    "TELEGRAM_WEBHOOK_SECRET must contain 32-256 safe characters "
                    "when Telegram webhook is enabled"
                )
            if not self.telegram_bot_username:
                raise RuntimeError(
                    "TELEGRAM_BOT_USERNAME is required when Telegram webhook is enabled"
                )
            if self.is_production and urlparse(self.app_base_url).scheme != "https":
                raise RuntimeError(
                    "Telegram webhook requires HTTPS APP_BASE_URL in production"
                )

        if self.telegram_review_callbacks_enabled:
            if not self.telegram_webhook_enabled:
                raise RuntimeError(
                    "TELEGRAM_REVIEW_CALLBACKS_ENABLED requires TELEGRAM_WEBHOOK_ENABLED=true"
                )
            if not self.telegram_moderation_notifications_enabled:
                raise RuntimeError(
                    "TELEGRAM_REVIEW_CALLBACKS_ENABLED requires TELEGRAM_MODERATION_NOTIFICATIONS_ENABLED=true"
                )

        if self.telegram_moderation_notifications_enabled:
            if not re.fullmatch(
                r"\d{5,20}:[A-Za-z0-9_-]{20,100}",
                self.telegram_bot_token,
            ):
                raise RuntimeError(
                    "TELEGRAM_BOT_TOKEN is invalid or missing while "
                    "Telegram moderation notifications are enabled"
                )
            if not re.fullmatch(
                r"(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})",
                self.telegram_review_chat_id,
            ):
                raise RuntimeError(
                    "TELEGRAM_REVIEW_CHAT_ID must be a numeric chat id "
                    "or @channel username"
                )
            if not 0 <= self.telegram_review_thread_id <= 2_147_483_647:
                raise RuntimeError(
                    "TELEGRAM_REVIEW_THREAD_ID must be 0 or a positive "
                    "Telegram message thread id"
                )
            if self.is_production and urlparse(self.app_base_url).scheme != "https":
                raise RuntimeError(
                    "Telegram moderation deep links require HTTPS APP_BASE_URL "
                    "in production"
                )

        if self.announcements_telegram_mirror_enabled:
            if not re.fullmatch(
                r"\d{5,20}:[A-Za-z0-9_-]{20,100}",
                self.telegram_bot_token,
            ):
                raise RuntimeError(
                    "TELEGRAM_BOT_TOKEN is invalid or missing while "
                    "announcement mirroring is enabled"
                )
            if not re.fullmatch(
                r"(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})",
                self.telegram_review_chat_id,
            ):
                raise RuntimeError(
                    "TELEGRAM_REVIEW_CHAT_ID must be configured while "
                    "announcement mirroring is enabled"
                )
            if not 0 <= self.telegram_system_thread_id <= 2_147_483_647:
                raise RuntimeError(
                    "TELEGRAM_SYSTEM_THREAD_ID must be 0 or a positive "
                    "Telegram message thread id"
                )
            if self.is_production and urlparse(self.app_base_url).scheme != "https":
                raise RuntimeError(
                    "Telegram announcement deep links require HTTPS APP_BASE_URL "
                    "in production"
                )

        if len(self.session_secret) < 32 or self.session_secret in {
            "dev-only-change-me",
            "change-me-before-sharing",
            "replace-with-a-long-random-string",
        }:
            raise RuntimeError("SESSION_SECRET must be a unique random value of at least 32 characters")

        if self.provider not in {"mock", "deadlock_api"}:
            raise RuntimeError("MATCH_PROVIDER must be mock or deadlock_api")

        provider_url = urlparse(self.deadlock_api_base_url)
        if provider_url.scheme != "https" or provider_url.hostname != "api.deadlock-api.com":
            raise RuntimeError("DEADLOCK_API_BASE_URL must be https://api.deadlock-api.com")
        if not re.fullmatch(r"[A-Za-z0-9-]{1,64}", self.deadlock_api_key_header):
            raise RuntimeError("DEADLOCK_API_KEY_HEADER contains invalid characters")
        if self.steam_openid_url != "https://steamcommunity.com/openid/login":
            raise RuntimeError("STEAM_OPENID_URL must use the official Steam OpenID endpoint")

        if self.max_request_body_bytes < 1024 or self.max_request_body_bytes > 16 * 1024 * 1024:
            raise RuntimeError("MAX_REQUEST_BODY_BYTES must be between 1 KiB and 16 MiB")
        if self.max_provider_response_bytes < 1024 or self.max_provider_response_bytes > 16 * 1024 * 1024:
            raise RuntimeError("MAX_PROVIDER_RESPONSE_BYTES must be between 1 KiB and 16 MiB")


        if not 1 <= self.evidence_max_files <= 8:
            raise RuntimeError("EVIDENCE_MAX_FILES must be between 1 and 8")
        if not 64 * 1024 <= self.evidence_max_file_bytes <= 5 * 1024 * 1024:
            raise RuntimeError("EVIDENCE_MAX_FILE_BYTES must be between 64 KiB and 5 MiB")
        if not 1 <= self.evidence_retention_days <= 365:
            raise RuntimeError("EVIDENCE_RETENTION_DAYS must be between 1 and 365")
        if not 2 <= self.companion_pairing_ttl_minutes <= 60:
            raise RuntimeError("COMPANION_PAIRING_TTL_MINUTES must be between 2 and 60")
        if not 30 <= self.companion_online_seconds <= 600:
            raise RuntimeError("COMPANION_ONLINE_SECONDS must be between 30 and 600")
        if not 0 <= self.companion_finalization_grace_seconds <= 30:
            raise RuntimeError("COMPANION_FINALIZATION_GRACE_SECONDS must be between 0 and 30")
        if not 2 <= self.post_match_verification_max_attempts <= 30:
            raise RuntimeError("POST_MATCH_VERIFICATION_MAX_ATTEMPTS must be between 2 and 30")
        if not 24 <= self.provisional_post_match_max_attempts <= 1008:
            raise RuntimeError(
                "PROVISIONAL_POST_MATCH_MAX_ATTEMPTS must be between 24 and 1008"
            )
        if not 1 <= self.companion_event_retention_days <= 90:
            raise RuntimeError("COMPANION_EVENT_RETENTION_DAYS must be between 1 and 90")

        for steam_id in self.gep_settlement_allowlist:
            if not re.fullmatch(r"\d{17,20}", steam_id):
                raise RuntimeError(
                    "GEP_SETTLEMENT_ALLOWLIST contains an invalid SteamID64"
                )

        if not 1 <= self.match_audit_max_attempts <= 1008:
            raise RuntimeError(
                "MATCH_AUDIT_MAX_ATTEMPTS must be between 1 and 1008"
            )

        if not 60 <= self.match_audit_retry_seconds <= 86400:
            raise RuntimeError(
                "MATCH_AUDIT_RETRY_SECONDS must be between 60 and 86400"
            )

        if self.companion_minimum_version and not re.fullmatch(
            r"\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?",
            self.companion_minimum_version,
        ):
            raise RuntimeError("COMPANION_MINIMUM_VERSION must be a supported semantic version")
        if not 1 <= self.case_ttl_hours <= 168:
            raise RuntimeError("CASE_TTL_HOURS must be between 1 and 168")
        if not 0 <= self.board_reset_hour_utc <= 23:
            raise RuntimeError("BOARD_RESET_HOUR_UTC must be between 0 and 23")
        if not 1 <= self.case_max_attempts <= 5:
            raise RuntimeError("CASE_MAX_ATTEMPTS must be between 1 and 5")

        if self.discord_review_webhook_url:
            parsed_webhook = urlparse(self.discord_review_webhook_url)
            if parsed_webhook.scheme != "https" or parsed_webhook.hostname not in {"discord.com", "discordapp.com"}:
                raise RuntimeError("DISCORD_REVIEW_WEBHOOK_URL must use an official Discord HTTPS host")

        if self.is_production:
            if not self.contact_email:
                raise RuntimeError("CONTACT_EMAIL is required in production")
            if parsed.scheme != "https":
                raise RuntimeError("Production APP_BASE_URL must use HTTPS")
            if not self.cookie_secure:
                raise RuntimeError("COOKIE_SECURE must be true in production")
            if self.allow_demo_auth or self.allow_dev_endpoints:
                raise RuntimeError("Demo authentication and development endpoints must be disabled in production")
            if self.docs_enabled:
                raise RuntimeError("DOCS_ENABLED must be false in production")
            if self.provider != "deadlock_api":
                raise RuntimeError("Production MATCH_PROVIDER must be deadlock_api")
            if self.database_url.startswith("sqlite"):
                raise RuntimeError("Production must use PostgreSQL, not SQLite")
            if self.service_role == "web" and self.admin_steam_ids and not self.admin_totp_secret:
                raise RuntimeError("ADMIN_STEAM_IDS requires ADMIN_TOTP_SECRET in production web service")
            if not self.trusted_hosts or "*" in self.trusted_hosts:
                raise RuntimeError("TRUSTED_HOSTS must contain explicit hostnames in production")
            if parsed.hostname not in self.trusted_hosts:
                raise RuntimeError("APP_BASE_URL hostname must be present in TRUSTED_HOSTS")
            if self.trust_proxy_headers and not self.trusted_proxy_networks:
                raise RuntimeError("TRUST_PROXY_HEADERS requires TRUSTED_PROXY_NETWORKS")
            if self.service_role == "web" and not self.rate_limit_redis_url.startswith(("redis://", "rediss://")):
                raise RuntimeError("Production web service requires RATE_LIMIT_REDIS_URL")


settings = Settings()

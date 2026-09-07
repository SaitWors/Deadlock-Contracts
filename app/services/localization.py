from __future__ import annotations

import re
from typing import Any


RU_TO_EN = {
    'Доступно только участникам бюро': 'Only bureau members can access this',
    'Работа бюро приостановлена модератором': 'This bureau has been paused by site staff',
    'Повторное вступление в это бюро заблокировано': 'Rejoining this bureau is prohibited',
    'Активная блокировка не найдена': 'No active membership ban found',
    'Бюро не приостановлено': 'This bureau is not paused',
    'Можно отправить не более пяти обращений за сутки': 'You can send up to five reports per day',
    'Обращение не найдено': 'Report not found',
    'Обращение уже изменилось. Обновите очередь.': 'This report has changed. Refresh the queue.',
    'Своё обращение или бюро должен проверить другой сотрудник': 'Another staff member must review your own report or bureau',
    'Бюро уже удалено': 'This bureau has been deleted',
    'Сначала дождитесь завершения срока текущей операции': 'Wait until the current operation window closes',
    'Можно начать не более трёх операций за сутки': 'You can start up to three operations per day',
    'Операция не найдена': 'Operation not found',
    'Завершённую операцию нельзя отменить': 'A completed operation cannot be cancelled',
    'Блокировка изменилась после обращения. Отклоните старую апелляцию.': 'The ban changed after this report. Dismiss the outdated appeal.',

    "Бюро не найдено": "Bureau not found",
    "Недостаточно прав в этом бюро": "You do not have permission in this bureau",
    "Действие доступно только директору бюро": "Only the bureau director can do this",
    "Данные бюро изменились. Обновите страницу и повторите действие.": "Bureau data changed. Refresh and try again.",
    "Можно состоять только в одном бюро": "You can belong to only one bureau",
    "В бюро закончились места": "This bureau is full",
    "Название бюро должно содержать слово Deadlock": "The bureau name must contain the word Deadlock",
    "Этот адрес бюро уже занят": "This bureau address is already taken",
    "Набор в бюро закрыт": "Recruitment is closed",
    "Можно отправить не более пяти заявок одновременно": "You can have at most five pending applications",
    "Заявка уже обработана или не найдена": "Application already processed or not found",
    "Участник не найден": "Member not found",
    "Укажите причину исключения": "Enter a reason for removing this member",
    "Сначала передайте руководство или распустите бюро": "Transfer leadership or disband the bureau first",
    "Для удаления введите адрес бюро": "Type the bureau address to disband it",
    "Витрины не должны повторяться": "Each showcase must appear once",
    "Закрепить можно только свои завершённые контракты с наградой": "You can pin only your own completed, awarded contracts",
    "Сначала получите эту печать": "Earn this seal before featuring it",

    "Внутренняя ошибка сервиса": "Internal service error",
    "Некорректные параметры запроса": "Invalid request parameters",
    "Неизвестный часовой пояс": "Unknown time zone",
    "Требуется вход через Steam": "Sign in through Steam is required",
    "Проверка безопасности запроса не пройдена": "Request security validation failed",
    "Сессия входа устарела или была подменена. Начните вход заново.": "The sign-in session expired or was changed. Start sign-in again.",
    "Сессия входа уже использована или устарела. Начните вход заново.": "The sign-in session was already used or expired. Start sign-in again.",
    "Сессия входа устарела. Начните вход заново.": "The sign-in session expired. Start sign-in again.",
    "Некорректный ответ Steam": "Steam returned an invalid response",
    "Steam не подтвердил вход": "Steam did not confirm the sign-in",
    "Некорректное пространство имён OpenID": "Invalid OpenID namespace",
    "Ответ получен не от ожидаемого OpenID endpoint": "The response did not come from the expected OpenID endpoint",
    "OpenID return_to не совпадает с ожидаемым адресом": "OpenID return_to does not match the expected address",
    "В ответе Steam отсутствует nonce": "The Steam response is missing a nonce",
    "Steam не вернул согласованный идентификатор": "Steam did not return the agreed identifier",
    "Steam временно не отвечает. Повторите вход позже.": "Steam is temporarily unavailable. Try signing in later.",
    "Подпись Steam OpenID недействительна": "The Steam OpenID signature is invalid",
    "Некорректный SteamID в OpenID-ответе": "The OpenID response contains an invalid SteamID",
    "Некорректный SteamID": "Invalid SteamID",
    "Закрытая альфа: этот Steam-аккаунт пока не приглашён": "Closed alpha: this Steam account has not been invited yet",
    "Аккаунт недоступен": "The account is unavailable",
    "Аккаунт заблокирован": "The account is suspended",
    "Пользователь не найден": "User not found",
    "Некорректный код привязки": "Invalid pairing code",
    "Код привязки истёк или уже использован": "The pairing code expired or was already used",
    "Companion token отсутствует": "The Companion token is missing",
    "Companion token недействителен": "The Companion token is invalid",
    "Требуется Bearer token Companion": "A Companion bearer token is required",
    "Пользователь Companion не найден": "Companion user not found",
    "Владелец Companion не найден": "Companion owner not found",
    "Companion отключён": "Companion is disconnected",
    "Companion не найден": "Companion not found",
    "Приём данных Companion временно отключён": "Companion ingestion is temporarily disabled",
    "Требуется обновление Companion": "A Companion update is required",
    "Неизвестный режим матча": "Unknown match mode",
    "Доска не найдена": "Board not found",
    "После фиксации дела эту доску пересобрать нельзя": "This board cannot be rerolled after the case is locked",
    "Бесплатная пересборка на сегодня уже использована": "Today's free reroll has already been used",
    "Дело этого режима уже зафиксировано": "A case for this mode is already locked",
    "Доска уже обновилась. Откройте новую подборку": "The board has refreshed. Open the new selection.",
    "Нужно выбрать от 1 до 3 контрактов": "Choose between 1 and 3 contracts",
    "Выбран контракт не с текущей доски": "A selected contract does not belong to the current board",
    "Этот public handle уже занят": "This public handle is already taken",
    "Steam Web API key не настроен на сервере": "The Steam Web API key is not configured on the server",
    "SteamID пользователя отсутствует": "The user's SteamID is missing",
    "Сначала зафиксируйте контракты этого режима": "Lock contracts for this mode first",
    "Сначала выберите и зафиксируйте контракты этого режима": "Choose and lock contracts for this mode first",
    "Дело этого режима уже закрыто": "The case for this mode is already closed",
    "Ручная отправка доказательств отключена. Если данных матча не хватит, система создаст внутреннюю заявку автоматически.": "Manual evidence uploads are disabled. If match data is incomplete, the system opens an internal review automatically.",
    "Ручная проверка отключена в v0.3": "Manual verification is disabled",
    "Требуется доступ администратора": "Administrator access is required",
    "Административная сессия отсутствует": "The administrative session is missing",
    "Административная сессия устарела": "The administrative session expired",
    "Требуется подтверждение TOTP для административного доступа": "TOTP confirmation is required for administrative access",
    "Требуется доступ владельца проекта": "Project owner access is required",
    "Неверный одноразовый код": "Invalid one-time code",
    "Задача не найдена": "Job not found",
    "Дело не найдено": "Case not found",
    "Матч не найден": "Match not found",
    "Внутренняя заявка не найдена": "Internal review case not found",
    "Заявка уже закрыта": "The review case is already closed",
    "Нет изменений": "No changes were provided",
    "Фактических изменений нет": "Nothing changed",
    "API endpoint не найден": "API endpoint not found",
    "Endpoint авторизации не найден": "Authentication endpoint not found",
    "Документация API отключена": "API documentation is disabled",
    "Общий rate limiter недоступен": "The shared rate limiter is unavailable",
}

DETAIL_ERROR_CODES = {
    "Требуется вход через Steam": "AUTH_REQUIRED",
    "Проверка безопасности запроса не пройдена": "CSRF_REJECTED",
    "Аккаунт заблокирован": "ACCOUNT_SUSPENDED",
    "Некорректный код привязки": "PAIRING_CODE_INVALID",
    "Код привязки истёк или уже использован": "PAIRING_CODE_EXPIRED",
    "Companion token отсутствует": "COMPANION_TOKEN_MISSING",
    "Companion token недействителен": "COMPANION_TOKEN_INVALID",
    "Требуется Bearer token Companion": "COMPANION_AUTH_REQUIRED",
    "Companion отключён": "COMPANION_REVOKED",
    "Приём данных Companion временно отключён": "COMPANION_INGEST_DISABLED",
    "Требуется обновление Companion": "COMPANION_UPDATE_REQUIRED",
    "Неизвестный режим матча": "MATCH_MODE_UNKNOWN",
    "Доска не найдена": "BOARD_NOT_FOUND",
    "После фиксации дела эту доску пересобрать нельзя": "BOARD_ALREADY_LOCKED",
    "Бесплатная пересборка на сегодня уже использована": "REROLL_ALREADY_USED",
    "Дело этого режима уже зафиксировано": "ACTIVE_CASE_EXISTS",
    "Доска уже обновилась. Откройте новую подборку": "BOARD_STALE",
    "Нужно выбрать от 1 до 3 контрактов": "SELECTION_COUNT_INVALID",
    "Выбран контракт не с текущей доски": "SELECTION_STALE",
    "Этот public handle уже занят": "PROFILE_SLUG_TAKEN",
    "Сначала зафиксируйте контракты этого режима": "BOARD_LOCK_REQUIRED",
    "Требуется доступ администратора": "ADMIN_REQUIRED",
    "Требуется подтверждение TOTP для административного доступа": "ADMIN_TOTP_REQUIRED",
    "Внутренняя ошибка сервиса": "INTERNAL_ERROR",
    "Некорректные параметры запроса": "VALIDATION_FAILED",
    "Неизвестный часовой пояс": "TIMEZONE_INVALID",
}


PATTERNS = (
    (re.compile(r"^Неподдерживаемый social link: (.+)$"), r"Unsupported social link: \1"),
    (re.compile(r"^Ссылка (.+) слишком длинная$"), r"The \1 link is too long"),
    (
        re.compile(r"^Для (.+) разрешена только официальная HTTPS-ссылка$"),
        r"Only an official HTTPS link is allowed for \1",
    ),
)


def request_language(accept_language: str | None) -> str:
    for item in str(accept_language or "").split(","):
        tag = item.split(";", 1)[0].strip().lower()
        if tag == "ru" or tag.startswith("ru-"):
            return "ru"
        if tag == "en" or tag.startswith("en-"):
            return "en"
    return "ru"


def localize_detail(detail: Any, language: str) -> Any:
    if language != "en" or not isinstance(detail, str):
        return detail
    translated = RU_TO_EN.get(detail)
    if translated is not None:
        return translated
    for pattern, replacement in PATTERNS:
        if pattern.match(detail):
            return pattern.sub(replacement, detail)
    return detail


def error_metadata(detail: Any, status_code: int, language: str) -> dict[str, str]:
    original = detail if isinstance(detail, str) else ""
    defaults = {
        400: "BAD_REQUEST",
        401: "AUTH_REQUIRED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        410: "GONE",
        413: "PAYLOAD_TOO_LARGE",
        422: "VALIDATION_FAILED",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
        502: "UPSTREAM_ERROR",
        503: "SERVICE_UNAVAILABLE",
    }
    code = DETAIL_ERROR_CODES.get(original, defaults.get(status_code, f"HTTP_{status_code}"))
    message = localize_detail(detail, language)
    if not isinstance(message, str):
        message = "Request failed" if language == "en" else "Запрос не выполнен"
    return {
        "code": code,
        "message_key": f"errors.{code.lower()}",
        "message": message,
    }

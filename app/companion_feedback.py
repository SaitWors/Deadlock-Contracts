from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from . import seo
from .config import settings
from .db import get_db
from .models import AuditLog

router = APIRouter(include_in_schema=False)
SURVEY_PATH = "/companion/uninstall"
REASONS = {
    "reinstalling": "I’m reinstalling it.",
    "technical_issues": "I ran into technical issues.",
    "setup": "I had trouble connecting or getting started.",
    "not_useful": "I no longer use the Companion.",
    "ads": "The ads affected my experience.",
    "other": "Something else.",
}


@router.get(SURVEY_PATH)
def uninstall_survey(submitted: bool = False, skipped: bool = False) -> HTMLResponse:
    if submitted:
        content = '<h1>Thanks for your feedback</h1><p>You can close this tab.</p>'
    elif skipped:
        content = '<h1>Survey skipped</h1><p>You can close this tab.</p>'
    else:
        choices = "".join(
            f'<label><input type="radio" name="reason" value="{key}" required> {label}</label>'
            for key, label in REASONS.items()
        )
        content = (
            '<h1>Why did you uninstall the Companion?</h1>'
            '<p>Your answer helps improve setup and match tracking. This survey is optional and anonymous.</p>'
            '<form class="uninstall-survey" method="post" action="/api/feedback/companion-uninstall">'
            f'<fieldset><legend>Choose one reason</legend>{choices}</fieldset>'
            '<label for="comment">Anything else? (Optional)</label>'
            '<textarea id="comment" name="comment" rows="4" maxlength="500" '
            'aria-describedby="survey-hint"></textarea>'
            '<p id="survey-hint">Please leave out contact details and account information.</p>'
            '<button class="ghost-button" type="submit">Send feedback</button> '
            '<a class="ghost-button" href="/companion/uninstall?skipped=true">Skip survey</a></form>'
        )
    return HTMLResponse(
        seo.render_document(
            title="Companion feedback | Deadlock Contracts",
            description="Optional feedback after uninstalling the Deadlock Contracts Companion.",
            body=(
                '<div class="legal-page shell"><main class="legal-document">'
                f'<p class="eyebrow">Deadlock Contracts Companion</p>{content}'
                '<p><a href="/en/support">Get support</a></p></main></div>'
            ),
            language="en",
            base=settings.app_base_url,
            path=None,
            index=False,
            shell=(
                '<!doctype html><html lang="en"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
                '<body class="ns-static ns-documents"><div id="root"></div></body></html>'
            ),
        ),
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "same-origin",
            "X-Robots-Tag": "noindex, nofollow",
        },
    )


async def survey_response(request: Request) -> dict[str, str]:
    if request.headers.get("content-type", "").partition(";")[0] != "application/x-www-form-urlencoded":
        raise HTTPException(415, "Unsupported survey format")
    body = await request.body()
    if len(body) > 8192:
        raise HTTPException(413, "Survey response is too large")
    try:
        fields = parse_qs(
            body.decode("ascii"), encoding="utf-8", errors="strict",
            max_num_fields=2, strict_parsing=True, keep_blank_values=True,
        )
    except ValueError as exc:
        raise HTTPException(422, "Invalid survey response") from exc
    if fields.keys() - {"reason", "comment"} or any(len(values) != 1 for values in fields.values()):
        raise HTTPException(422, "Invalid survey response")
    reason = fields.get("reason", [""])[0]
    comment = fields.get("comment", [""])[0].strip()
    if reason not in REASONS:
        raise HTTPException(422, "Choose a survey reason")
    if len(comment) > 500 or any(ord(char) < 32 and char not in "\n\r\t" for char in comment):
        raise HTTPException(422, "Enter a comment of up to 500 characters")
    # Store plain text in JSON. The survey page never renders submitted responses.
    return {"reason": reason, **({"comment": comment} if comment else {})}


@router.post("/api/feedback/companion-uninstall")
def submit_uninstall_survey(
    feedback: dict[str, str] = Depends(survey_response), db: Session = Depends(get_db)
) -> RedirectResponse:
    db.add(AuditLog(
        action="companion.uninstall_feedback",
        entity_type="companion",
        entity_id="uninstall",
        data=feedback,
    ))
    db.commit()
    return RedirectResponse(f"{SURVEY_PATH}?submitted=true", status_code=303)

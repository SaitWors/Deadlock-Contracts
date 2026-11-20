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
def uninstall_survey(submitted: bool = False) -> HTMLResponse:
    if submitted:
        content = '<h1>Thanks for your feedback</h1><p>You can close this tab.</p>'
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
            '<button class="ghost-button" type="submit">Send feedback</button></form>'
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


async def survey_reason(request: Request) -> str:
    if request.headers.get("content-type", "").partition(";")[0] != "application/x-www-form-urlencoded":
        raise HTTPException(415, "Unsupported survey format")
    body = await request.body()
    if len(body) > 128:
        raise HTTPException(413, "Survey response is too large")
    try:
        reasons = parse_qs(body.decode("ascii"), max_num_fields=1).get("reason", [])
    except ValueError as exc:
        raise HTTPException(422, "Invalid survey response") from exc
    if len(reasons) != 1 or reasons[0] not in REASONS:
        raise HTTPException(422, "Choose a survey reason")
    return reasons[0]


@router.post("/api/feedback/companion-uninstall")
def submit_uninstall_survey(
    reason: str = Depends(survey_reason), db: Session = Depends(get_db)
) -> RedirectResponse:
    db.add(AuditLog(
        action="companion.uninstall_feedback",
        entity_type="companion",
        entity_id="uninstall",
        data={"reason": reason},
    ))
    db.commit()
    return RedirectResponse(f"{SURVEY_PATH}?submitted=true", status_code=303)

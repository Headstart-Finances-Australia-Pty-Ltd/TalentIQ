"""
TalentIQ — Shared SMTP email sending.

Extracted out of routers/joblens.py (where it originated as a private
helper for the Video Interview "Send Interview Invite" action) so the
Interview Management capability can reuse the exact same SMTP plumbing
for Calendly-link emails — Phone Interview's "Send Calendly Link" and
Interview Scheduling's "Email Calendly Link" — instead of a second,
drifting copy of the same smtplib code.

routers/joblens.py re-exports _get_smtp_config / _send_email from here
(same names, so nothing else in that file needs to change) purely for
backwards compatibility with anything importing them from there.
"""
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from utils.credentials import get_all_credentials


async def get_smtp_config(user_id: int, db: AsyncSession) -> dict:
    # SMTP is strictly private — never shared, never falls back to another
    # user's or admin's credentials (see utils/credentials.py policy).
    return await get_all_credentials(db, user_id, "smtp")


def send_email(smtp_cfg: dict, to_email: str, subject: str, html_body: str):
    host = smtp_cfg.get("host")
    port = int(smtp_cfg.get("port") or 587)
    username = smtp_cfg.get("username")
    password = smtp_cfg.get("password")
    from_email = smtp_cfg.get("from_email") or username

    if not (host and username and password and from_email):
        raise HTTPException(
            400,
            "SMTP is not configured. Add credentials in Settings > API Keys "
            "(service: smtp; key names: host, port, username, password, from_email).",
        )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.starttls()
            server.login(username, password)
            server.sendmail(from_email, [to_email], msg.as_string())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to send email: {str(e)[:200]}")

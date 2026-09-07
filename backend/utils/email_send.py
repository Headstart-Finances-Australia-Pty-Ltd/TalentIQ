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
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from utils.credentials import get_all_credentials, get_global_credentials


async def get_smtp_config(user_id: int, db: AsyncSession) -> dict:
    # SMTP is strictly private — never shared, never falls back to another
    # user's or admin's credentials (see utils/credentials.py policy).
    return await get_all_credentials(db, user_id, "smtp")


async def get_system_smtp_config(db: AsyncSession) -> dict:
    """The platform's own mailbox for account-lifecycle system email
    (signup verification, resend-verification) — admin-configured under
    Admin Console > API Keys (service: system_smtp), pure global lookup,
    no per-user override (see utils/credentials.py's SHAREABLE_SERVICES
    docstring)."""
    return await get_global_credentials(db, "system_smtp")


def frontend_base_url() -> str:
    """Base URL used to build links inside system emails (verification,
    etc). Sourced from FRONTEND_URL if set (recommended for production —
    Northflank exposes a public URL that differs from any backend-internal
    one); falls back to localhost for local dev so this never crashes
    with an unset env var."""
    return os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def send_verification_email(smtp_cfg: dict, to_email: str, name: str, token: str):
    link = f"{frontend_base_url()}/verify-email?token={token}"
    subject = "Verify your email — TalentIQ Solution"
    html_body = f"""
    <div style="font-family: -apple-system, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#00c7b7;">Confirm your email</h2>
      <p>Hi {name or ''},</p>
      <p>Thanks for creating a TalentIQ Solution account. Click the button below to verify
      your email address and activate your account — you won't be able to log in until it's confirmed.</p>
      <p style="text-align:center; margin: 28px 0;">
        <a href="{link}" style="background:#00c7b7; color:#fff; padding:12px 24px; border-radius:8px;
           text-decoration:none; font-weight:600; display:inline-block;">Verify email address</a>
      </p>
      <p style="font-size:12px; color:#6b7280;">Or paste this link into your browser:<br>{link}</p>
      <p style="font-size:12px; color:#6b7280;">This link expires in 24 hours. If you didn't create this
      account, you can safely ignore this email.</p>
    </div>
    """
    send_email(
        smtp_cfg, to_email, subject, html_body,
        unconfigured_hint=(
            "The platform's system mailbox (System Email / SMTP) hasn't been configured yet. "
            "An admin needs to set it up under Admin Console > API Keys > System Email "
            "(service: system_smtp; key names: host, port, username, password, from_email) "
            "before signups can be verified."
        ),
    )


def send_email(smtp_cfg: dict, to_email: str, subject: str, html_body: str, unconfigured_hint: str = None):
    host = smtp_cfg.get("host")
    port = int(smtp_cfg.get("port") or 587)
    username = smtp_cfg.get("username")
    password = smtp_cfg.get("password")
    from_email = smtp_cfg.get("from_email") or username

    if not (host and username and password and from_email):
        raise HTTPException(
            400,
            unconfigured_hint or (
                "SMTP is not configured. Add credentials in Settings > API Keys "
                "(service: smtp; key names: host, port, username, password, from_email)."
            ),
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
        # Catch-all (not just smtplib.SMTPAuthenticationError specifically)
        # because some providers/paths surface an auth rejection as a
        # different smtplib exception subtype (e.g. a generic
        # SMTPResponseException, or one raised while cleaning up the
        # connection after the real auth failure already happened) —
        # matching on the actual error text is more reliable than
        # trusting the exact class raised. This is the exact same
        # smtp_cfg / send_email() used for every email TalentIQ sends
        # (video interview invites, Phone Interview's Send Calendly Link,
        # Interview Scheduling's Email Calendly Link), so it fails
        # identically everywhere until the credentials are fixed.
        text = str(e)
        auth_failure = (
            isinstance(e, smtplib.SMTPAuthenticationError)
            or "535" in text
            or "bad credentials" in text.lower()
            or "username and password not accepted" in text.lower()
        )
        if auth_failure:
            raise HTTPException(
                400,
                "Gmail rejected these SMTP credentials (535 Bad Credentials). Gmail no longer accepts a plain "
                "account password for SMTP — generate a 16-character App Password instead: Google Account -> "
                "Security -> 2-Step Verification -> App passwords, then update it under Settings -> API Keys -> "
                "SMTP. (Or switch to a transactional email provider like SendGrid/Postmark/Resend/SES.)",
            )
        raise HTTPException(500, f"Failed to send email: {text[:200]}")

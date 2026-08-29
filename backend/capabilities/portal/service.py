"""Service helpers for Client & Vendor Collaboration (Phase 6)."""
import secrets
import string


def generate_portal_token() -> str:
    """Same pattern as every other public-link token in this app
    (Candidate.portal_token, Requisition.hm_view_token, Interview's
    self-schedule token) — a long random string IS the auth."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(48))


def redact_candidate_contact(candidate_dict: dict) -> dict:
    """Strips direct contact details before anything is shown in the
    CLIENT portal — an agency convention: the client sees who's
    available and can approve/reject/interview them, but can't email or
    call the candidate directly and route around the agency before a
    placement is settled. Vendor-facing views don't need this (a vendor
    submitted the candidate in the first place)."""
    redacted = dict(candidate_dict)
    redacted.pop("email", None)
    redacted.pop("phone", None)
    redacted.pop("linkedin_url", None)
    return redacted

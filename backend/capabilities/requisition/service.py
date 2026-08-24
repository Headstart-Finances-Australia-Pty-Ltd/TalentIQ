import secrets
import string
from datetime import datetime

from .models import REQUISITION_STATUS_TRANSITIONS


def validate_status_transition(current: str, target: str) -> None:
    """Raises ValueError if the transition isn't one of the allowed forward
    moves — keeps the approval workflow honest (e.g. can't jump Draft ->
    Filled without ever being Approved/Open)."""
    if target == current:
        return
    allowed = REQUISITION_STATUS_TRANSITIONS.get(current, [])
    if target not in allowed:
        raise ValueError(
            f"Cannot move a requisition from '{current}' to '{target}'. "
            f"Allowed next steps from '{current}': {', '.join(allowed) or 'none (terminal status)'}."
        )


def generate_view_token() -> str:
    """Same pattern as the candidate portal token — a long random string IS
    the auth, no separate hiring-manager login system needed."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(48))

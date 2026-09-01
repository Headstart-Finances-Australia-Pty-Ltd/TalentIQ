"""
Job Ads — a job posting that can be pushed to external channels
(LinkedIn, Seek) instead of being re-typed into each site separately.

Posting to LinkedIn or Seek's real job-posting APIs requires that
platform's own partner-level API access (an approved LinkedIn Talent
Solutions integration, or a Seek Partner API agreement) — not something
any user account has by default. This module builds the real
infrastructure (the ad itself, per-channel status, the actual API call
shape) and reports clearly when a channel's credentials aren't
configured, rather than faking a posted status. See routers/job_ads.py.
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Float
from db.database import Base


class JobAd(Base):
    __tablename__ = "tiq_job_ads"

    id                = Column(Integer, primary_key=True, index=True)
    user_id           = Column(Integer, ForeignKey("tiq_users.id"), index=True, nullable=False)
    requisition_id    = Column(Integer, ForeignKey("tiq_requisitions.id"), nullable=True)  # optional — a job ad can exist standalone

    title             = Column(String(300), nullable=False)
    description       = Column(Text)
    location          = Column(String(300))
    employment_type   = Column(String(100))
    salary_min        = Column(Float, nullable=True)
    salary_max        = Column(Float, nullable=True)

    # Per-channel state — "Not Posted" | "Posted" | "Failed". Kept as two
    # plain columns (not a generic JSON blob) since exactly these two
    # channels are supported today and each needs its own external
    # post id/URL/error message alongside its status.
    linkedin_status   = Column(String(20), default="Not Posted")
    linkedin_post_url = Column(String(500), default="")
    linkedin_error    = Column(Text, default="")

    seek_status       = Column(String(20), default="Not Posted")
    seek_post_url     = Column(String(500), default="")
    seek_error        = Column(Text, default="")

    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

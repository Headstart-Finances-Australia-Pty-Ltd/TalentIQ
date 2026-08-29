from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class RequisitionCreate(BaseModel):
    title: str
    client_id: Optional[int] = None
    jd_record_id: Optional[int] = None
    priority: str = "Normal"
    vacancy_count: int = 1
    reason_for_hire: str = ""
    employment_type: str = ""
    location: str = ""
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    target_hire_date: Optional[datetime] = None
    hiring_manager_contact_id: Optional[int] = None
    hiring_manager_name: str = ""
    hiring_manager_email: str = ""
    notes: str = ""


class RequisitionUpdate(BaseModel):
    title: Optional[str] = None
    client_id: Optional[int] = None
    jd_record_id: Optional[int] = None
    priority: Optional[str] = None
    vacancy_count: Optional[int] = None
    reason_for_hire: Optional[str] = None
    employment_type: Optional[str] = None
    location: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    target_hire_date: Optional[datetime] = None
    hiring_manager_contact_id: Optional[int] = None
    hiring_manager_name: Optional[str] = None
    hiring_manager_email: Optional[str] = None
    notes: Optional[str] = None


class RequisitionStatusChange(BaseModel):
    status: str


class ChecklistUpdate(BaseModel):
    salary_approved: Optional[bool] = None
    headcount_approved: Optional[bool] = None
    jd_approved: Optional[bool] = None
    location_confirmed: Optional[bool] = None


class ClientContactCreate(BaseModel):
    client_id: int
    name: str
    title: str = ""
    email: str = ""
    phone: str = ""
    department: str = ""
    is_primary: bool = False
    notes: str = ""


class ClientContactUpdate(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    is_primary: Optional[bool] = None
    notes: Optional[str] = None


class BulkIds(BaseModel):
    ids: List[int]

from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    username: str


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class EventCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    event_date: date
    details: str = Field(default="", max_length=500)


class EventUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    event_date: Optional[date] = None
    details: Optional[str] = Field(default=None, max_length=500)


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    event_date: date
    details: str
    registration_count: int
    status: str


class StudentCreate(BaseModel):
    student_id: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=2, max_length=120)
    details: str = Field(default="", max_length=500)


class StudentUpdate(BaseModel):
    student_id: Optional[str] = Field(default=None, min_length=2, max_length=50)
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    details: Optional[str] = Field(default=None, max_length=500)


class StudentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: str
    name: str
    details: str


class RegistrationCreate(BaseModel):
    student_id: str = Field(min_length=2, max_length=50)
    student_name: str = Field(min_length=2, max_length=120)
    event_id: int


class RegistrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    student_id: str
    student_name: str
    student_details: Optional[str] = ""
    event_id: int
    event_code: str
    event_name: str
    event_date: date
    created_at: Optional[str] = None


class SearchResult(BaseModel):
    type: str
    name: str
    event_date: Optional[date] = None
    student_id: Optional[str] = None
    information: str


class ReportOut(BaseModel):
    event: EventOut
    total_registrations: int
    participants: list[RegistrationOut]


class DashboardOut(BaseModel):
    total_events: int
    total_registrations: int
    total_participants: int
    events: list[EventOut]

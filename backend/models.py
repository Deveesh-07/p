from datetime import datetime, timezone

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from backend.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(120), nullable=False)
    username = Column(String(80), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    sessions = relationship("SessionToken", back_populates="user", cascade="all, delete-orphan")


class SessionToken(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    user = relationship("User", back_populates="sessions")


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True)
    code = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(150), nullable=False)
    event_date = Column(Date, nullable=False)
    details = Column(String(500), default="", nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    registrations = relationship(
        "Registration",
        back_populates="event",
        cascade="all, delete-orphan",
    )


class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True)
    student_id = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    details = Column(String(500), default="", nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    registrations = relationship(
        "Registration",
        back_populates="student",
        cascade="all, delete-orphan",
    )


class Registration(Base):
    __tablename__ = "registrations"
    __table_args__ = (
        UniqueConstraint("student_pk", "event_id", name="uq_student_event"),
    )

    id = Column(Integer, primary_key=True)
    student_pk = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    student = relationship("Student", back_populates="registrations")
    event = relationship("Event", back_populates="registrations")

from datetime import date

from sqlalchemy.orm import Session

from backend.auth import hash_password
from backend.models import Event, Registration, Student, User


def seed_if_empty(db: Session) -> None:
    if db.query(User).count() == 0:
        db.add(
            User(
                full_name="Authorized User",
                username="admin",
                password_hash=hash_password("admin123"),
            )
        )

    if db.query(Event).count() == 0:
        events = [
            Event(code="EV-001", name="Technical Symposium", event_date=date(2026, 9, 10), details="College technical event"),
            Event(code="EV-002", name="Cultural Fest", event_date=date(2026, 9, 15), details="College cultural event"),
            Event(code="EV-003", name="Sports Meet", event_date=date(2026, 9, 20), details="College sports event"),
            Event(code="EV-004", name="Project Expo", event_date=date(2026, 9, 25), details="Student project event"),
            Event(code="EV-005", name="Coding Contest", event_date=date(2026, 10, 2), details="Programming event"),
            Event(code="EV-006", name="Quiz Competition", event_date=date(2026, 10, 5), details="General quiz event"),
        ]
        db.add_all(events)
        db.flush()

        students = [
            Student(student_id="STU001", name="Arun Kumar", details="Computer Science"),
            Student(student_id="STU002", name="Priya S", details="Electronics"),
            Student(student_id="STU003", name="Rahul M", details="Information Technology"),
            Student(student_id="STU004", name="Divya R", details="Mechanical"),
            Student(student_id="STU005", name="Karthik P", details="Civil"),
        ]
        db.add_all(students)
        db.flush()

        event_by_code = {event.code: event for event in events}
        student_by_id = {student.student_id: student for student in students}
        db.add_all(
            [
                Registration(student_pk=student_by_id["STU001"].id, event_id=event_by_code["EV-001"].id),
                Registration(student_pk=student_by_id["STU002"].id, event_id=event_by_code["EV-001"].id),
                Registration(student_pk=student_by_id["STU003"].id, event_id=event_by_code["EV-002"].id),
                Registration(student_pk=student_by_id["STU004"].id, event_id=event_by_code["EV-003"].id),
                Registration(student_pk=student_by_id["STU005"].id, event_id=event_by_code["EV-004"].id),
            ]
        )

    db.commit()

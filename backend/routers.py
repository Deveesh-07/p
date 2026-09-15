from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from fastapi.security import HTTPAuthorizationCredentials

from backend.auth import bearer_scheme, create_session, get_current_user, hash_password, verify_password
from backend.database import get_db
from backend.models import Event, Registration, SessionToken, Student, User
from backend.schemas import (
    AuthResponse,
    DashboardOut,
    EventCreate,
    EventOut,
    EventUpdate,
    LoginRequest,
    RegisterRequest,
    RegistrationCreate,
    RegistrationOut,
    ReportOut,
    SearchResult,
    StudentCreate,
    StudentOut,
    StudentUpdate,
    UserOut,
)

router = APIRouter(prefix="/api")


def event_status(event_date: date) -> str:
    return "Upcoming" if event_date >= date.today() else "Completed"


def to_event_out(event: Event) -> EventOut:
    return EventOut(
        id=event.id,
        code=event.code,
        name=event.name,
        event_date=event.event_date,
        details=event.details or "",
        registration_count=len(event.registrations),
        status=event_status(event.event_date),
    )


def to_registration_out(row: Registration) -> RegistrationOut:
    return RegistrationOut(
        id=row.id,
        student_id=row.student.student_id,
        student_name=row.student.name,
        student_details=row.student.details or "",
        event_id=row.event.id,
        event_code=row.event.code,
        event_name=row.event.name,
        event_date=row.event.event_date,
        created_at=row.created_at.strftime("%d %b %Y, %I:%M %p") if row.created_at else None,
    )


def next_event_code(db: Session) -> str:
    events = db.query(Event.code).all()
    max_num = 0
    for (code,) in events:
        if code and code.startswith("EV-"):
            try:
                num = int(code.split("-")[1])
                if num > max_num:
                    max_num = num
            except (IndexError, ValueError):
                pass
    return f"EV-{max_num + 1:03d}"


def get_or_create_student(db: Session, student_id: str, name: str) -> Student:
    clean_id = student_id.strip()
    clean_name = name.strip()
    student = db.query(Student).filter(func.lower(Student.student_id) == clean_id.lower()).first()
    if student:
        if clean_name and student.name != clean_name:
            student.name = clean_name
        return student
    student = Student(student_id=clean_id, name=clean_name, details="")
    db.add(student)
    db.flush()
    return student


@router.post("/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    existing = db.query(User).filter(func.lower(User.username) == username.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists.")

    user = User(
        full_name=payload.full_name.strip(),
        username=username,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_session(db, user)
    return AuthResponse(token=token, user=UserOut.model_validate(user))


@router.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .filter(func.lower(User.username) == payload.username.strip().lower())
        .first()
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = create_session(db, user)
    return AuthResponse(token=token, user=UserOut.model_validate(user))


@router.post("/auth/logout")
def logout(
    _user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    if credentials is not None:
        db.query(SessionToken).filter(SessionToken.token == credentials.credentials).delete()
        db.commit()
    return {"message": "Logged out."}


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    events = (
        db.query(Event)
        .options(joinedload(Event.registrations))
        .order_by(Event.event_date.asc())
        .all()
    )
    return DashboardOut(
        total_events=len(events),
        total_registrations=db.query(Registration).count(),
        total_participants=db.query(Student).count(),
        events=[to_event_out(event) for event in events],
    )


@router.get("/events", response_model=list[EventOut])
def list_events(
    q: str = Query(default=""),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Event).options(joinedload(Event.registrations))
    term = q.strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(Event.name.ilike(like), Event.code.ilike(like), Event.details.ilike(like))
        )
    events = query.order_by(Event.event_date.asc()).all()
    return [to_event_out(event) for event in events]


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Event name must be at least 2 characters.")
    event = Event(
        code=next_event_code(db),
        name=name,
        event_date=payload.event_date,
        details=(payload.details or "").strip(),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    event = db.query(Event).options(joinedload(Event.registrations)).filter(Event.id == event.id).one()
    return to_event_out(event)


@router.put("/events/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    payload: EventUpdate,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).options(joinedload(Event.registrations)).filter(Event.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    if payload.name is not None:
        name = payload.name.strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Event name must be at least 2 characters.")
        event.name = name
    if payload.event_date is not None:
        event.event_date = payload.event_date
    if payload.details is not None:
        event.details = payload.details.strip()
    db.commit()
    db.refresh(event)
    return to_event_out(event)


@router.delete("/events/{event_id}")
def delete_event(
    event_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    db.delete(event)
    db.commit()
    return {"message": "Event deleted."}


@router.get("/students", response_model=list[StudentOut])
def list_students(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    students = db.query(Student).order_by(Student.student_id.asc()).all()
    return [StudentOut.model_validate(student) for student in students]


@router.post("/students", response_model=StudentOut)
def upsert_student(
    payload: StudentCreate,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    student_id = payload.student_id.strip()
    name = payload.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Student name must be at least 2 characters.")
    if len(student_id) < 2:
        raise HTTPException(status_code=400, detail="Student ID must be at least 2 characters.")
    student = db.query(Student).filter(func.lower(Student.student_id) == student_id.lower()).first()
    if student:
        student.name = name
        student.details = (payload.details or "").strip()
    else:
        student = Student(
            student_id=student_id,
            name=name,
            details=(payload.details or "").strip(),
        )
        db.add(student)
    db.commit()
    db.refresh(student)
    return StudentOut.model_validate(student)


@router.put("/students/{student_pk}", response_model=StudentOut)
def update_student(
    student_pk: int,
    payload: StudentUpdate,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    student = db.query(Student).filter(Student.id == student_pk).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")
    if payload.student_id is not None:
        new_sid = payload.student_id.strip()
        if len(new_sid) < 2:
            raise HTTPException(status_code=400, detail="Student ID must be at least 2 characters.")
        existing = db.query(Student).filter(
            func.lower(Student.student_id) == new_sid.lower(),
            Student.id != student_pk,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="A student with this Student ID already exists.")
        student.student_id = new_sid
    if payload.name is not None:
        new_name = payload.name.strip()
        if len(new_name) < 2:
            raise HTTPException(status_code=400, detail="Student name must be at least 2 characters.")
        student.name = new_name
    if payload.details is not None:
        student.details = payload.details.strip()
    db.commit()
    db.refresh(student)
    return StudentOut.model_validate(student)


@router.delete("/students/{student_pk}")
def delete_student(
    student_pk: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    student = db.query(Student).filter(Student.id == student_pk).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")
    db.delete(student)
    db.commit()
    return {"message": "Student deleted."}


@router.get("/registrations", response_model=list[RegistrationOut])
def list_registrations(
    event_id: int | None = None,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Registration).options(joinedload(Registration.student), joinedload(Registration.event))
    if event_id is not None:
        query = query.filter(Registration.event_id == event_id)
    rows = query.order_by(Registration.id.asc()).all()
    return [to_registration_out(row) for row in rows]


@router.post("/registrations", response_model=RegistrationOut, status_code=status.HTTP_201_CREATED)
def register_student(
    payload: RegistrationCreate,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == payload.event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Selected event was not found.")

    student_id = payload.student_id.strip()
    student_name = payload.student_name.strip()
    if len(student_id) < 2:
        raise HTTPException(status_code=400, detail="Student ID must be at least 2 characters.")
    if len(student_name) < 2:
        raise HTTPException(status_code=400, detail="Student name must be at least 2 characters.")

    student = get_or_create_student(db, student_id, student_name)

    duplicate = (
        db.query(Registration)
        .filter(Registration.student_pk == student.id, Registration.event_id == event.id)
        .first()
    )
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="This student is already registered for the selected event.",
        )

    row = Registration(student_pk=student.id, event_id=event.id)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="This student is already registered for the selected event.",
        )
    db.refresh(row)
    row = (
        db.query(Registration)
        .options(joinedload(Registration.student), joinedload(Registration.event))
        .filter(Registration.id == row.id)
        .one()
    )
    return to_registration_out(row)


@router.delete("/registrations/{registration_id}")
def delete_registration(
    registration_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(Registration).filter(Registration.id == registration_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Registration record not found.")
    db.delete(row)
    db.commit()
    return {"message": "Registration deleted."}


@router.get("/search", response_model=list[SearchResult])
def search(
    q: str = Query(default=""),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    term = q.strip()
    if not term:
        return []
    like = f"%{term}%"
    results: list[SearchResult] = []

    events = db.query(Event).filter(
        or_(Event.name.ilike(like), Event.code.ilike(like), Event.details.ilike(like))
    ).all()
    for event in events:
        results.append(
            SearchResult(
                type="Event",
                name=event.name,
                event_date=event.event_date,
                student_id=None,
                information=event.details or event.code,
            )
        )

    students = db.query(Student).filter(
        or_(Student.name.ilike(like), Student.student_id.ilike(like), Student.details.ilike(like))
    ).all()
    for student in students:
        results.append(
            SearchResult(
                type="Participant",
                name=student.name,
                event_date=None,
                student_id=student.student_id,
                information=student.details or "Student record",
            )
        )

    rows = (
        db.query(Registration)
        .join(Student)
        .join(Event)
        .options(joinedload(Registration.student), joinedload(Registration.event))
        .filter(
            or_(
                Student.name.ilike(like),
                Student.student_id.ilike(like),
                Event.name.ilike(like),
                Event.code.ilike(like),
            )
        )
        .all()
    )
    for row in rows:
        results.append(
            SearchResult(
                type="Registration",
                name=row.event.name,
                event_date=row.event.event_date,
                student_id=row.student.student_id,
                information=f"{row.student.name} ({row.event.code})",
            )
        )

    return results


@router.get("/reports/{event_id}", response_model=ReportOut)
def report(
    event_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).options(joinedload(Event.registrations)).filter(Event.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    rows = (
        db.query(Registration)
        .options(joinedload(Registration.student), joinedload(Registration.event))
        .filter(Registration.event_id == event_id)
        .order_by(Registration.id.asc())
        .all()
    )
    return ReportOut(
        event=to_event_out(event),
        total_registrations=len(rows),
        participants=[to_registration_out(row) for row in rows],
    )

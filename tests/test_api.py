from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def login(username="admin", password="admin123"):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_protected_routes_require_login():
    response = client.get("/api/events")
    assert response.status_code == 401


def test_invalid_login():
    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert response.status_code == 401
    assert "Invalid username or password" in response.json()["detail"]


def test_event_crud_and_dashboard():
    headers = login()
    created = client.post(
        "/api/events",
        json={"name": "Alumni Meet", "event_date": "2026-11-12", "details": "Alumni gathering"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]

    updated = client.put(
        "/api/events/" + str(event_id),
        json={"details": "Updated alumni gathering"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["details"] == "Updated alumni gathering"

    dashboard = client.get("/api/dashboard", headers=headers)
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert body["total_events"] >= 7
    assert body["total_registrations"] >= 5

    deleted = client.delete("/api/events/" + str(event_id), headers=headers)
    assert deleted.status_code == 200


def test_registration_duplicate_and_report():
    headers = login()
    events = client.get("/api/events", headers=headers).json()
    event_id = events[0]["id"]

    first = client.post(
        "/api/registrations",
        json={"student_id": "STU900", "student_name": "Nisha V", "event_id": event_id},
        headers=headers,
    )
    assert first.status_code == 201, first.text

    duplicate = client.post(
        "/api/registrations",
        json={"student_id": "STU900", "student_name": "Nisha V", "event_id": event_id},
        headers=headers,
    )
    assert duplicate.status_code == 400
    assert "already registered" in duplicate.json()["detail"]

    report = client.get(f"/api/reports/{event_id}", headers=headers)
    assert report.status_code == 200
    assert report.json()["total_registrations"] >= 1

    participants = client.get(f"/api/registrations?event_id={event_id}", headers=headers)
    assert participants.status_code == 200
    assert any(row["student_id"] == "STU900" for row in participants.json())


def test_student_upsert_and_search():
    headers = login()
    saved = client.post(
        "/api/students",
        json={"student_id": "STU700", "name": "Meera K", "details": "Biotechnology"},
        headers=headers,
    )
    assert saved.status_code == 200
    updated = client.post(
        "/api/students",
        json={"student_id": "STU700", "name": "Meera K", "details": "Biotechnology Honours"},
        headers=headers,
    )
    assert updated.json()["details"] == "Biotechnology Honours"

    search = client.get("/api/search", params={"q": "Meera"}, headers=headers)
    assert search.status_code == 200
    assert any(item["information"] == "Meera K" or item["name"] == "Meera K" for item in search.json()) or any(
        "Meera" in (item.get("information") or "") or "Meera" in item["name"] for item in search.json()
    )


def test_account_register_validation():
    response = client.post(
        "/api/auth/register",
        json={"full_name": "A", "username": "ab", "password": "123"},
    )
    assert response.status_code == 422


def test_student_update_and_delete():
    headers = login()
    created = client.post(
        "/api/students",
        json={"student_id": "STU888", "name": "Vikas S", "details": "Physics"},
        headers=headers,
    )
    assert created.status_code == 200
    pk = created.json()["id"]

    # Update via PUT
    updated = client.put(
        f"/api/students/{pk}",
        json={"name": "Vikas Sharma", "details": "Applied Physics"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Vikas Sharma"
    assert updated.json()["details"] == "Applied Physics"

    # Delete
    deleted = client.delete(f"/api/students/{pk}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["message"] == "Student deleted."


def test_registration_delete():
    headers = login()
    events = client.get("/api/events", headers=headers).json()
    event_id = events[0]["id"]

    reg = client.post(
        "/api/registrations",
        json={"student_id": "STU999", "student_name": "Rohan D", "event_id": event_id},
        headers=headers,
    )
    assert reg.status_code == 201
    reg_id = reg.json()["id"]

    delete_resp = client.delete(f"/api/registrations/{reg_id}", headers=headers)
    assert delete_resp.status_code == 200

    # Verify not in registrations list
    regs = client.get(f"/api/registrations?event_id={event_id}", headers=headers).json()
    assert not any(r["id"] == reg_id for r in regs)


def test_search_edge_cases():
    headers = login()
    # Empty query should return empty list
    assert client.get("/api/search", params={"q": ""}, headers=headers).json() == []
    assert client.get("/api/search", params={"q": "   "}, headers=headers).json() == []

    # Non-matching query
    res = client.get("/api/search", params={"q": "xyznonexistent999"}, headers=headers)
    assert res.status_code == 200
    assert res.json() == []


def test_frontend_assets():
    res_index = client.get("/")
    assert res_index.status_code == 200
    assert "College Event Registration" in res_index.text

    res_css = client.get("/style.css")
    assert res_css.status_code == 200
    assert "--primary" in res_css.text

    res_js = client.get("/script.js")
    assert res_js.status_code == 200
    assert "collegeEventToken" in res_js.text

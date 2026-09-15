# Requirements

This file restates the in-scope requirements from `srs.md`. The application must not add out-of-scope items such as payments, email/SMS, a mobile app, external college integrations, or advanced analytics.

## Functional

- FR-01: Authorized users can add, edit, and delete event details.
- FR-02: Students can be registered for available events.
- FR-03: Users can add, update, and manage student and participant details.
- FR-04: Users can view registered participants for each event.
- FR-05: Users can search and view event and registration information.
- FR-06: The system generates simple event registration reports.

## Non-functional (implemented in this version)

- NFR-03 / NFR-04: Login is required. Event, student, and registration APIs reject unauthenticated requests.
- NFR-06: Invalid input returns a clear error message on the form or API response.
- NFR-07: A student cannot be registered twice for the same event.

## Technical constraints

- Python backend
- SQLite database
- Local use without a cloud database or paid services

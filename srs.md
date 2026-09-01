1. Purpose and Scope
Purpose

The purpose of the College Event Registration Management System is to manage college events, student registrations, participant information, and basic registration reports in a centralized system.

In Scope
Add, edit, and delete event details.
Allow students to register for events.
Manage student and participant details.
View registered participants for each event.
Search and view event and registration information.
Generate simple event registration reports.
Out of Scope
Online payment processing.
Email or SMS notifications.
Mobile application.
Integration with external college systems.
Advanced analytics and dashboards.
2. Functional Requirements
FR-01: The system shall allow authorized users to add, edit, and delete event details.
FR-02: The system shall allow students to register for available events.
FR-03: The system shall allow users to add, update, and manage student and participant details.
FR-04: The system shall allow users to view registered participants for each event.
FR-05: The system shall allow users to search and view event and registration information.
FR-06: The system shall generate simple reports containing event registration information.
3. Non-Functional Requirements
NFR-01: The system shall display search results within 2 seconds for databases containing up to 10,000 records.
NFR-02: The system shall complete event registration within 3 seconds under normal operating conditions.
NFR-03: The system shall require user authentication and allow access only to authorized users.
NFR-04: The system shall prevent unauthorized modification or deletion of stored event and registration data.
NFR-05: The system shall provide a usable interface in which a new user can complete event registration within 5 minutes without assistance.
NFR-06: The system shall provide clear error messages within 2 seconds when invalid input is submitted.
NFR-07: The system shall maintain data integrity with 0 unintended duplicate registrations for the same student and event.
NFR-08: The system shall successfully store and retrieve 99% or more of valid registration records without data loss during normal operation.
4. Assumptions
Users have basic computer skills.
Event and student information will be entered by authorized users.
Students provide valid registration details.
The system will be used within the college or on a trusted local network.
SQLite is sufficient for the expected number of records.
Regular database backups can be performed manually.
5. Constraints
The system shall be developed using Python.
SQLite shall be used as the database.
The first version shall be designed for a small college project.
The system shall operate without requiring a cloud database.
Development time and resources are limited to a few weeks.
The system shall not depend on paid external services.
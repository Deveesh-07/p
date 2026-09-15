const TOKEN_KEY = "collegeEventToken";
const USER_KEY = "collegeEventUser";

const state = {
    events: [],
    students: [],
    registrations: [],
    searchResults: [],
    activeSearchFilter: "all",
    editingStudentPk: null,
};

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function showToast(message, isError = false) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", Boolean(isError));
    toast.classList.add("show");
    window.clearTimeout(toast._timeout);
    toast._timeout = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function setError(id, message) {
    const el = $(id);
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("hidden", !Boolean(message));
}

function formatDate(value) {
    if (!value) return "-";
    try {
        const parts = String(value).split("-");
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            const d = new Date(year, month, day);
            return d.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            });
        }
    } catch {
        // Fallback
    }
    return String(value);
}

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
}

function saveSession(token, user) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
}

const API_BASE = (function() {
    if (typeof window !== "undefined" && window.location.hostname && window.location.port === "8000") {
        return "";
    }
    return "http://127.0.0.1:8000";
})();

async function api(path, options = {}) {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (options.body && !(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
        response = await fetch(url, { ...options, headers });
    } catch (networkErr) {
        throw new Error("Cannot connect to server at http://127.0.0.1:8000. Please ensure backend is running.");
    }
    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }
    if (!response.ok) {
        if (response.status === 401) {
            clearSession();
            showAuth("login");
            showToast("Session expired. Please log in again.", true);
        }
        const detail = data && data.detail;
        let message = "Request failed.";
        if (typeof detail === "string") message = detail;
        else if (Array.isArray(detail) && detail[0] && detail[0].msg) message = detail[0].msg;
        else if (response.status === 404) message = "Requested endpoint not found (404).";
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    return data;
}

function updateProfile(user) {
    if (!user) return;
    $("profileName").textContent = user.full_name || "Authorized User";
    const initials = (user.full_name || "AU")
        .split(" ")
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    $("profileAvatar").textContent = initials || "AU";
}

function showAuth(page = "login") {
    const authPage = $("authPage");
    if (authPage) authPage.classList.remove("hidden");
    $("application").classList.add("hidden");

    const isRegister = page === "register";
    const tabLogin = $("tabLogin");
    const tabRegister = $("tabRegister");
    const loginView = $("loginView");
    const registerView = $("registerView");
    const cardTitle = $("authCardTitle");
    const cardSubtitle = $("authCardSubtitle");

    if (tabLogin) {
        tabLogin.classList.toggle("active", !isRegister);
        tabLogin.setAttribute("aria-selected", String(!isRegister));
    }
    if (tabRegister) {
        tabRegister.classList.toggle("active", isRegister);
        tabRegister.setAttribute("aria-selected", String(isRegister));
    }

    if (loginView) loginView.classList.toggle("hidden", isRegister);
    if (registerView) registerView.classList.toggle("hidden", !isRegister);

    if (cardTitle) {
        cardTitle.textContent = isRegister ? "Create Admin Account" : "Welcome Back";
    }
    if (cardSubtitle) {
        cardSubtitle.textContent = isRegister 
            ? "Register a new authorized campus administrator" 
            : "Sign in with your authorized administrative credentials";
    }

    setError("loginError", "");
    setError("registerError", "");
}

function showApp(user) {
    const authPage = $("authPage");
    if (authPage) authPage.classList.add("hidden");
    $("application").classList.remove("hidden");
    updateProfile(user);
}

function closeSidebar() {
    $("sidebar").classList.remove("open");
    $("overlay").classList.remove("active");
}

function showSection(sectionId) {
    document.querySelectorAll(".page-section").forEach((section) => {
        section.classList.toggle("active", section.id === sectionId);
    });
    document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.section === sectionId);
    });
    const active = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (active) {
        const textSpan = active.querySelector("span:last-child");
        $("breadcrumb").textContent = textSpan ? textSpan.textContent.trim() : active.textContent.trim();
    }
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function emptyRow(colspan, message) {
    return `<tr><td colspan="${colspan}" class="empty-cell">${escapeHtml(message)}</td></tr>`;
}

function fillEventSelects() {
    ["registrationEvent", "registeredEvent", "reportEvent"].forEach((id) => {
        const select = $(id);
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">Choose an event</option>';
        state.events.forEach((event) => {
            const option = document.createElement("option");
            option.value = String(event.id);
            option.textContent = `${event.code} — ${event.name} (${formatDate(event.event_date)})`;
            select.appendChild(option);
        });
        select.value = current;
    });
}

function renderDashboard(data) {
    $("totalEvents").textContent = data.total_events;
    $("totalRegistrations").textContent = data.total_registrations;
    $("totalParticipants").textContent = data.total_participants;
    $("totalReports").textContent = data.total_events;

    const rows = data.events.slice(0, 6).map((event) => `
        <tr>
            <td><span class="code-badge">${escapeHtml(event.code)}</span></td>
            <td><strong>${escapeHtml(event.name)}</strong></td>
            <td>${escapeHtml(formatDate(event.event_date))}</td>
            <td><strong>${event.registration_count}</strong> student(s)</td>
            <td><span class="status ${event.status === "Completed" ? "completed" : ""}">${escapeHtml(event.status)}</span></td>
        </tr>
    `);
    $("dashboardEventTable").innerHTML = rows.join("") || emptyRow(5, "No events added yet. Click 'Add New Event' to begin.");
}

function renderEvents() {
    const term = ($("eventSearch").value || "").trim().toLowerCase();
    const filtered = state.events.filter((event) =>
        [event.name, event.code, event.details].join(" ").toLowerCase().includes(term)
    );
    if (!filtered.length) {
        $("eventTable").innerHTML = emptyRow(7, term ? "No matching events found." : "No events created yet.");
        return;
    }
    $("eventTable").innerHTML = filtered.map((event) => `
        <tr>
            <td><span class="code-badge">${escapeHtml(event.code)}</span></td>
            <td><strong>${escapeHtml(event.name)}</strong></td>
            <td>${escapeHtml(formatDate(event.event_date))}</td>
            <td>${escapeHtml(event.details || "-")}</td>
            <td><strong>${event.registration_count}</strong></td>
            <td><span class="status ${event.status === "Completed" ? "completed" : ""}">${escapeHtml(event.status)}</span></td>
            <td>
                <button type="button" class="table-action" data-edit-event="${event.id}">Edit</button>
                <button type="button" class="table-action delete" data-delete-event="${event.id}">Delete</button>
            </td>
        </tr>
    `).join("");
}

function renderStudents() {
    const term = ($("participantSearch") ? $("participantSearch").value : "").trim().toLowerCase();
    const filtered = state.students.filter((student) =>
        [student.name, student.student_id, student.details].join(" ").toLowerCase().includes(term)
    );
    if (!filtered.length) {
        $("participantTable").innerHTML = emptyRow(4, term ? "No matching students found." : "No student participant records yet.");
        return;
    }
    $("participantTable").innerHTML = filtered.map((student) => `
        <tr>
            <td><span class="code-badge">${escapeHtml(student.student_id)}</span></td>
            <td><strong>${escapeHtml(student.name)}</strong></td>
            <td>${escapeHtml(student.details || "-")}</td>
            <td>
                <button type="button" class="table-action" data-edit-student="${student.id}">Edit</button>
                <button type="button" class="table-action delete" data-delete-student="${student.id}">Delete</button>
            </td>
        </tr>
    `).join("");
}

function renderRecentRegistrations(registrations) {
    const table = $("recentRegistrationsTable");
    if (!table) return;
    if (!registrations || !registrations.length) {
        table.innerHTML = emptyRow(5, "No registrations recorded yet.");
        return;
    }
    const recent = registrations.slice(-8).reverse();
    table.innerHTML = recent.map((row) => `
        <tr>
            <td><span class="code-badge">${escapeHtml(row.student_id)}</span></td>
            <td><strong>${escapeHtml(row.student_name)}</strong></td>
            <td>${escapeHtml(row.event_name)} (${escapeHtml(row.event_code)})</td>
            <td>${escapeHtml(formatDate(row.event_date))}</td>
            <td>
                <button type="button" class="table-action delete" data-delete-reg="${row.id}">Cancel</button>
            </td>
        </tr>
    `).join("");
}

async function refreshData() {
    try {
        const [dashboard, events, students, registrations] = await Promise.all([
            api("/api/dashboard"),
            api("/api/events"),
            api("/api/students"),
            api("/api/registrations"),
        ]);
        state.events = events;
        state.students = students;
        state.registrations = registrations;
        renderDashboard(dashboard);
        renderEvents();
        renderStudents();
        renderRecentRegistrations(registrations);
        fillEventSelects();
    } catch (error) {
        showToast(error.message, true);
    }
}

function resetEventForm() {
    $("eventForm").reset();
    $("eventId").value = "";
    $("eventFormTitle").textContent = "New Event";
    $("saveEventBtn").textContent = "Save Event";
    setError("eventError", "");
    $("eventFormCard").classList.add("hidden");
}

function resetParticipantForm() {
    $("participantForm").reset();
    state.editingStudentPk = null;
    $("participantPk").value = "";
    $("participantFormTitle").textContent = "Add Participant Record";
    $("participantSubmitBtn").textContent = "Save Details";
    $("participantEditBanner").classList.add("hidden");
    $("participantId").removeAttribute("readonly");
    setError("participantError", "");
}

// Demo Login Auto-fill
const demoPill = $("demoLoginPill");
if (demoPill) {
    demoPill.addEventListener("click", () => {
        $("loginUsername").value = "admin";
        $("loginPassword").value = "admin123";
        showToast("Demo credentials filled!");
        $("loginSubmitBtn").focus();
    });
}

// Authentication switch listeners
$("showRegister").addEventListener("click", () => {
    setError("registerError", "");
    $("registerForm").reset();
    showAuth("register");
});
$("showLogin").addEventListener("click", () => {
    setError("loginError", "");
    showAuth("login");
});

// Login Form Submit
$("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("loginError", "");
    const submitBtn = $("loginSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing In...";
    try {
        const data = await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                username: $("loginUsername").value.trim(),
                password: $("loginPassword").value,
            }),
        });
        saveSession(data.token, data.user);
        showApp(data.user);
        showSection("dashboard");
        await refreshData();
        showToast(`Welcome back, ${data.user.full_name}!`);
    } catch (error) {
        setError("loginError", error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In";
    }
});

// Register Account Form Submit
$("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("registerError", "");
    const password = $("registerPassword").value;
    if (password !== $("confirmPassword").value) {
        setError("registerError", "Passwords do not match.");
        return;
    }
    const submitBtn = $("registerSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating Account...";
    try {
        await api("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                full_name: $("registerName").value.trim(),
                username: $("registerUsername").value.trim(),
                password,
            }),
        });
        showToast("Account created successfully! Please sign in.");
        $("loginUsername").value = $("registerUsername").value.trim();
        $("loginPassword").value = "";
        showAuth("login");
    } catch (error) {
        setError("registerError", error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Register Account";
    }
});

// Shared Logout Handler (Accessible from both Sidebar and Top Header)
async function performLogout() {
    try {
        await api("/api/auth/logout", { method: "POST" });
    } catch {
        // Continue local logout
    }
    clearSession();
    showAuth("login");
    $("loginForm").reset();
    $("registerForm").reset();
    showToast("Signed out successfully.");
}

// Attach logout to sidebar and top header
const sidebarLogoutBtn = $("logoutButton");
if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener("click", performLogout);

const headerLogoutBtn = $("headerLogoutBtn");
if (headerLogoutBtn) headerLogoutBtn.addEventListener("click", performLogout);

// Auth tab switcher buttons
const tabLogin = $("tabLogin");
if (tabLogin) {
    tabLogin.addEventListener("click", () => {
        setError("loginError", "");
        showAuth("login");
    });
}

const tabRegister = $("tabRegister");
if (tabRegister) {
    tabRegister.addEventListener("click", () => {
        setError("registerError", "");
        $("registerForm").reset();
        showAuth("register");
    });
}

// Password Show/Hide Eye Toggle
document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
        const targetId = btn.dataset.target;
        const input = $(targetId);
        if (!input) return;
        if (input.type === "password") {
            input.type = "text";
            btn.textContent = "🙈";
            btn.setAttribute("title", "Hide password");
        } else {
            input.type = "password";
            btn.textContent = "👁️";
            btn.setAttribute("title", "Show password");
        }
    });
});

// Demo Login Autofill
const demoLoginPill = $("demoLoginPill");
if (demoLoginPill) {
    demoLoginPill.addEventListener("click", () => {
        const userField = $("loginUsername");
        const passField = $("loginPassword");
        if (userField && passField) {
            userField.value = "admin";
            passField.value = "admin123";
            showToast("Demo admin credentials auto-filled!");
            const submitBtn = $("loginSubmitBtn");
            if (submitBtn) submitBtn.focus();
        }
    });
}

// Navigation handlers
document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => showSection(item.dataset.section));
});
document.addEventListener("click", (event) => {
    const go = event.target.closest("[data-go]");
    if (go) showSection(go.dataset.go);
});
$("menuButton").addEventListener("click", () => {
    $("sidebar").classList.toggle("open");
    $("overlay").classList.toggle("active");
});
$("overlay").addEventListener("click", closeSidebar);

// Event Details Handlers (FR-01)
$("showEventForm").addEventListener("click", () => {
    resetEventForm();
    $("eventFormCard").classList.remove("hidden");
    $("eventFormTitle").textContent = "New Event";
    $("eventName").focus();
    $("eventFormCard").scrollIntoView({ behavior: "smooth" });
});
$("cancelEvent").addEventListener("click", resetEventForm);
$("eventSearch").addEventListener("input", renderEvents);

$("eventForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("eventError", "");
    const name = $("eventName").value.trim();
    if (name.length < 2) {
        setError("eventError", "Event name must be at least 2 characters.");
        return;
    }
    const payload = {
        name,
        event_date: $("eventDate").value,
        details: ($("eventDescription").value || "").trim(),
    };
    const saveBtn = $("saveEventBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
        const eventId = $("eventId").value;
        if (eventId) {
            await api(`/api/events/${eventId}`, { method: "PUT", body: JSON.stringify(payload) });
            showToast("Event updated successfully.");
        } else {
            await api("/api/events", { method: "POST", body: JSON.stringify(payload) });
            showToast("Event created successfully.");
        }
        resetEventForm();
        await refreshData();
    } catch (error) {
        setError("eventError", error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Event";
    }
});

$("eventTable").addEventListener("click", async (event) => {
    const editId = event.target.dataset.editEvent;
    const deleteId = event.target.dataset.deleteEvent;
    if (editId) {
        const item = state.events.find((row) => String(row.id) === String(editId));
        if (!item) return;
        $("eventId").value = item.id;
        $("eventName").value = item.name;
        $("eventDate").value = item.event_date;
        $("eventDescription").value = item.details;
        $("eventFormTitle").textContent = `Edit Event (${item.code})`;
        $("saveEventBtn").textContent = "Update Event";
        $("eventFormCard").classList.remove("hidden");
        $("eventFormCard").scrollIntoView({ behavior: "smooth" });
    }
    if (deleteId) {
        const item = state.events.find((row) => String(row.id) === String(deleteId));
        const eventName = item ? `"${item.name}"` : "this event";
        if (!window.confirm(`Are you sure you want to delete ${eventName}? All associated registrations will also be removed.`)) return;
        try {
            await api(`/api/events/${deleteId}`, { method: "DELETE" });
            showToast("Event deleted successfully.");
            await refreshData();
        } catch (error) {
            showToast(error.message, true);
        }
    }
});

// Event Registration Handlers (FR-02)
const regStudentIdInput = $("registrationStudentId");
const lookupHint = $("studentLookupHint");
if (regStudentIdInput) {
    regStudentIdInput.addEventListener("input", () => {
        const query = regStudentIdInput.value.trim().toLowerCase();
        if (!query) {
            if (lookupHint) lookupHint.textContent = "";
            return;
        }
        const match = state.students.find((s) => s.student_id.toLowerCase() === query);
        if (match) {
            $("registrationStudent").value = match.name;
            if (lookupHint) {
                lookupHint.textContent = `Existing student found: ${match.name}`;
                lookupHint.style.color = "#059669";
            }
        } else {
            if (lookupHint) {
                lookupHint.textContent = "New student will be registered into records";
                lookupHint.style.color = "#64748b";
            }
        }
    });
}

$("registrationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("registrationError", "");
    const submitBtn = $("submitRegistrationBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Registering...";
    try {
        await api("/api/registrations", {
            method: "POST",
            body: JSON.stringify({
                student_id: $("registrationStudentId").value.trim(),
                student_name: $("registrationStudent").value.trim(),
                event_id: Number($("registrationEvent").value),
            }),
        });
        $("registrationForm").reset();
        if (lookupHint) lookupHint.textContent = "";
        showToast("Student registered successfully!");
        await refreshData();
    } catch (error) {
        setError("registrationError", error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Register Student";
    }
});

// Recent Registrations cancel handler
const recentRegTable = $("recentRegistrationsTable");
if (recentRegTable) {
    recentRegTable.addEventListener("click", async (event) => {
        const deleteRegId = event.target.dataset.deleteReg;
        if (deleteRegId) {
            if (!window.confirm("Cancel this registration?")) return;
            try {
                await api(`/api/registrations/${deleteRegId}`, { method: "DELETE" });
                showToast("Registration cancelled.");
                await refreshData();
            } catch (error) {
                showToast(error.message, true);
            }
        }
    });
}

// Student & Participant Handlers (FR-03)
const partSearch = $("participantSearch");
if (partSearch) {
    partSearch.addEventListener("input", renderStudents);
}

$("participantForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("participantError", "");
    const sid = $("participantId").value.trim();
    const name = $("participantName").value.trim();
    const details = ($("participantDetails").value || "").trim();

    if (sid.length < 2) {
        setError("participantError", "Student ID must be at least 2 characters.");
        return;
    }
    if (name.length < 2) {
        setError("participantError", "Student name must be at least 2 characters.");
        return;
    }

    const submitBtn = $("participantSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    try {
        if (state.editingStudentPk) {
            // Update existing student via PUT
            await api(`/api/students/${state.editingStudentPk}`, {
                method: "PUT",
                body: JSON.stringify({
                    student_id: sid,
                    name,
                    details,
                }),
            });
            showToast("Student details updated.");
        } else {
            // Create or upsert student
            await api("/api/students", {
                method: "POST",
                body: JSON.stringify({
                    student_id: sid,
                    name,
                    details,
                }),
            });
            showToast("Participant record saved.");
        }
        resetParticipantForm();
        await refreshData();
    } catch (error) {
        setError("participantError", error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = state.editingStudentPk ? "Update Details" : "Save Details";
    }
});

$("resetParticipantBtn").addEventListener("click", resetParticipantForm);
const cancelEditBtn = $("cancelStudentEdit");
if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", resetParticipantForm);
}

$("participantTable").addEventListener("click", async (event) => {
    const editId = event.target.dataset.editStudent;
    const deleteId = event.target.dataset.deleteStudent;
    if (editId) {
        const student = state.students.find((row) => String(row.id) === String(editId));
        if (!student) return;
        state.editingStudentPk = student.id;
        $("participantPk").value = student.id;
        $("participantId").value = student.student_id;
        $("participantName").value = student.name;
        $("participantDetails").value = student.details;
        $("participantFormTitle").textContent = "Edit Participant Record";
        $("participantSubmitBtn").textContent = "Update Details";
        $("editingStudentName").textContent = `${student.name} (${student.student_id})`;
        $("participantEditBanner").classList.remove("hidden");
        $("participantForm").scrollIntoView({ behavior: "smooth" });
    }
    if (deleteId) {
        const student = state.students.find((row) => String(row.id) === String(deleteId));
        const sName = student ? `"${student.name}"` : "this student";
        if (!window.confirm(`Delete ${sName} and their associated event registrations?`)) return;
        try {
            await api(`/api/students/${deleteId}`, { method: "DELETE" });
            showToast("Student deleted successfully.");
            await refreshData();
        } catch (error) {
            showToast(error.message, true);
        }
    }
});

// Registered Participants View (FR-04)
async function loadRegisteredParticipants() {
    const eventId = $("registeredEvent").value;
    const badge = $("registeredCountBadge");
    if (!eventId) {
        $("registeredEventTitle").textContent = "Select an event above to display registered participants.";
        $("registeredTable").innerHTML = emptyRow(6, "Select an event to view registered participants.");
        if (badge) badge.classList.add("hidden");
        return;
    }
    try {
        const rows = await api(`/api/registrations?event_id=${encodeURIComponent(eventId)}`);
        const selected = state.events.find((ev) => String(ev.id) === String(eventId));
        $("registeredEventTitle").textContent = selected
            ? `${selected.name} (${selected.code}) — ${formatDate(selected.event_date)}`
            : "Selected Event";
        
        if (badge) {
            badge.textContent = `${rows.length} Participant${rows.length === 1 ? "" : "s"}`;
            badge.classList.remove("hidden");
        }

        if (!rows.length) {
            $("registeredTable").innerHTML = emptyRow(6, "No students are currently registered for this event.");
            return;
        }

        $("registeredTable").innerHTML = rows.map((row, index) => `
            <tr>
                <td style="color: var(--text-muted); font-size: 12px;">${index + 1}</td>
                <td><span class="code-badge">${escapeHtml(row.student_id)}</span></td>
                <td><strong>${escapeHtml(row.student_name)}</strong></td>
                <td>${escapeHtml(row.student_details || "-")}</td>
                <td>${escapeHtml(row.event_name)}</td>
                <td>
                    <button type="button" class="table-action delete" data-cancel-reg="${row.id}">Remove</button>
                </td>
            </tr>
        `).join("");
    } catch (error) {
        showToast(error.message, true);
    }
}

$("registeredEvent").addEventListener("change", loadRegisteredParticipants);
$("viewParticipants").addEventListener("click", loadRegisteredParticipants);

$("registeredTable").addEventListener("click", async (event) => {
    const cancelId = event.target.dataset.cancelReg;
    if (cancelId) {
        if (!window.confirm("Remove this student from the event?")) return;
        try {
            await api(`/api/registrations/${cancelId}`, { method: "DELETE" });
            showToast("Registration removed.");
            await loadRegisteredParticipants();
            await refreshData();
        } catch (error) {
            showToast(error.message, true);
        }
    }
});

// Search & View (FR-05, NFR-01)
function renderSearchResults() {
    const filter = state.activeSearchFilter;
    let items = state.searchResults;

    if (filter === "event") {
        items = items.filter((r) => r.type.toLowerCase() === "event");
    } else if (filter === "participant") {
        items = items.filter((r) => r.type.toLowerCase() === "participant");
    } else if (filter === "registration") {
        items = items.filter((r) => r.type.toLowerCase() === "registration");
    }

    if (!items.length) {
        $("searchResults").innerHTML = emptyRow(5, "No matching records found.");
        return;
    }

    $("searchResults").innerHTML = items.map((row) => {
        const typeClass = row.type.toLowerCase();
        return `
            <tr>
                <td><span class="type-badge ${typeClass}">${escapeHtml(row.type)}</span></td>
                <td><strong>${escapeHtml(row.name)}</strong></td>
                <td>${row.event_date ? escapeHtml(formatDate(row.event_date)) : "-"}</td>
                <td>${row.student_id ? `<span class="code-badge">${escapeHtml(row.student_id)}</span>` : "-"}</td>
                <td>${escapeHtml(row.information)}</td>
            </tr>
        `;
    }).join("");
}

function updateSearchCounts() {
    const all = state.searchResults;
    $("countAll").textContent = all.length;
    $("countEvents").textContent = all.filter((r) => r.type.toLowerCase() === "event").length;
    $("countStudents").textContent = all.filter((r) => r.type.toLowerCase() === "participant").length;
    $("countRegistrations").textContent = all.filter((r) => r.type.toLowerCase() === "registration").length;
}

async function performSearch() {
    const term = $("globalSearch").value.trim();
    if (!term) {
        state.searchResults = [];
        updateSearchCounts();
        $("searchResults").innerHTML = emptyRow(5, "Enter a search term above.");
        return;
    }
    try {
        const rows = await api(`/api/search?q=${encodeURIComponent(term)}`);
        state.searchResults = rows;
        updateSearchCounts();
        renderSearchResults();
    } catch (error) {
        $("searchResults").innerHTML = emptyRow(5, error.message);
    }
}

let searchDebounceTimer = null;
$("globalSearch").addEventListener("input", () => {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(performSearch, 250);
});
$("searchButton").addEventListener("click", performSearch);
$("globalSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        window.clearTimeout(searchDebounceTimer);
        performSearch();
    }
});

// Search filter tabs
const filterPills = $("searchFilterPills");
if (filterPills) {
    filterPills.addEventListener("click", (event) => {
        const btn = event.target.closest(".filter-pill");
        if (!btn) return;
        filterPills.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.activeSearchFilter = btn.dataset.filter;
        renderSearchResults();
    });
}

// Registration Reports (FR-06)
$("generateReport").addEventListener("click", async () => {
    setError("reportError", "");
    const eventId = $("reportEvent").value;
    if (!eventId) {
        setError("reportError", "Please choose an event to generate a report.");
        $("reportResult").classList.add("hidden");
        return;
    }
    try {
        const report = await api(`/api/reports/${eventId}`);
        $("reportEventCode").textContent = report.event.code;
        $("reportEventName").textContent = report.event.name;
        $("reportEventDetails").textContent = report.event.details || "College Campus Event";
        $("reportEventValue").textContent = report.event.name;
        $("reportEventDateValue").textContent = formatDate(report.event.event_date);
        $("reportCount").textContent = report.total_registrations;
        $("reportEventStatus").textContent = report.event.status;
        $("reportEventStatus").className = `status ${report.event.status === "Completed" ? "completed" : ""}`;
        $("reportGeneratedDate").textContent = `Report generated on ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;

        if (!report.participants.length) {
            $("reportTable").innerHTML = emptyRow(5, "No students are currently registered for this event.");
        } else {
            $("reportTable").innerHTML = report.participants.map((row, index) => `
                <tr>
                    <td style="color: var(--text-muted); font-size: 12px;">${index + 1}</td>
                    <td><span class="code-badge">${escapeHtml(row.student_id)}</span></td>
                    <td><strong>${escapeHtml(row.student_name)}</strong></td>
                    <td>${escapeHtml(row.student_details || "-")}</td>
                    <td>${escapeHtml(row.created_at || "-")}</td>
                </tr>
            `).join("");
        }
        $("reportResult").classList.remove("hidden");
        $("reportResult").scrollIntoView({ behavior: "smooth" });
    } catch (error) {
        setError("reportError", error.message);
    }
});

// Print Report action
const printBtn = $("printReportBtn");
if (printBtn) {
    printBtn.addEventListener("click", () => {
        window.print();
    });
}

// Restore Session on Launch
async function restoreSession() {
    const token = getToken();
    const rawUser = sessionStorage.getItem(USER_KEY);
    if (!token || !rawUser) {
        showAuth("login");
        return;
    }
    try {
        const user = await api("/api/auth/me");
        saveSession(token, user);
        showApp(user);
        showSection("dashboard");
        await refreshData();
    } catch {
        clearSession();
        showAuth("login");
    }
}

restoreSession();

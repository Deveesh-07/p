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

const API_BASE = "";

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
        throw new Error("Cannot connect to server. Please ensure backend is running.");
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
        initRealtime();
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
const sidebarCloseBtn = $("sidebarCloseBtn");
if (sidebarCloseBtn) sidebarCloseBtn.addEventListener("click", closeSidebar);
$("overlay").addEventListener("click", closeSidebar);
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("sidebar").classList.contains("open")) {
        closeSidebar();
    }
});

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

// --- AI Management Assistant Module (Powered by Gemini) ---
let lastAiQuery = "";
let aiLoadingInterval = null;

function renderInlineMarkdown(escapedText) {
    return escapedText
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>");
}

function formatAiMarkdown(text) {
    if (!text) return "";
    const lines = text.split("\n");
    let html = "";
    let inList = false;
    let listType = "ul";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line) {
            if (inList) {
                html += `</${listType}>`;
                inList = false;
            }
            continue;
        }

        if (line === "---" || line === "***" || line === "___") {
            if (inList) { html += `</${listType}>`; inList = false; }
            html += "<hr>";
            continue;
        }

        if (line.startsWith("#### ")) {
            if (inList) { html += `</${listType}>`; inList = false; }
            html += `<h4>${renderInlineMarkdown(escapeHtml(line.slice(5)))}</h4>`;
            continue;
        }
        if (line.startsWith("### ")) {
            if (inList) { html += `</${listType}>`; inList = false; }
            html += `<h3>${renderInlineMarkdown(escapeHtml(line.slice(4)))}</h3>`;
            continue;
        }
        if (line.startsWith("## ")) {
            if (inList) { html += `</${listType}>`; inList = false; }
            html += `<h2>${renderInlineMarkdown(escapeHtml(line.slice(3)))}</h2>`;
            continue;
        }
        if (line.startsWith("# ")) {
            if (inList) { html += `</${listType}>`; inList = false; }
            html += `<h2>${renderInlineMarkdown(escapeHtml(line.slice(2)))}</h2>`;
            continue;
        }

        const bulletMatch = line.match(/^[-*]\s+(.*)$/);
        if (bulletMatch) {
            if (!inList || listType !== "ul") {
                if (inList) html += `</${listType}>`;
                html += "<ul>";
                inList = true;
                listType = "ul";
            }
            html += `<li>${renderInlineMarkdown(escapeHtml(bulletMatch[1]))}</li>`;
            continue;
        }

        const numMatch = line.match(/^\d+\.\s+(.*)$/);
        if (numMatch) {
            if (!inList || listType !== "ol") {
                if (inList) html += `</${listType}>`;
                html += "<ol>";
                inList = true;
                listType = "ol";
            }
            html += `<li>${renderInlineMarkdown(escapeHtml(numMatch[1]))}</li>`;
            continue;
        }

        if (inList) {
            html += `</${listType}>`;
            inList = false;
        }

        if (line.startsWith("> ")) {
            html += `<blockquote>${renderInlineMarkdown(escapeHtml(line.slice(2)))}</blockquote>`;
            continue;
        }

        html += `<p>${renderInlineMarkdown(escapeHtml(line))}</p>`;
    }

    if (inList) {
        html += `</${listType}>`;
    }

    return html;
}

async function runAiAnalysis(query, focusArea) {
    const finalQuery = (query || "").trim() || "Provide a comprehensive executive summary of all college events, enrollment health, and capacity.";
    lastAiQuery = finalQuery;

    const emptyState = $("aiEmptyState");
    const loadingState = $("aiLoadingState");
    const errorState = $("aiErrorState");
    const contentView = $("aiContentView");
    const submitBtn = $("aiSubmitQueryBtn");
    const runAllBtn = $("runFullAiAnalysisBtn");

    if (emptyState) emptyState.classList.add("hidden");
    if (errorState) errorState.classList.add("hidden");
    if (contentView) contentView.classList.add("hidden");
    if (loadingState) loadingState.classList.remove("hidden");

    if (submitBtn) submitBtn.disabled = true;
    if (runAllBtn) runAllBtn.disabled = true;

    const loadingSteps = [
        "Aggregating live PostgreSQL database records...",
        "Evaluating event participation & capacity ratios...",
        "Analyzing student enrollment across departments...",
        "Synthesizing institutional management intelligence with Gemini..."
    ];
    let stepIndex = 0;
    const loadingStepEl = $("aiLoadingStep");
    if (loadingStepEl) loadingStepEl.textContent = loadingSteps[0];

    if (aiLoadingInterval) clearInterval(aiLoadingInterval);
    aiLoadingInterval = setInterval(() => {
        stepIndex = (stepIndex + 1) % loadingSteps.length;
        if (loadingStepEl) loadingStepEl.textContent = loadingSteps[stepIndex];
    }, 2200);

    try {
        const response = await api("/api/ai/analyze", {
            method: "POST",
            body: JSON.stringify({ query: finalQuery, focusArea }),
        });

        if (aiLoadingInterval) {
            clearInterval(aiLoadingInterval);
            aiLoadingInterval = null;
        }

        if (loadingState) loadingState.classList.add("hidden");

        if (response.metrics) {
            if ($("aiMetricEvents")) $("aiMetricEvents").textContent = response.metrics.events ?? 0;
            if ($("aiMetricUpcoming")) $("aiMetricUpcoming").textContent = response.metrics.upcoming ?? 0;
            if ($("aiMetricCompleted")) $("aiMetricCompleted").textContent = response.metrics.completed ?? 0;
            if ($("aiMetricStudents")) $("aiMetricStudents").textContent = response.metrics.students ?? 0;
            if ($("aiMetricRegistrations")) $("aiMetricRegistrations").textContent = response.metrics.registrations ?? 0;
        }

        if ($("aiActiveQueryLabel")) {
            $("aiActiveQueryLabel").textContent = finalQuery;
        }
        if ($("aiTimestampBadge")) {
            const now = new Date();
            $("aiTimestampBadge").textContent = `Generated ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
        }

        if ($("aiAnalysisProse")) {
            $("aiAnalysisProse").innerHTML = formatAiMarkdown(response.analysis || "");
        }

        if (contentView) {
            contentView.classList.remove("hidden");
            contentView.scrollIntoView({ behavior: "smooth" });
        }
        showToast("AI Management Analysis generated successfully!");
    } catch (err) {
        if (aiLoadingInterval) {
            clearInterval(aiLoadingInterval);
            aiLoadingInterval = null;
        }
        if (loadingState) loadingState.classList.add("hidden");
        if (errorState) {
            errorState.classList.remove("hidden");
            if ($("aiErrorMessage")) $("aiErrorMessage").textContent = "Analysis Unavailable";
            if ($("aiErrorDetail")) $("aiErrorDetail").textContent = err.message || "An unexpected error occurred while communicating with the AI service.";
        }
        showToast(err.message || "Failed to generate AI analysis", true);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (runAllBtn) runAllBtn.disabled = false;
    }
}

// Attach AI Assistant event listeners
const runFullAiBtn = $("runFullAiAnalysisBtn");
if (runFullAiBtn) {
    runFullAiBtn.addEventListener("click", () => {
        const queryInput = $("aiCustomQuery");
        const query = queryInput ? queryInput.value.trim() : "";
        runAiAnalysis(query);
    });
}

const aiInquiryForm = $("aiInquiryForm");
if (aiInquiryForm) {
    aiInquiryForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const query = ($("aiCustomQuery")?.value || "").trim();
        if (!query) {
            showToast("Please enter an analytical question or choose a preset prompt.");
            return;
        }
        runAiAnalysis(query);
    });
}

const aiChipGrid = $("aiChipGrid");
if (aiChipGrid) {
    aiChipGrid.addEventListener("click", (e) => {
        const chip = e.target.closest(".ai-prompt-chip");
        if (!chip) return;
        aiChipGrid.querySelectorAll(".ai-prompt-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        const prompt = chip.dataset.prompt;
        if ($("aiCustomQuery")) {
            $("aiCustomQuery").value = prompt;
        }
        runAiAnalysis(prompt);
    });
}

const copyAiBtn = $("copyAiAnalysisBtn");
if (copyAiBtn) {
    copyAiBtn.addEventListener("click", async () => {
        const prose = $("aiAnalysisProse");
        if (!prose) return;
        try {
            await navigator.clipboard.writeText(prose.innerText);
            showToast("Analysis briefing copied to clipboard!");
        } catch {
            showToast("Unable to copy to clipboard automatically.");
        }
    });
}

const printAiBtn = $("printAiAnalysisBtn");
if (printAiBtn) {
    printAiBtn.addEventListener("click", () => {
        window.print();
    });
}

const aiRetryBtn = $("aiRetryBtn");
if (aiRetryBtn) {
    aiRetryBtn.addEventListener("click", () => {
        runAiAnalysis(lastAiQuery);
    });
}

// --- Supabase Realtime & Live Sync Engine ---
let supabaseClient = null;
let realtimeChannel = null;
let sseConnection = null;
let realtimeDebounceTimer = null;

function highlightElement(el) {
    if (!el) return;
    el.classList.remove("pulse-highlight");
    void el.offsetWidth; // Force CSS reflow
    el.classList.add("pulse-highlight");
    window.setTimeout(() => {
        el.classList.remove("pulse-highlight");
    }, 1800);
}

function updateRealtimeBadge(status, labelText) {
    const badge = $("realtimeStatusBadge");
    const dot = $("realtimeDot");
    const text = $("realtimeStatusText");
    if (!badge || !dot || !text) return;

    text.textContent = labelText;
    if (status === "active") {
        badge.classList.remove("syncing");
        dot.className = "status-dot pulse";
    } else if (status === "syncing") {
        badge.classList.add("syncing");
        dot.className = "status-dot";
    }
}

async function triggerRealtimeSync(table, eventType, record) {
    if (realtimeDebounceTimer) {
        clearTimeout(realtimeDebounceTimer);
    }

    updateRealtimeBadge("syncing", "Syncing updates...");

    realtimeDebounceTimer = setTimeout(async () => {
        if (!getToken()) return;

        try {
            await refreshData();
            updateRealtimeBadge("active", supabaseClient ? "Supabase Realtime Live" : "Live Sync Active");

            // Visually highlight updated UI components and dashboard stats
            if (table === "events") {
                const totalEventsCard = $("totalEvents")?.closest(".summary-card");
                highlightElement(totalEventsCard);
                highlightElement($("dashboardEventTable"));
                highlightElement($("eventTable"));
                showToast(`Live update: Event table modified (${eventType || "sync"}).`);
            } else if (table === "registrations") {
                const totalRegCard = $("totalRegistrations")?.closest(".summary-card");
                highlightElement(totalRegCard);
                highlightElement($("dashboardEventTable"));
                highlightElement($("recentRegistrationsTable"));
                showToast(`Live update: Event registrations synchronized in real-time.`);
            } else if (table === "students") {
                const totalParticipantsCard = $("totalParticipants")?.closest(".summary-card");
                highlightElement(totalParticipantsCard);
                highlightElement($("participantTable"));
                showToast("Live update: Student participant directory synchronized.");
            }
        } catch (err) {
            console.error("[Realtime] Sync error:", err);
            updateRealtimeBadge("active", "Live Sync Active");
        }
    }, 150);
}

function normalizeSupabaseUrl(url) {
    if (!url) return "";
    return String(url).trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
}

async function initRealtime() {
    // 1. Check Supabase credentials for client-side WebSocket subscription
    try {
        const config = await api("/api/config");
        const cleanUrl = normalizeSupabaseUrl(config && config.supabaseUrl);
        if (cleanUrl && config.supabaseAnonKey && window.supabase) {
            if (!supabaseClient) {
                supabaseClient = window.supabase.createClient(cleanUrl, config.supabaseAnonKey);
                console.log("[Supabase Realtime] Initializing browser WebSocket subscriptions on:", cleanUrl);

                realtimeChannel = supabaseClient.channel("supabase_realtime_events")
                    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, (payload) => {
                        console.log("[Supabase Realtime] Event table postgres_changes:", payload);
                        triggerRealtimeSync("events", payload.eventType, payload.new || payload.old);
                    })
                    .on("postgres_changes", { event: "*", schema: "public", table: "registrations" }, (payload) => {
                        console.log("[Supabase Realtime] Registration table postgres_changes:", payload);
                        triggerRealtimeSync("registrations", payload.eventType, payload.new || payload.old);
                    })
                    .on("postgres_changes", { event: "*", schema: "public", table: "students" }, (payload) => {
                        console.log("[Supabase Realtime] Student table postgres_changes:", payload);
                        triggerRealtimeSync("students", payload.eventType, payload.new || payload.old);
                    })
                    .subscribe((status) => {
                        if (status === "SUBSCRIBED") {
                            console.log("[Supabase Realtime] Browser channel subscribed successfully");
                            updateRealtimeBadge("active", "Supabase Realtime Live");
                        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                            console.info(`[Supabase Realtime] Channel inactive (${status}). Active sync: Live SSE Stream.`);
                            try {
                                if (realtimeChannel && supabaseClient) {
                                    supabaseClient.removeChannel(realtimeChannel);
                                    realtimeChannel = null;
                                }
                            } catch (_) {}
                            updateRealtimeBadge("active", "Live Sync Active");
                        }
                    });
            }
        } else {
            updateRealtimeBadge("active", "Live Sync Active");
        }
    } catch (err) {
        console.warn("[Realtime] Supabase config check:", err.message);
        updateRealtimeBadge("active", "Live Sync Active");
    }

    // 2. Also establish Server-Sent Events stream as instant synchronized listener
    initServerEventsStream();
}

function initServerEventsStream() {
    if (sseConnection) {
        sseConnection.close();
    }
    try {
        sseConnection = new EventSource("/api/realtime");
        sseConnection.onopen = () => {
            if (!supabaseClient) {
                updateRealtimeBadge("active", "Live Sync Active");
            }
        };
        sseConnection.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data && data.table) {
                    triggerRealtimeSync(data.table, data.eventType, data.record);
                }
            } catch {
                // Ignore non-JSON heartbeat pings
            }
        };
        sseConnection.onerror = () => {
            // EventSource will automatically retry in background
        };
    } catch (e) {
        console.warn("[Realtime SSE] Connection error:", e);
    }
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
        initRealtime();
    } catch {
        clearSession();
        showAuth("login");
    }
}

restoreSession();
initRealtime();

// ==========================================================================
// Progressive Web App (PWA) Engine: Service Worker, Install Prompt & Offline
// ==========================================================================

let deferredInstallPrompt = null;
const isPwaStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
const isIOSDevice = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());

function updatePwaInstallVisibility() {
    const pwaBtn = $("pwaInstallBtn");
    const authBtn = $("authInstallBtn");

    // Suppress in standalone installed mode
    if (isPwaStandalone) {
        if (pwaBtn) pwaBtn.classList.add("hidden");
        if (authBtn) authBtn.classList.add("hidden");
        return;
    }

    // Show when installable prompt was intercepted OR on iOS devices
    if (deferredInstallPrompt || isIOSDevice) {
        if (pwaBtn) pwaBtn.classList.remove("hidden");
        if (authBtn) authBtn.classList.remove("hidden");
    }
}

async function handlePwaInstallAction() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choiceResult = await deferredInstallPrompt.userChoice;
        console.log("[PWA] Install prompt outcome:", choiceResult.outcome);
        if (choiceResult.outcome === "accepted") {
            showToast("College Event App installation accepted!");
        }
        deferredInstallPrompt = null;
        updatePwaInstallVisibility();
    } else if (isIOSDevice) {
        const iosModal = $("iosInstallModal");
        if (iosModal) iosModal.classList.remove("hidden");
    } else {
        showToast("To install, select 'Install App' or 'Add to Home screen' from your browser menu.");
    }
}

function initPwa() {
    // 1. Register Service Worker with root scope
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker
                .register("/sw.js", { scope: "/" })
                .then((registration) => {
                    console.log("[PWA] Service Worker registered successfully (scope: " + registration.scope + ")");

                    // Detect service worker updates
                    registration.onupdatefound = () => {
                        const newWorker = registration.installing;
                        if (newWorker) {
                            newWorker.onstatechange = () => {
                                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                                    console.log("[PWA] Application update available.");
                                    showToast("Application update available. Refresh for latest features.");
                                }
                            };
                        }
                    };
                })
                .catch((err) => {
                    console.warn("[PWA] Service Worker registration failed:", err);
                });
        });
    }

    // 2. Capture Chromium / Android / Desktop BeforeInstallPromptEvent
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        console.log("[PWA] beforeinstallprompt event captured and ready for in-app trigger.");
        updatePwaInstallVisibility();
    });

    // 3. Handle App Installed Event
    window.addEventListener("appinstalled", () => {
        console.log("[PWA] Application successfully installed into system launcher.");
        deferredInstallPrompt = null;
        updatePwaInstallVisibility();
        showToast("College Event App installed to your device!");
    });

    // 4. Attach Install Button Event Listeners
    const pwaBtn = $("pwaInstallBtn");
    if (pwaBtn) {
        pwaBtn.addEventListener("click", handlePwaInstallAction);
    }

    const authBtn = $("authInstallBtn");
    if (authBtn) {
        authBtn.addEventListener("click", handlePwaInstallAction);
    }

    // 5. iOS Install Modal Dismissal
    const closeIosBtn = $("closeIosInstallModal");
    if (closeIosBtn) {
        closeIosBtn.addEventListener("click", () => {
            $("iosInstallModal")?.classList.add("hidden");
        });
    }

    const dismissIosBtn = $("dismissIosInstallModal");
    if (dismissIosBtn) {
        dismissIosBtn.addEventListener("click", () => {
            $("iosInstallModal")?.classList.add("hidden");
        });
    }

    // Close on backdrop click
    const iosModal = $("iosInstallModal");
    if (iosModal) {
        iosModal.addEventListener("click", (e) => {
            if (e.target === iosModal) {
                iosModal.classList.add("hidden");
            }
        });
    }

    // 6. Online / Offline Connectivity Detection
    function handleConnectivityChange() {
        const offlineIndicator = $("offlineIndicator");
        if (!navigator.onLine) {
            if (offlineIndicator) offlineIndicator.classList.remove("hidden");
            showToast("Offline Mode: Device disconnected. Serving cached records.");
        } else {
            if (offlineIndicator && !offlineIndicator.classList.contains("hidden")) {
                offlineIndicator.classList.add("hidden");
                showToast("Connection restored. Synchronizing live campus events...");
                if (getToken()) {
                    refreshData();
                }
            }
        }
    }

    window.addEventListener("online", handleConnectivityChange);
    window.addEventListener("offline", handleConnectivityChange);

    // Initial online state check
    if (!navigator.onLine) {
        const offlineIndicator = $("offlineIndicator");
        if (offlineIndicator) offlineIndicator.classList.remove("hidden");
    }

    // Check initial install button visibility
    updatePwaInstallVisibility();
}

initPwa();


import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

const FRONTEND_DIR = fs.existsSync(path.join(process.cwd(), "public", "index.html"))
  ? path.join(process.cwd(), "public")
  : fs.existsSync(path.join(process.cwd(), "frontend", "index.html"))
  ? path.join(process.cwd(), "frontend")
  : process.cwd();

// Lazy initialization for Google Gemini API client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required.");
    }
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return geminiClient;
}

function parseParamId(param: any): number {
  const str = Array.isArray(param) ? param[0] : String(param || "");
  return parseInt(str, 10);
}

const app = express();
app.use(cors());
app.use(express.json());

// Production Security Headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// --- Database Models & Types ---
export interface DbUser {
  id: number;
  full_name: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface DbSession {
  id: number;
  token: string;
  user_id: number;
  created_at: string;
}

export interface DbEvent {
  id: number;
  code: string;
  name: string;
  event_date: string;
  details: string;
  created_at: string;
}

export interface DbStudent {
  id: number;
  student_id: string;
  name: string;
  details: string;
  created_at: string;
}

export interface DbRegistration {
  id: number;
  student_pk: number;
  event_id: number;
  created_at: string;
}

// --- Password Hashing & Verification (PBKDF2 HMAC SHA-256) ---
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
  return `${salt.toString("hex")}$${digest.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [saltHex, digestHex] = stored.split("$");
    if (!saltHex || !digestHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(digestHex, "hex");
    const actual = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// --- Supabase Client & Local Fallback Store ---
export function normalizeSupabaseUrl(url?: string): string {
  if (!url) return "";
  let trimmed = url.trim();
  trimmed = trimmed.replace(/\/rest\/v1\/?$/i, "");
  trimmed = trimmed.replace(/\/+$/, "");
  return trimmed;
}

const rawSupabaseUrl = process.env.SUPABASE_URL;
const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Real-time listener client management
const sseClients = new Set<Response>();

export function broadcastRealtimeEvent(table: string, eventType: string, record: any) {
  const payload = JSON.stringify({
    table,
    eventType,
    record,
    timestamp: new Date().toISOString(),
  });
  const sseData = `data: ${payload}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(sseData);
    } catch {
      sseClients.delete(client);
    }
  }
}

let supabase: SupabaseClient | null = null;
let serverRealtimeChannel: any = null;
let serverRealtimeRetryTimeout: NodeJS.Timeout | null = null;

function setupServerRealtime() {
  if (!supabase) return;

  if (serverRealtimeChannel) {
    try {
      supabase.removeChannel(serverRealtimeChannel);
    } catch {}
    serverRealtimeChannel = null;
  }

  try {
    serverRealtimeChannel = supabase
      .channel("server-realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, (payload) => {
        console.log(`[Supabase Realtime] postgres_changes on events: ${payload.eventType}`);
        broadcastRealtimeEvent("events", payload.eventType, payload.new || payload.old);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "registrations" }, (payload) => {
        console.log(`[Supabase Realtime] postgres_changes on registrations: ${payload.eventType}`);
        broadcastRealtimeEvent("registrations", payload.eventType, payload.new || payload.old);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "students" }, (payload) => {
        console.log(`[Supabase Realtime] postgres_changes on students: ${payload.eventType}`);
        broadcastRealtimeEvent("students", payload.eventType, payload.new || payload.old);
      })
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("[Supabase Realtime] Server subscription active and listening for database changes");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.info(`[Supabase Realtime] Subscription status: ${status}. Fallback live sync active via SSE.`);
          if (serverRealtimeChannel) {
            try {
              supabase?.removeChannel(serverRealtimeChannel);
            } catch {}
            serverRealtimeChannel = null;
          }
          if (!serverRealtimeRetryTimeout) {
            serverRealtimeRetryTimeout = setTimeout(() => {
              serverRealtimeRetryTimeout = null;
              setupServerRealtime();
            }, 8000);
          }
        } else if (status === "CLOSED") {
          console.log("[Supabase Realtime] Server subscription closed");
        }
      });
  } catch (err: any) {
    console.info(`[Supabase Realtime] Note on realtime initialization: ${err.message}`);
  }
}

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    console.log(`[Database] Initialized Supabase PostgreSQL connection: ${supabaseUrl}`);

    // Setup Supabase Realtime channel subscription for live database changes
    setupServerRealtime();
  } catch (err: any) {
    console.warn(`[Database] Failed to initialize Supabase client: ${err.message}. Using local storage fallback.`);
  }
} else {
  console.log("[Database] Running with local database fallback. Configure SUPABASE_URL and SUPABASE_ANON_KEY to connect live Supabase PostgreSQL.");
}

// In-memory fallback dataset (exact seed data matching backend/seed.py)
let localUsers: DbUser[] = [
  {
    id: 1,
    full_name: "Authorized User",
    username: "admin",
    password_hash: hashPassword("admin123"),
    created_at: new Date().toISOString(),
  },
];

let localSessions: DbSession[] = [];

let localEvents: DbEvent[] = [
  { id: 1, code: "EV-001", name: "Technical Symposium", event_date: "2026-09-10", details: "College technical event", created_at: new Date().toISOString() },
  { id: 2, code: "EV-002", name: "Cultural Fest", event_date: "2026-09-15", details: "College cultural event", created_at: new Date().toISOString() },
  { id: 3, code: "EV-003", name: "Sports Meet", event_date: "2026-09-20", details: "College sports event", created_at: new Date().toISOString() },
  { id: 4, code: "EV-004", name: "Project Expo", event_date: "2026-09-25", details: "Student project event", created_at: new Date().toISOString() },
  { id: 5, code: "EV-005", name: "Coding Contest", event_date: "2026-10-02", details: "Programming event", created_at: new Date().toISOString() },
  { id: 6, code: "EV-006", name: "Quiz Competition", event_date: "2026-10-05", details: "General quiz event", created_at: new Date().toISOString() },
];

let localStudents: DbStudent[] = [
  { id: 1, student_id: "STU001", name: "Arun Kumar", details: "Computer Science", created_at: new Date().toISOString() },
  { id: 2, student_id: "STU002", name: "Priya S", details: "Electronics", created_at: new Date().toISOString() },
  { id: 3, student_id: "STU003", name: "Rahul M", details: "Information Technology", created_at: new Date().toISOString() },
  { id: 4, student_id: "STU004", name: "Divya R", details: "Mechanical", created_at: new Date().toISOString() },
  { id: 5, student_id: "STU005", name: "Karthik P", details: "Civil", created_at: new Date().toISOString() },
];

let localRegistrations: DbRegistration[] = [
  { id: 1, student_pk: 1, event_id: 1, created_at: new Date("2026-09-08T10:00:00Z").toISOString() },
  { id: 2, student_pk: 2, event_id: 1, created_at: new Date("2026-09-08T11:00:00Z").toISOString() },
  { id: 3, student_pk: 3, event_id: 2, created_at: new Date("2026-09-09T09:30:00Z").toISOString() },
  { id: 4, student_pk: 4, event_id: 3, created_at: new Date("2026-09-09T14:15:00Z").toISOString() },
  { id: 5, student_pk: 5, event_id: 4, created_at: new Date("2026-09-10T16:00:00Z").toISOString() },
];

let nextUserId = 2;
let nextSessionId = 1;
let nextEventId = 7;
let nextStudentId = 6;
let nextRegId = 6;

// --- Helper Functions ---
function getEventStatus(dateStr: string): "Upcoming" | "Completed" {
  const todayStr = new Date().toISOString().slice(0, 10);
  return dateStr >= todayStr ? "Upcoming" : "Completed";
}

function formatRegistrationDate(isoStr?: string): string | null {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(d.getDate()).padStart(2, "0");
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
}

// --- Data Access Layer (Supabase + Local Fallback) ---
const db = {
  async getUserByUsername(username: string): Promise<DbUser | null> {
    const cleanUsername = username.trim().toLowerCase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .ilike("username", cleanUsername)
          .maybeSingle();
        if (!error && data) return data as DbUser;
      } catch (e) {
        console.warn("Supabase query error (users):", e);
      }
    }
    return localUsers.find((u) => u.username.toLowerCase() === cleanUsername) || null;
  },

  async getUserById(id: number): Promise<DbUser | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (!error && data) return data as DbUser;
      } catch (e) {
        console.warn("Supabase query error (users):", e);
      }
    }
    return localUsers.find((u) => u.id === id) || null;
  },

  async createUser(fullName: string, username: string, passwordHash: string): Promise<DbUser> {
    const cleanUsername = username.trim();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("users")
          .insert({
            full_name: fullName.trim(),
            username: cleanUsername,
            password_hash: passwordHash,
          })
          .select()
          .single();
        if (!error && data) return data as DbUser;
      } catch (e) {
        console.warn("Supabase insert error (users):", e);
      }
    }
    const newUser: DbUser = {
      id: nextUserId++,
      full_name: fullName.trim(),
      username: cleanUsername,
      password_hash: passwordHash,
      created_at: new Date().toISOString(),
    };
    localUsers.push(newUser);
    return newUser;
  },

  async createSession(userId: number, token: string): Promise<DbSession> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .insert({ user_id: userId, token })
          .select()
          .single();
        if (!error && data) return data as DbSession;
      } catch (e) {
        console.warn("Supabase insert error (sessions):", e);
      }
    }
    const session: DbSession = {
      id: nextSessionId++,
      token,
      user_id: userId,
      created_at: new Date().toISOString(),
    };
    localSessions.push(session);
    return session;
  },

  async getUserByToken(token: string): Promise<DbUser | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("user_id")
          .eq("token", token)
          .maybeSingle();
        if (!error && data) {
          return await this.getUserById(data.user_id);
        }
      } catch (e) {
        console.warn("Supabase query error (sessions):", e);
      }
    }
    const session = localSessions.find((s) => s.token === token);
    if (!session) return null;
    return localUsers.find((u) => u.id === session.user_id) || null;
  },

  async deleteSession(token: string): Promise<void> {
    if (supabase) {
      try {
        await supabase.from("sessions").delete().eq("token", token);
      } catch (e) {
        console.warn("Supabase delete error (sessions):", e);
      }
    }
    localSessions = localSessions.filter((s) => s.token !== token);
  },

  // Events
  async getEvents(): Promise<(DbEvent & { registration_count: number; status: string })[]> {
    let eventsList: DbEvent[] = [];
    let regCounts: Record<number, number> = {};

    if (supabase) {
      try {
        const { data: eventsData, error: evError } = await supabase
          .from("events")
          .select("*")
          .order("event_date", { ascending: true });
        const { data: regData } = await supabase
          .from("registrations")
          .select("event_id");

        if (!evError && eventsData) {
          eventsList = eventsData as DbEvent[];
          if (regData) {
            regData.forEach((r: any) => {
              regCounts[r.event_id] = (regCounts[r.event_id] || 0) + 1;
            });
          }
          return eventsList.map((ev) => ({
            ...ev,
            registration_count: regCounts[ev.id] || 0,
            status: getEventStatus(ev.event_date),
          }));
        }
      } catch (e) {
        console.warn("Supabase query error (events):", e);
      }
    }

    localRegistrations.forEach((r) => {
      regCounts[r.event_id] = (regCounts[r.event_id] || 0) + 1;
    });

    return localEvents
      .slice()
      .sort((a, b) => a.event_date.localeCompare(b.event_date))
      .map((ev) => ({
        ...ev,
        registration_count: regCounts[ev.id] || 0,
        status: getEventStatus(ev.event_date),
      }));
  },

  async getEventById(id: number): Promise<(DbEvent & { registration_count: number; status: string }) | null> {
    const all = await this.getEvents();
    return all.find((e) => e.id === id) || null;
  },

  async getNextEventCode(): Promise<string> {
    const all = await this.getEvents();
    let maxNum = 0;
    all.forEach((ev) => {
      if (ev.code && ev.code.startsWith("EV-")) {
        const num = parseInt(ev.code.split("-")[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    return `EV-${String(maxNum + 1).padStart(3, "0")}`;
  },

  async createEvent(name: string, event_date: string, details: string): Promise<DbEvent & { registration_count: number; status: string }> {
    const code = await this.getNextEventCode();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("events")
          .insert({ code, name: name.trim(), event_date, details: details.trim() })
          .select()
          .single();
        if (!error && data) {
          return {
            ...(data as DbEvent),
            registration_count: 0,
            status: getEventStatus(data.event_date),
          };
        }
      } catch (e) {
        console.warn("Supabase insert error (events):", e);
      }
    }

    const newEvent: DbEvent = {
      id: nextEventId++,
      code,
      name: name.trim(),
      event_date,
      details: details.trim(),
      created_at: new Date().toISOString(),
    };
    localEvents.push(newEvent);
    return {
      ...newEvent,
      registration_count: 0,
      status: getEventStatus(newEvent.event_date),
    };
  },

  async updateEvent(id: number, updates: Partial<{ name: string; event_date: string; details: string }>): Promise<(DbEvent & { registration_count: number; status: string }) | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("events")
          .update(updates)
          .eq("id", id)
          .select()
          .single();
        if (!error && data) {
          const ev = data as DbEvent;
          const regCount = (await this.getRegistrationsByEventId(id)).length;
          return { ...ev, registration_count: regCount, status: getEventStatus(ev.event_date) };
        }
      } catch (e) {
        console.warn("Supabase update error (events):", e);
      }
    }

    const idx = localEvents.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    localEvents[idx] = { ...localEvents[idx], ...updates };
    const ev = localEvents[idx];
    const regCount = localRegistrations.filter((r) => r.event_id === id).length;
    return { ...ev, registration_count: regCount, status: getEventStatus(ev.event_date) };
  },

  async deleteEvent(id: number): Promise<boolean> {
    if (supabase) {
      try {
        const { error } = await supabase.from("events").delete().eq("id", id);
        if (!error) return true;
      } catch (e) {
        console.warn("Supabase delete error (events):", e);
      }
    }

    const idx = localEvents.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    localEvents.splice(idx, 1);
    localRegistrations = localRegistrations.filter((r) => r.event_id !== id);
    return true;
  },

  // Students
  async getStudents(): Promise<DbStudent[]> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("students")
          .select("*")
          .order("student_id", { ascending: true });
        if (!error && data) return data as DbStudent[];
      } catch (e) {
        console.warn("Supabase query error (students):", e);
      }
    }
    return localStudents.slice().sort((a, b) => a.student_id.localeCompare(b.student_id));
  },

  async getStudentById(id: number): Promise<DbStudent | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase.from("students").select("*").eq("id", id).maybeSingle();
        if (!error && data) return data as DbStudent;
      } catch (e) {
        console.warn("Supabase query error (students):", e);
      }
    }
    return localStudents.find((s) => s.id === id) || null;
  },

  async getStudentByStudentId(studentId: string): Promise<DbStudent | null> {
    const cleanId = studentId.trim().toLowerCase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("students")
          .select("*")
          .ilike("student_id", cleanId)
          .maybeSingle();
        if (!error && data) return data as DbStudent;
      } catch (e) {
        console.warn("Supabase query error (students):", e);
      }
    }
    return localStudents.find((s) => s.student_id.toLowerCase() === cleanId) || null;
  },

  async upsertStudent(studentId: string, name: string, details: string = ""): Promise<DbStudent> {
    const cleanId = studentId.trim();
    const cleanName = name.trim();
    const cleanDetails = details.trim();

    const existing = await this.getStudentByStudentId(cleanId);
    if (existing) {
      if (cleanName && existing.name !== cleanName || cleanDetails && existing.details !== cleanDetails) {
        return (await this.updateStudent(existing.id, { name: cleanName, details: cleanDetails })) || existing;
      }
      return existing;
    }

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("students")
          .insert({ student_id: cleanId, name: cleanName, details: cleanDetails })
          .select()
          .single();
        if (!error && data) return data as DbStudent;
      } catch (e) {
        console.warn("Supabase insert error (students):", e);
      }
    }

    const newStudent: DbStudent = {
      id: nextStudentId++,
      student_id: cleanId,
      name: cleanName,
      details: cleanDetails,
      created_at: new Date().toISOString(),
    };
    localStudents.push(newStudent);
    return newStudent;
  },

  async updateStudent(id: number, updates: Partial<{ student_id: string; name: string; details: string }>): Promise<DbStudent | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("students")
          .update(updates)
          .eq("id", id)
          .select()
          .single();
        if (!error && data) return data as DbStudent;
      } catch (e) {
        console.warn("Supabase update error (students):", e);
      }
    }

    const idx = localStudents.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    localStudents[idx] = { ...localStudents[idx], ...updates };
    return localStudents[idx];
  },

  async deleteStudent(id: number): Promise<boolean> {
    if (supabase) {
      try {
        const { error } = await supabase.from("students").delete().eq("id", id);
        if (!error) return true;
      } catch (e) {
        console.warn("Supabase delete error (students):", e);
      }
    }

    const idx = localStudents.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    localStudents.splice(idx, 1);
    localRegistrations = localRegistrations.filter((r) => r.student_pk !== id);
    return true;
  },

  // Registrations
  async getRegistrations(eventId?: number): Promise<any[]> {
    if (supabase) {
      try {
        let query = supabase
          .from("registrations")
          .select("id, student_pk, event_id, created_at, students(student_id, name, details), events(id, code, name, event_date)");
        if (eventId) {
          query = query.eq("event_id", eventId);
        }
        const { data, error } = await query;
        if (!error && data) {
          return data.map((r: any) => ({
            id: r.id,
            student_id: r.students?.student_id || "",
            student_name: r.students?.name || "",
            student_details: r.students?.details || "",
            event_id: r.events?.id || r.event_id,
            event_code: r.events?.code || "",
            event_name: r.events?.name || "",
            event_date: r.events?.event_date || "",
            created_at: formatRegistrationDate(r.created_at),
          }));
        }
      } catch (e) {
        console.warn("Supabase query error (registrations):", e);
      }
    }

    let list = localRegistrations;
    if (eventId) {
      list = list.filter((r) => r.event_id === eventId);
    }

    return list.map((r) => {
      const student = localStudents.find((s) => s.id === r.student_pk);
      const event = localEvents.find((e) => e.id === r.event_id);
      return {
        id: r.id,
        student_id: student?.student_id || "",
        student_name: student?.name || "",
        student_details: student?.details || "",
        event_id: event?.id || r.event_id,
        event_code: event?.code || "",
        event_name: event?.name || "",
        event_date: event?.event_date || "",
        created_at: formatRegistrationDate(r.created_at),
      };
    });
  },

  async getRegistrationsByEventId(eventId: number): Promise<any[]> {
    return this.getRegistrations(eventId);
  },

  async findRegistration(studentPk: number, eventId: number): Promise<DbRegistration | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("registrations")
          .select("*")
          .eq("student_pk", studentPk)
          .eq("event_id", eventId)
          .maybeSingle();
        if (!error && data) return data as DbRegistration;
      } catch (e) {
        console.warn("Supabase query error (registrations):", e);
      }
    }
    return localRegistrations.find((r) => r.student_pk === studentPk && r.event_id === eventId) || null;
  },

  async createRegistration(studentPk: number, eventId: number): Promise<any> {
    // Duplicate check enforcement (NFR-07)
    const existing = await this.findRegistration(studentPk, eventId);
    if (existing) {
      throw new Error("Student is already registered for this event.");
    }

    let createdRecord: DbRegistration;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("registrations")
          .insert({ student_pk: studentPk, event_id: eventId })
          .select()
          .single();
        if (error) {
          if (error.code === "23505" || error.message.includes("uq_student_event")) {
            throw new Error("Student is already registered for this event.");
          }
          throw error;
        }
        createdRecord = data as DbRegistration;
      } catch (e: any) {
        if (e.message?.includes("already registered")) throw e;
        console.warn("Supabase insert error (registrations):", e);
        createdRecord = {
          id: nextRegId++,
          student_pk: studentPk,
          event_id: eventId,
          created_at: new Date().toISOString(),
        };
        localRegistrations.push(createdRecord);
      }
    } else {
      createdRecord = {
        id: nextRegId++,
        student_pk: studentPk,
        event_id: eventId,
        created_at: new Date().toISOString(),
      };
      localRegistrations.push(createdRecord);
    }

    const student = await this.getStudentById(studentPk);
    const event = await this.getEventById(eventId);

    return {
      id: createdRecord.id,
      student_id: student?.student_id || "",
      student_name: student?.name || "",
      student_details: student?.details || "",
      event_id: event?.id || eventId,
      event_code: event?.code || "",
      event_name: event?.name || "",
      event_date: event?.event_date || "",
      created_at: formatRegistrationDate(createdRecord.created_at),
    };
  },

  async deleteRegistration(id: number): Promise<boolean> {
    if (supabase) {
      try {
        const { error } = await supabase.from("registrations").delete().eq("id", id);
        if (!error) return true;
      } catch (e) {
        console.warn("Supabase delete error (registrations):", e);
      }
    }

    const idx = localRegistrations.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    localRegistrations.splice(idx, 1);
    return true;
  },

  // Global Unified Search across Events, Students, Registrations
  async search(query: string): Promise<any[]> {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    const results: any[] = [];
    const [events, students, registrations] = await Promise.all([
      this.getEvents(),
      this.getStudents(),
      this.getRegistrations(),
    ]);

    // 1. Events
    events.forEach((e) => {
      if (
        e.name.toLowerCase().includes(term) ||
        e.code.toLowerCase().includes(term) ||
        (e.details && e.details.toLowerCase().includes(term))
      ) {
        results.push({
          type: "Event",
          name: e.name,
          event_date: e.event_date,
          student_id: null,
          information: e.details || e.code,
        });
      }
    });

    // 2. Participants / Students
    students.forEach((s) => {
      if (
        s.name.toLowerCase().includes(term) ||
        s.student_id.toLowerCase().includes(term) ||
        (s.details && s.details.toLowerCase().includes(term))
      ) {
        results.push({
          type: "Participant",
          name: s.name,
          event_date: null,
          student_id: s.student_id,
          information: s.details || "Student record",
        });
      }
    });

    // 3. Registrations
    registrations.forEach((r) => {
      if (
        r.student_name.toLowerCase().includes(term) ||
        r.student_id.toLowerCase().includes(term) ||
        r.event_name.toLowerCase().includes(term) ||
        r.event_code.toLowerCase().includes(term)
      ) {
        results.push({
          type: "Registration",
          name: r.event_name,
          event_date: r.event_date,
          student_id: r.student_id,
          information: `${r.student_name} (${r.student_id}) enrolled for ${r.event_name}`,
        });
      }
    });

    return results;
  },

  // Dashboard Aggregates
  async getDashboard(): Promise<any> {
    const [events, students, registrations] = await Promise.all([
      this.getEvents(),
      this.getStudents(),
      this.getRegistrations(),
    ]);

    return {
      total_events: events.length,
      total_registrations: registrations.length,
      total_students: students.length,
      total_participants: students.length,
      total_reports: events.length,
      events,
    };
  },

  // Registration Report
  async getReport(eventId: number): Promise<any | null> {
    const event = await this.getEventById(eventId);
    if (!event) return null;

    const registrations = await this.getRegistrationsByEventId(eventId);
    const now = new Date();
    const formattedDate = `${String(now.getDate()).padStart(2, "0")} ${
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][now.getMonth()]
    } ${now.getFullYear()}, ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;

    return {
      event,
      total_registrations: registrations.length,
      generated_at: formattedDate,
      registrations,
    };
  },

  // Comprehensive Analytics Aggregation for AI Management Assistant
  async getAnalyticsSummary(): Promise<any> {
    const [events, students, registrations] = await Promise.all([
      this.getEvents(),
      this.getStudents(),
      this.getRegistrations(),
    ]);

    // Department grouping from students
    const deptCounts: Record<string, number> = {};
    students.forEach((s) => {
      const dept = (s.details || "General / Unspecified").trim();
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });

    // Event engagement analysis
    const upcomingEvents = events.filter((e) => e.status === "Upcoming");
    const completedEvents = events.filter((e) => e.status === "Completed");

    const highRegistrationEvents = [...events].sort((a, b) => b.registration_count - a.registration_count);
    const lowRegistrationEvents = [...upcomingEvents].sort((a, b) => a.registration_count - b.registration_count);

    return {
      totals: {
        events: events.length,
        upcoming: upcomingEvents.length,
        completed: completedEvents.length,
        students: students.length,
        registrations: registrations.length,
      },
      departments: deptCounts,
      events: events.map((e) => ({
        code: e.code,
        name: e.name,
        date: e.event_date,
        status: e.status,
        registrations: e.registration_count,
        details: e.details,
      })),
      recentRegistrations: registrations.slice(0, 15).map((r) => ({
        student: `${r.student_name} (${r.student_id})`,
        event: `${r.event_name} [${r.event_code}]`,
        date: r.event_date,
      })),
      highlights: {
        mostPopular: highRegistrationEvents[0] ? `${highRegistrationEvents[0].name} (${highRegistrationEvents[0].registration_count} enrolled)` : "None",
        attentionNeeded: lowRegistrationEvents.filter((e) => e.registration_count === 0).map((e) => `${e.name} (${e.code}, ${e.event_date})`),
      },
    };
  },
};

// --- Authentication Middleware ---
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ detail: "Please log in to continue." });
  }

  const token = authHeader.substring(7).trim();
  const user = await db.getUserByToken(token);
  if (!user) {
    return res.status(401).json({ detail: "Session expired. Please log in again." });
  }

  (req as any).user = user;
  (req as any).token = token;
  next();
}

// --- REST API Endpoints ---

// 1. Authentication
app.post("/api/auth/register", async (req: Request, res: Response) => {
  const { full_name, username, password } = req.body || {};

  if (!full_name || full_name.length < 2 || full_name.length > 120) {
    return res.status(422).json({ detail: "Full name must be between 2 and 120 characters." });
  }
  if (!username || username.length < 3 || username.length > 80) {
    return res.status(422).json({ detail: "Username must be between 3 and 80 characters." });
  }
  if (!password || password.length < 6 || password.length > 128) {
    return res.status(422).json({ detail: "Password must be between 6 and 128 characters." });
  }

  const existing = await db.getUserByUsername(username);
  if (existing) {
    return res.status(400).json({ detail: "Username already exists." });
  }

  const user = await db.createUser(full_name, username, hashPassword(password));
  const token = crypto.randomBytes(32).toString("hex");
  await db.createSession(user.id, token);

  return res.status(201).json({
    token,
    user: { id: user.id, full_name: user.full_name, username: user.username },
  });
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(401).json({ detail: "Invalid username or password." });
  }

  const user = await db.getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ detail: "Invalid username or password." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  await db.createSession(user.id, token);

  return res.json({
    token,
    user: { id: user.id, full_name: user.full_name, username: user.username },
  });
});

app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user as DbUser;
  res.json({ id: user.id, full_name: user.full_name, username: user.username });
});

app.post("/api/auth/logout", requireAuth, async (req: Request, res: Response) => {
  const token = (req as any).token as string;
  await db.deleteSession(token);
  res.json({ message: "Logged out." });
});

// 2. Dashboard
app.get("/api/dashboard", requireAuth, async (_req: Request, res: Response) => {
  const data = await db.getDashboard();
  res.json(data);
});

// 3. Events CRUD
app.get("/api/events", requireAuth, async (_req: Request, res: Response) => {
  const events = await db.getEvents();
  res.json(events);
});

app.post("/api/events", requireAuth, async (req: Request, res: Response) => {
  const { name, event_date, details } = req.body || {};

  if (!name || name.trim().length < 2 || name.trim().length > 150) {
    return res.status(422).json({ detail: "Event name must be between 2 and 150 characters." });
  }
  if (!event_date) {
    return res.status(422).json({ detail: "Event date is required." });
  }

  const newEvent = await db.createEvent(name, event_date, details || "");
  broadcastRealtimeEvent("events", "INSERT", newEvent);
  res.status(201).json(newEvent);
});

app.put("/api/events/:id", requireAuth, async (req: Request, res: Response) => {
  const eventId = parseParamId(req.params.id);
  if (isNaN(eventId)) {
    return res.status(404).json({ detail: "Event not found." });
  }

  const { name, event_date, details } = req.body || {};
  const updates: any = {};
  if (name !== undefined) updates.name = name.trim();
  if (event_date !== undefined) updates.event_date = event_date;
  if (details !== undefined) updates.details = details.trim();

  const updated = await db.updateEvent(eventId, updates);
  if (!updated) {
    return res.status(404).json({ detail: "Event not found." });
  }
  broadcastRealtimeEvent("events", "UPDATE", updated);
  res.json(updated);
});

app.delete("/api/events/:id", requireAuth, async (req: Request, res: Response) => {
  const eventId = parseParamId(req.params.id);
  if (isNaN(eventId)) {
    return res.status(404).json({ detail: "Event not found." });
  }

  const success = await db.deleteEvent(eventId);
  if (!success) {
    return res.status(404).json({ detail: "Event not found." });
  }
  broadcastRealtimeEvent("events", "DELETE", { id: eventId });
  res.json({ message: "Event deleted." });
});

// 4. Students CRUD
app.get("/api/students", requireAuth, async (_req: Request, res: Response) => {
  const students = await db.getStudents();
  res.json(students);
});

app.post("/api/students", requireAuth, async (req: Request, res: Response) => {
  const { student_id, name, details } = req.body || {};

  if (!student_id || student_id.trim().length < 2 || student_id.trim().length > 50) {
    return res.status(422).json({ detail: "Student ID must be between 2 and 50 characters." });
  }
  if (!name || name.trim().length < 2 || name.trim().length > 120) {
    return res.status(422).json({ detail: "Student name must be between 2 and 120 characters." });
  }

  const student = await db.upsertStudent(student_id, name, details || "");
  broadcastRealtimeEvent("students", "UPSERT", student);
  res.json(student);
});

app.put("/api/students/:id", requireAuth, async (req: Request, res: Response) => {
  const studentPk = parseParamId(req.params.id);
  if (isNaN(studentPk)) {
    return res.status(404).json({ detail: "Student not found." });
  }

  const { student_id, name, details } = req.body || {};
  const updates: any = {};
  if (student_id !== undefined) updates.student_id = student_id.trim();
  if (name !== undefined) updates.name = name.trim();
  if (details !== undefined) updates.details = details.trim();

  const updated = await db.updateStudent(studentPk, updates);
  if (!updated) {
    return res.status(404).json({ detail: "Student not found." });
  }
  broadcastRealtimeEvent("students", "UPDATE", updated);
  res.json(updated);
});

app.delete("/api/students/:id", requireAuth, async (req: Request, res: Response) => {
  const studentPk = parseParamId(req.params.id);
  if (isNaN(studentPk)) {
    return res.status(404).json({ detail: "Student not found." });
  }

  const success = await db.deleteStudent(studentPk);
  if (!success) {
    return res.status(404).json({ detail: "Student not found." });
  }
  broadcastRealtimeEvent("students", "DELETE", { id: studentPk });
  res.json({ message: "Student deleted." });
});

// 5. Registrations CRUD & Duplicate Prevention
app.get("/api/registrations", requireAuth, async (req: Request, res: Response) => {
  const eventIdParam = req.query.event_id;
  const eventId = eventIdParam ? parseInt(String(eventIdParam), 10) : undefined;
  const list = await db.getRegistrations(eventId);
  res.json(list);
});

app.post("/api/registrations", requireAuth, async (req: Request, res: Response) => {
  const { student_id, student_name, event_id } = req.body || {};

  if (!student_id || student_id.trim().length < 2 || student_id.trim().length > 50) {
    return res.status(422).json({ detail: "Student ID is required." });
  }
  if (!student_name || student_name.trim().length < 2 || student_name.trim().length > 120) {
    return res.status(422).json({ detail: "Student name is required." });
  }
  if (!event_id) {
    return res.status(422).json({ detail: "Event selection is required." });
  }

  const event = await db.getEventById(Number(event_id));
  if (!event) {
    return res.status(404).json({ detail: "Event not found." });
  }

  // Get or upsert student record
  const student = await db.upsertStudent(student_id, student_name);

  try {
    const reg = await db.createRegistration(student.id, event.id);
    broadcastRealtimeEvent("registrations", "INSERT", reg);
    return res.status(201).json(reg);
  } catch (err: any) {
    if (err.message && err.message.includes("already registered")) {
      return res.status(400).json({ detail: "Student is already registered for this event." });
    }
    return res.status(500).json({ detail: err.message || "Failed to complete registration." });
  }
});

app.delete("/api/registrations/:id", requireAuth, async (req: Request, res: Response) => {
  const regId = parseParamId(req.params.id);
  if (isNaN(regId)) {
    return res.status(404).json({ detail: "Registration not found." });
  }

  const success = await db.deleteRegistration(regId);
  if (!success) {
    return res.status(404).json({ detail: "Registration not found." });
  }
  broadcastRealtimeEvent("registrations", "DELETE", { id: regId });
  res.json({ message: "Registration deleted." });
});

// 6. Universal Search
app.get("/api/search", requireAuth, async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  const results = await db.search(q);
  res.json(results);
});

// 7. Reports
app.get("/api/reports/:id", requireAuth, async (req: Request, res: Response) => {
  const eventId = parseParamId(req.params.id);
  if (isNaN(eventId)) {
    return res.status(404).json({ detail: "Event not found." });
  }

  const report = await db.getReport(eventId);
  if (!report) {
    return res.status(404).json({ detail: "Event not found." });
  }
  res.json(report);
});

// 8. AI Management Data Analysis Assistant (Powered by Gemini)
app.post("/api/ai/analyze", requireAuth, async (req: Request, res: Response) => {
  try {
    const { query, focusArea } = req.body || {};
    const sanitizedQuery =
      query && typeof query === "string" && query.trim().length > 0
        ? query.trim()
        : "Provide a comprehensive institutional management summary of all campus events, student enrollment, and capacity risks.";

    const summary = await db.getAnalyticsSummary();
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
    let textOutput = "";

    if (!hasApiKey) {
      // Deterministic analytical report based on live database statistics
      const totalEvents = summary.totals.events;
      const totalStudents = summary.totals.students;
      const totalRegistrations = summary.totals.registrations;
      const avgPerEvent = totalEvents > 0 ? (totalRegistrations / totalEvents).toFixed(1) : "0";

      const eventLines = summary.eventBreakdown
        .map((e: any) => `- **${e.name}** (${e.code}, ${e.date}): **${e.registrationCount}** registrations (${e.sharePercent}% of total)`)
        .join("\n");

      const topDeptLines = summary.departmentBreakdown
        .map((d: any) => `- **${d.department}**: **${d.studentCount}** registered students`)
        .join("\n");

      textOutput = `### 🏛️ Institutional Executive Summary

**Operational Snapshot:**
- **Total Campus Events**: ${totalEvents}
- **Total Registered Students**: ${totalStudents}
- **Total Event Registrations**: ${totalRegistrations}
- **Average Registrations per Event**: ${avgPerEvent}

---

### 📊 Event Participation Breakdown
${eventLines || "- No active event records found."}

---

### 🎓 Department Engagement
${topDeptLines || "- No departmental records logged."}

---

### ⚠️ Operational Observations & Capacity Assessment
- Events with the highest engagement represent the primary focus of current campus enrollment.
- Duplicate prevention rules are actively enforced across all departments to prevent duplicate bookings.
- Continuous roster audits are recommended 48 hours prior to each event's scheduled date.

---

### 🎯 Strategic Recommendations
1. **Targeted Department Outreach**: Promote under-enrolled event categories to departments with lower participation.
2. **Capacity Monitoring**: Review event attendance thresholds for scheduled dates.
3. **Automated Reminders**: Ensure registered students receive confirmation details prior to event commencement.

*(Note: Computed by internal institutional analytics engine. To enable Google Gemini AI synthesis, provide GEMINI_API_KEY in your environment settings).*`;
    } else {
      const ai = getGeminiClient();

      const systemPrompt = `You are a Senior Institutional Event Administrator and Data Analyst for a College Event Registration Management System.
Your job is to analyze live campus registration and event records and provide an objective, data-driven, and actionable executive analysis.

Guidelines:
- Base your analysis STRICTLY on the actual database records provided below.
- Do NOT fabricate fictional students, events, or numbers.
- Provide a clear, professional analysis using Markdown formatting with sections:
  1. **Executive Overview**: High-level snapshot of event operations and registration health.
  2. **Participation & Event Performance**: Detailed assessment of high-demand events vs low-enrollment events.
  3. **Department Engagement**: Observations about student representation across departments.
  4. **Operational Risks & Capacity Bottlenecks**: Upcoming deadlines, low-capacity risks, or imbalance.
  5. **Strategic Action Items**: 3-4 concrete, prioritized recommendations for college coordinators.
- Keep the tone professional, concise, constructive, and institutional.`;

      const userPrompt = `Institutional Database Records:
${JSON.stringify(summary, null, 2)}

Administrator Inquiry / Focus Area:
"${sanitizedQuery}"
${focusArea ? `Additional Focus Constraint: ${focusArea}` : ""}

Please provide your comprehensive analysis based strictly on the data above.`;

      const candidateModels = ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.8-flash"];
      let lastError: any = null;

      for (const model of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: userPrompt,
            config: {
              systemInstruction: systemPrompt,
            },
          });
          textOutput = response.text || "";
          if (textOutput) break;
        } catch (modelErr: any) {
          lastError = modelErr;
          console.warn(`[Gemini API] Model ${model} unavailable: ${modelErr?.message || modelErr}, trying next model...`);
        }
      }

      if (!textOutput) {
        throw lastError || new Error("AI models returned empty output.");
      }
    }

    res.json({
      success: true,
      query: sanitizedQuery,
      analysis: textOutput,
      timestamp: new Date().toISOString(),
      metrics: summary.totals,
      highlights: summary.highlights,
    });
  } catch (err: any) {
    console.error("[Gemini API] Analysis error:", err);
    const message = err?.message || "Failed to process AI management analysis.";
    res.status(500).json({ detail: message });
  }
});

// Health check endpoint
app.get(["/health", "/api/health"], (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    database: supabase ? "supabase_postgresql" : "local_database_engine",
    supabase_configured: Boolean(supabase),
  });
});

// 8. System Config & Real-time Live Events Endpoint
app.get("/api/config", (_req: Request, res: Response) => {
  res.json({
    supabaseUrl: supabaseUrl || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    realtimeEnabled: Boolean(supabaseUrl && process.env.SUPABASE_ANON_KEY),
  });
});

app.get("/api/realtime", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

// Periodic heartbeat so proxy connections (like Cloud Run) remain alive
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(":heartbeat\n\n");
    } catch {
      sseClients.delete(client);
    }
  }
}, 25000);

// Frontend PWA Service Worker and Manifest explicit routes
app.get("/sw.js", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(FRONTEND_DIR, "sw.js"));
});

app.get(["/manifest.webmanifest", "/manifest.json"], (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(FRONTEND_DIR, "manifest.webmanifest"));
});

// Frontend Static File Serving
app.use(express.static(FRONTEND_DIR));

app.use((req: Request, res: Response) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ detail: "Not found." });
  }
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

if (!process.env.VERCEL) {
  const PORT = parseInt(process.env.PORT || "3000", 10);
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`College Event Registration Management System running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown handling for containerized production environments (Cloud Run, Docker, Kubernetes)
  const gracefulShutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}. Starting graceful shutdown...`);
    for (const client of sseClients) {
      try {
        client.write("event: shutdown\ndata: {}\n\n");
        client.end();
      } catch {}
    }
    sseClients.clear();

    if (serverRealtimeChannel && supabase) {
      try {
        supabase.removeChannel(serverRealtimeChannel);
      } catch {}
    }

    server.close(() => {
      console.log("[Server] HTTP server closed cleanly. Exiting process.");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("[Server] Forced shutdown after timeout.");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

export { app };
export default app;

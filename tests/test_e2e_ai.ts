import assert from "assert";

const BASE_URL = "http://localhost:3000";

async function runTestSuite() {
  console.log("=== STARTING FULL SYSTEM VERIFICATION SUITE ===\n");
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`Testing ${name}... `);
    try {
      await fn();
      console.log("PASSED ✓");
      passed++;
    } catch (err: any) {
      console.log(`FAILED ✗ (${err.message})`);
      failed++;
    }
  }

  // 1. Health check
  await test("System Health & Database (/health)", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, "ok");
    assert.ok(data.database);
  });

  // 2. Config check
  await test("System Configuration (/api/config)", async () => {
    const res = await fetch(`${BASE_URL}/api/config`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok("realtimeEnabled" in data);
  });

  // 3. Authentication
  let authToken = "";
  await test("Authentication Login (/api/auth/login)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.token, "Expected session token");
    authToken = data.token;
  });

  // 4. Authenticated profile check
  await test("Profile Verification (/api/auth/me)", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    const user = await res.json();
    assert.strictEqual(user.username, "admin");
  });

  // 5. Dashboard Data
  await test("Dashboard Summary Aggregation (/api/dashboard)", async () => {
    const res = await fetch(`${BASE_URL}/api/dashboard`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    const d = await res.json();
    assert.ok(typeof d.total_events === "number");
    assert.ok(typeof d.total_students === "number");
    assert.ok(typeof d.total_registrations === "number");
    assert.ok(Array.isArray(d.events));
  });

  // 6. Events API
  let sampleEventId = 0;
  await test("Events Management API (/api/events)", async () => {
    const res = await fetch(`${BASE_URL}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    const events = await res.json();
    assert.ok(Array.isArray(events));
    assert.ok(events.length > 0);
    sampleEventId = events[0].id;
  });

  // 7. Students API
  await test("Students Management API (/api/students)", async () => {
    const res = await fetch(`${BASE_URL}/api/students`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    const students = await res.json();
    assert.ok(Array.isArray(students));
    assert.ok(students.length > 0);
  });

  // 8. Registrations API
  await test("Registrations API (/api/registrations)", async () => {
    const res = await fetch(`${BASE_URL}/api/registrations`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    const regs = await res.json();
    assert.ok(Array.isArray(regs));
  });

  // 9. Search API
  await test("Global Search API (/api/search)", async () => {
    const res = await fetch(`${BASE_URL}/api/search?q=a`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    const results = await res.json();
    assert.ok(Array.isArray(results));
  });

  // 10. Reports API
  await test("Reports Generation API (/api/reports/:id)", async () => {
    assert.ok(sampleEventId > 0, "No event ID available for report test");
    const res = await fetch(`${BASE_URL}/api/reports/${sampleEventId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    const report = await res.json();
    assert.ok(report.event);
    assert.ok(Array.isArray(report.registrations));
  });

  // 11. AI Assistant Endpoint - Security check (Unauthenticated)
  await test("AI Assistant Security - Rejects Unauthenticated Requests", async () => {
    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Test" }),
    });
    assert.strictEqual(res.status, 401, "Unauthenticated request should return 401 Unauthorized");
  });

  // 12. AI Assistant Endpoint - Executive Summary with live database data
  await test("AI Assistant - Live Data Executive Summary Analysis", async () => {
    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Provide a comprehensive executive summary of all college events, enrollment health, and capacity.",
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(typeof data.analysis === "string" && data.analysis.length > 50, "Expected detailed analysis prose");
    assert.ok(data.metrics, "Expected aggregate metrics in response");
    assert.ok(typeof data.metrics.events === "number");
    assert.ok(typeof data.metrics.students === "number");
  });

  // 13. AI Assistant Endpoint - Department engagement custom query
  await test("AI Assistant - Department Participation Custom Inquiry", async () => {
    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Analyze student registration distribution by department and identify engagement gaps.",
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.analysis.length > 50);
  });

  console.log("\n==============================================");
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("==============================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((e) => {
  console.error("FATAL TEST SUITE FAILURE:", e);
  process.exit(1);
});

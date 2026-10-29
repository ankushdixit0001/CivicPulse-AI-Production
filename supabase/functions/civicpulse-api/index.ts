import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_SERVICE_URL = (Deno.env.get("AI_SERVICE_URL") || "").replace(/\/+$/, "");
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowedDefects = new Set(["pothole", "garbage", "sewage", "streetlight", "unknown"]);
const allowedStatuses = new Set(["Pending", "Assigned", "In Progress", "Resolved"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function fail(message: string, status = 400) { return json({ message }, status); }
function normalizeIssue(row: any) {
  if (!row) return row;
  let location = row.location;
  if (typeof location === "string") {
    const match = location.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
    if (match) location = { type: "Point", coordinates: [Number(match[1]), Number(match[2])] };
  }
  return { ...row, location, _id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function currentUser(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
async function requireStaff(req: Request) {
  const user = await currentUser(req);
  if (!user) return { error: "Sign in with an authorized staff account.", status: 401 as const };
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) return { error: "Could not verify staff permissions.", status: 500 as const };
  if (!profile || !["staff", "admin"].includes(profile.role)) return { error: "Staff or admin role is required.", status: 403 as const };
  return { user, role: profile.role };
}
async function analyze(file: File, defectType: string) {
  if (!AI_SERVICE_URL) return { status: "unavailable", defect_type: defectType, confidence: 0, severity: "LOW", priority_score: 0, damage_coverage_pct: 0, metadata: { reason: "AI_SERVICE_URL is not configured" }, bounding_boxes: [] };
  try {
    const form = new FormData();
    form.append("file", file, file.name || "issue.jpg");
    form.append("defect_type", defectType);
    const headers: Record<string, string> = {};
    const aiToken = Deno.env.get("AI_SERVICE_TOKEN");
    if (aiToken) headers["x-civicpulse-ai-token"] = aiToken;
    const response = await fetch(`${AI_SERVICE_URL}/analyze`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`AI service returned ${response.status}`);
    return await response.json();
  } catch (error) {
    return { status: "unavailable", defect_type: defectType, confidence: 0, severity: "LOW", priority_score: 0, damage_coverage_pct: 0, metadata: { reason: String(error) }, bounding_boxes: [] };
  }
}
async function uploadImage(file: File, prefix: string) {
  const mime = file.type.toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Upload a JPG, PNG, or WebP image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image must be 8 MB or smaller.");
  const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = mime === "image/jpeg" && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  const isPng = mime === "image/png" && signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47;
  const isWebp = mime === "image/webp" && String.fromCharCode(...signature.slice(0, 4)) === "RIFF" && String.fromCharCode(...signature.slice(8, 12)) === "WEBP";
  if (!(isJpeg || isPng || isWebp)) throw new Error("The file contents do not match a supported image format.");
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `${prefix}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("civic-issue-images").upload(path, file, { contentType: mime, upsert: false, cacheControl: "3600" });
  if (error) throw new Error("Image upload failed: " + error.message);
  const { data } = supabase.storage.from("civic-issue-images").getPublicUrl(path);
  return { path, url: data.publicUrl };
}
async function consumeReportLimit(req: Request, userId: string | null) {
  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const identity = userId ? `user:${userId}` : `ip:${forwarded}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const key = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  const { data, error } = await supabase.rpc("consume_civic_report_limit", {
    p_bucket_key: key,
    p_limit: 5,
    p_window_seconds: 3600,
  });
  if (error) throw new Error("Could not validate report rate limit: " + error.message);
  return data === true;
}
async function listIssues(url: URL) {
  let query = supabase.from("civic_issues").select("*").order("created_at", { ascending: false }).limit(250);
  const status = url.searchParams.get("status");
  const zone = url.searchParams.get("zone");
  const priority = url.searchParams.get("priority_score");
  const defect = url.searchParams.get("defect_type");
  if (status && allowedStatuses.has(status)) query = query.eq("status", status);
  if (zone) query = query.eq("zone", zone.slice(0, 80));
  if (defect && allowedDefects.has(defect)) query = query.eq("defect_type", defect);
  if (priority !== null && Number.isFinite(Number(priority))) query = query.gte("priority_score", Math.min(100, Math.max(0, Number(priority))));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeIssue);
}
async function addEvent(issueId: string, actorId: string | null, eventType: string, oldStatus: string | null, newStatus: string | null, note: string | null, metadata: unknown = {}) {
  const { error } = await supabase.from("issue_events").insert({
    issue_id: issueId, actor_id: actorId, event_type: eventType,
    old_status: oldStatus, new_status: newStatus, note, metadata,
  });
  if (error) console.error("Could not append issue event:", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  try {
    if (path.endsWith("/health") || path.endsWith("/api/health")) return json({ status: "ok", service: "CivicPulse API", database: "supabase", ai_configured: Boolean(AI_SERVICE_URL) });

    if (req.method === "GET" && (path.endsWith("/api/ai/health") || path.endsWith("/ai/health"))) {
      if (!AI_SERVICE_URL) return json({ configured: false, available: false, model: null, reason: "AI_SERVICE_URL is not configured." });
      try {
        const headers: Record<string, string> = {};
        const aiToken = Deno.env.get("AI_SERVICE_TOKEN");
        if (aiToken) headers["x-civicpulse-ai-token"] = aiToken;
        const response = await fetch(`${AI_SERVICE_URL}/health`, { headers, signal: AbortSignal.timeout(8000) });
        if (!response.ok) return json({ configured: true, available: false, reason: `Vision service health check returned ${response.status}.` });
        const health = await response.json();
        return json({ configured: true, available: true, ...health });
      } catch (error) {
        return json({ configured: true, available: false, reason: String(error).slice(0, 180) });
      }
    }

    if (req.method === "GET" && (path.endsWith("/api/me") || path.endsWith("/me"))) {
      const user = await currentUser(req);
      if (!user) return json({ authenticated: false, user: null, role: null });
      const { data: profile, error } = await supabase.from("profiles").select("display_name,role").eq("id", user.id).maybeSingle();
      if (error) throw new Error(error.message);
      return json({ authenticated: true, user: { id: user.id, email: user.email }, role: profile?.role || "resident", display_name: profile?.display_name || "" });
    }

    if (req.method === "GET" && (path.endsWith("/tickets") || path.endsWith("/api/tickets"))) {
      return json(await listIssues(url));
    }

    if (req.method === "POST" && (path.endsWith("/tickets/report") || path.endsWith("/api/tickets/report"))) {
      const user = await currentUser(req);
      if (!(await consumeReportLimit(req, user?.id || null))) return fail("Report limit reached. Try again later (maximum 5 reports per hour per account/IP).", 429);
      const form = await req.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return fail("Issue image is required.");
      const defect = String(form.get("defect_type") || "");
      const description = String(form.get("description") || "").trim();
      const landmark = String(form.get("landmark") || "").trim();
      const lat = Number(form.get("latitude"));
      const lng = Number(form.get("longitude"));
      if (!allowedDefects.has(defect)) return fail("Choose a supported issue category.");
      if (description.length < 5 || description.length > 2000) return fail("Description must be between 5 and 2000 characters.");
      if (landmark.length > 200) return fail("Landmark must be 200 characters or fewer.");
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) return fail("Valid latitude and longitude are required.");
      const image = await uploadImage(file, "before");
      const ai = await analyze(file, defect);
      const normalizedDefect = allowedDefects.has(String(ai.defect_type || "").toLowerCase()) ? String(ai.defect_type).toLowerCase() : defect;
      const severity = ["LOW", "MEDIUM", "CRITICAL"].includes(ai.severity) ? ai.severity : "LOW";
      const { data, error } = await supabase.rpc("submit_civic_issue", {
        p_reporter_id: user?.id || null,
        p_defect_type: normalizedDefect,
        p_description: description,
        p_lat: lat,
        p_lng: lng,
        p_landmark: landmark,
        p_zone: "unassigned",
        p_priority_score: Math.round(Math.max(0, Math.min(100, Number(ai.priority_score) || 0))),
        p_severity: severity,
        p_confidence: Math.max(0, Math.min(1, Number(ai.confidence) || 0)),
        p_before_damage_pct: Math.max(0, Math.min(100, Number(ai.damage_coverage_pct) || 0)),
        p_before_image_path: image.path,
        p_ai_metadata: { ...ai, image_url: image.url },
      });
      if (error) throw new Error(error.message);
      const ticket = normalizeIssue(data.ticket);
      return json({ message: data.merged ? "Nearby report merged into the existing incident." : "Ticket created successfully.", ticket, merged: data.merged, ai_status: ai.status }, data.merged ? 200 : 201);
    }

    const issueMatch = path.match(/(?:\/api)?\/tickets\/([0-9a-f-]{36})(?:\/(status|resolve\/confirm|resolve|comments|vote|events))?$/i);
    if (issueMatch) {
      const [, issueId, action] = issueMatch;
      if (req.method === "GET" && action === "comments") {
        const { data, error } = await supabase.from("issue_comments").select("id,issue_id,author_id,body,created_at").eq("issue_id", issueId).order("created_at", { ascending: true }).limit(200);
        if (error) throw new Error(error.message);
        return json(data || []);
      }
      if (req.method === "POST" && action === "comments") {
        const user = await currentUser(req);
        if (!user) return fail("Sign in to comment on an issue.", 401);
        const body = await req.json();
        const text = String(body.body || "").trim();
        if (!text || text.length > 2000) return fail("Comment must be between 1 and 2000 characters.");
        const { data, error } = await supabase.from("issue_comments").insert({ issue_id: issueId, author_id: user.id, body: text }).select("*").single();
        if (error) throw new Error(error.message);
        await addEvent(issueId, user.id, "commented", null, null, text.slice(0, 500));
        return json(data, 201);
      }
      if (req.method === "GET" && action === "events") {
        const { data, error } = await supabase.from("issue_events").select("id,issue_id,actor_id,event_type,old_status,new_status,note,metadata,created_at").eq("issue_id", issueId).order("created_at", { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        return json(data || []);
      }
      if (req.method === "POST" && action === "vote") {
        const user = await currentUser(req);
        if (!user) return fail("Sign in to vote on an issue.", 401);
        const { data: existing, error: findError } = await supabase.from("issue_votes").select("issue_id").eq("issue_id", issueId).eq("user_id", user.id).maybeSingle();
        if (findError) throw new Error(findError.message);
        if (existing) {
          const { error } = await supabase.from("issue_votes").delete().eq("issue_id", issueId).eq("user_id", user.id);
          if (error) throw new Error(error.message);
          return json({ voted: false });
        }
        const { error } = await supabase.from("issue_votes").insert({ issue_id: issueId, user_id: user.id });
        if (error) throw new Error(error.message);
        return json({ voted: true });
      }
      if (req.method === "PATCH" && action === "status") {
        const auth = await requireStaff(req);
        if ("error" in auth) return fail(auth.error, auth.status);
        const body = await req.json();
        const nextStatus = String(body.status || "");
        if (!allowedStatuses.has(nextStatus)) return fail("Invalid ticket status.");
        if (nextStatus === "Resolved") return fail("Upload real after-repair evidence through the resolution workflow.", 400);
        const { data: previous, error: findError } = await supabase.from("civic_issues").select("status").eq("id", issueId).maybeSingle();
        if (findError) throw new Error(findError.message);
        if (!previous) return fail("Ticket not found.", 404);
        const { data, error } = await supabase.from("civic_issues").update({ status: nextStatus, assigned_to: auth.user.id }).eq("id", issueId).select("*").single();
        if (error) throw new Error(error.message);
        await addEvent(issueId, auth.user.id, nextStatus === "Assigned" ? "assigned" : "status_changed", previous.status, nextStatus, "Workflow updated by staff");
        return json(normalizeIssue(data));
      }
      if (req.method === "POST" && action === "resolve") {
        const auth = await requireStaff(req);
        if ("error" in auth) return fail(auth.error, auth.status);
        const form = await req.formData();
        const file = form.get("image");
        if (!(file instanceof File)) return fail("After-repair image is required.");
        const { data: issue, error: issueError } = await supabase.from("civic_issues").select("*").eq("id", issueId).maybeSingle();
        if (issueError) throw new Error(issueError.message);
        if (!issue) return fail("Ticket not found.", 404);
        if (!issue.before_image_path) return fail("The original report image is missing; resolution cannot be verified.", 409);
        const image = await uploadImage(file, "after");
        let verification: any = { status: "unavailable", is_resolved: false, reason: "AI_SERVICE_URL is not configured" };
        if (AI_SERVICE_URL) {
          try {
            const beforeResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/civic-issue-images/${issue.before_image_path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
            if (!beforeResponse.ok) throw new Error("Could not retrieve before image.");
            const beforeBlob = await beforeResponse.blob();
            const verifyForm = new FormData();
            verifyForm.append("before", beforeBlob, "before.jpg");
            verifyForm.append("after", file, file.name || "after.jpg");
            const aiHeaders: Record<string, string> = {};
            const aiToken = Deno.env.get("AI_SERVICE_TOKEN");
            if (aiToken) aiHeaders["x-civicpulse-ai-token"] = aiToken;
            const response = await fetch(`${AI_SERVICE_URL}/verify-resolution`, { method: "POST", headers: aiHeaders, body: verifyForm, signal: AbortSignal.timeout(45000) });
            if (!response.ok) throw new Error("AI verification service failed.");
            verification = await response.json();
          } catch (error) { verification = { status: "unavailable", is_resolved: false, reason: String(error) }; }
        }
        const update = {
          after_image_path: image.path,
          after_damage_pct: Number.isFinite(Number(verification.after_damage_pct)) ? Number(verification.after_damage_pct) : null,
          ai_metadata: { ...(issue.ai_metadata || {}), resolution_verification: verification, after_image_url: image.url },
        };
        // AI can recommend resolution, but a staff member must confirm it explicitly.
        const { data, error } = await supabase.from("civic_issues").update(update).eq("id", issueId).select("*").single();
        if (error) throw new Error(error.message);
        await addEvent(issueId, auth.user.id, "resolution_submitted", issue.status, data.status, verification.is_resolved ? "AI recommends resolution; staff confirmation is required" : "After-repair evidence submitted; verification did not pass or is unavailable", verification);
        return json({ ticket: normalizeIssue(data), verification, verified: verification.status === "success" && verification.is_resolved === true, requires_staff_confirmation: true });
      }
      if (req.method === "POST" && action === "resolve/confirm") {
        const auth = await requireStaff(req);
        if ("error" in auth) return fail(auth.error, auth.status);
        const { data: issue, error: issueError } = await supabase.from("civic_issues").select("*").eq("id", issueId).maybeSingle();
        if (issueError) throw new Error(issueError.message);
        if (!issue) return fail("Ticket not found.", 404);
        const verification = issue.ai_metadata?.resolution_verification;
        if (!issue.after_image_path || verification?.status !== "success" || verification?.is_resolved !== true || Number(verification?.confidence || 0) < 0.85) {
          return fail("AI verification has not passed the required confidence threshold. Review the evidence and keep the ticket open.", 409);
        }
        const now = new Date().toISOString();
        const { data, error } = await supabase.from("civic_issues").update({
          status: "Resolved", resolution_verified_at: now, resolved_at: now, assigned_to: auth.user.id,
        }).eq("id", issueId).select("*").single();
        if (error) throw new Error(error.message);
        await addEvent(issueId, auth.user.id, "resolved", issue.status, "Resolved", "Staff confirmed AI-assisted repair verification", { confidence: verification.confidence, resolution_score: verification.resolution_score });
        return json({ ticket: normalizeIssue(data), verified: true, staff_confirmed: true });
      }
    }

    if (req.method === "POST" && (path.endsWith("/api/chat") || path.endsWith("/chat"))) {
      const body = await req.json();
      const message = String(body.message || "").trim().slice(0, 2000);
      if (!message) return fail("Enter a message.");
      const lower = message.toLowerCase();
      let reply = "CivicPulse turns location-tagged issue photos into tickets, groups nearby reports, and tracks status changes. Open Report to submit an issue, or Command Center to view the dispatch board.";
      if (/report|photo|image|upload/.test(lower)) reply = "Open Citizen Report, upload a JPG/PNG/WebP photo (max 8 MB), search or pin the location, describe the issue, and submit. AI triage runs when the vision service is configured.";
      else if (/status|track|dispatch|assigned|resolved/.test(lower)) reply = "Every ticket has a status: Pending → Assigned → In Progress → Resolved. Staff accounts can update workflow status; resolving an issue requires an after-repair photo and successful verification.";
      else if (/vote|upvote|comment/.test(lower)) reply = "Voting and commenting require a signed-in CivicPulse account. Each account can have one vote per issue and may remove its vote.";
      else if (/ai|model|vision|priority/.test(lower)) reply = AI_SERVICE_URL ? "The vision service is configured to score images and compare before/after evidence. AI scores support triage and should be reviewed by city staff." : "The AI vision code is in the repository, but AI_SERVICE_URL is not configured yet. Reports still save to the database; image scoring will be marked unavailable until the vision service is deployed.";
      return json({ reply });
    }

    return fail("Route not found.", 404);
  } catch (error) {
    console.error("CivicPulse API error:", error);
    return fail(error instanceof Error ? error.message : "Request failed.", 500);
  }
});

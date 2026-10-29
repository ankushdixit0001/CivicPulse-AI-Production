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
    if (match) {
      location = { type: "Point", coordinates: [Number(match[1]), Number(match[2])] };
    } else if (/^(?:01|00)[0-9a-f]+$/i.test(location) && location.length >= 42) {
      // PostGIS geography is commonly returned by PostgREST as EWKB hex,
      // e.g. 0101000020E6100000 + little-endian longitude + latitude.
      try {
        const bytes = new Uint8Array(location.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(location.slice(i * 2, i * 2 + 2), 16);
        const view = new DataView(bytes.buffer);
        const littleEndian = view.getUint8(0) === 1;
        const rawType = view.getUint32(1, littleEndian);
        const baseType = rawType & 0xff;
        const hasSrid = (rawType & 0x20000000) !== 0;
        const coordinateOffset = 5 + (hasSrid ? 4 : 0);
        if (baseType === 1 && bytes.length >= coordinateOffset + 16) {
          const longitude = view.getFloat64(coordinateOffset, littleEndian);
          const latitude = view.getFloat64(coordinateOffset + 8, littleEndian);
          if (Number.isFinite(latitude) && Number.isFinite(longitude) &&
              Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
            location = { type: "Point", coordinates: [longitude, latitude] };
          }
        }
      } catch {
        // Keep unknown encodings intact; the map will safely skip invalid points.
      }
    }
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
  const unavailable = (reason: string) => ({
    status: "unavailable", provider: "none", model_source: "none", defect_type: defectType,
    confidence: 0, severity: "LOW", priority_score: 0, damage_coverage_pct: 0,
    summary: "AI defect reasoning is unavailable. The report can still be saved for manual review.",
    visible_evidence: [], recommended_action: "Municipal staff should inspect the submitted photo manually.",
    bounding_boxes: [], human_review_required: true, metadata: { reason: reason.slice(0, 160) },
  });
  if (!AI_SERVICE_URL) return unavailable("AI_SERVICE_URL is not configured.");
  const aiToken = Deno.env.get("AI_SERVICE_TOKEN") || "";
  if (!aiToken) return unavailable("AI_SERVICE_TOKEN is not configured.");
  try {
    const form = new FormData();
    form.append("file", file, file.name || "issue.jpg");
    form.append("defect_type", defectType);
    const response = await fetch(AI_SERVICE_URL + "/analyze", {
      method: "POST",
      headers: { "x-civicpulse-ai-token": aiToken },
      body: form,
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) return unavailable("Vision service returned HTTP " + response.status + ".");
    const result = await response.json();
    if (!result || !["success", "partial", "unavailable"].includes(result.status)) {
      return unavailable("Vision service returned an invalid response.");
    }
    return result;
  } catch {
    return unavailable("Vision service could not be reached.");
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
async function consumeAiAnalysisLimit(req: Request, userId: string | null) {
  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const identity = userId ? `ai:user:${userId}` : `ai:ip:${forwarded}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const key = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  const { data, error } = await supabase.rpc("consume_civic_report_limit", {
    p_bucket_key: key,
    p_limit: 20,
    p_window_seconds: 3600,
  });
  if (error) throw new Error("Could not validate AI analysis rate limit: " + error.message);
  return data === true;
}

async function listIssues(url: URL) {
  const status = url.searchParams.get("status");
  const zone = url.searchParams.get("zone");
  const priority = url.searchParams.get("priority_score");
  const defect = url.searchParams.get("defect_type");
  const rows: any[] = [];
  const pageSize = 500;
  // Page through the table so the live map is not silently capped at the first 250 tickets.
  for (let offset = 0; offset < 100000; offset += pageSize) {
    let query = supabase.from("civic_issues").select("*").order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);
    if (status && allowedStatuses.has(status)) query = query.eq("status", status);
    if (zone) query = query.eq("zone", zone.slice(0, 80));
    if (defect && allowedDefects.has(defect)) query = query.eq("defect_type", defect);
    if (priority !== null && Number.isFinite(Number(priority))) query = query.gte("priority_score", Math.min(100, Math.max(0, Number(priority))));
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map(normalizeIssue);
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
      if (!AI_SERVICE_URL) return json({
        configured: false, available: false, defect_reasoning_configured: false, defect_reasoning_available: false,
        repair_verification_configured: false, repair_verification_available: false, provider: "none",
        reason: "AI_SERVICE_URL is not configured. Reports remain available for manual review.",
      });
      const aiToken = Deno.env.get("AI_SERVICE_TOKEN") || "";
      if (!aiToken) return json({
        configured: true, available: false, defect_reasoning_configured: false, repair_verification_configured: false,
        provider: "none", reason: "AI_SERVICE_TOKEN is missing from Supabase secrets.",
      });
      try {
        const response = await fetch(`${AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) return json({ configured: true, available: false, repair_verification_available: false, provider: "none", reason: `Vision service health check returned ${response.status}.` });
        const health = await response.json();
        const analysisConfigured = health?.defect_reasoning_configured === true && health?.inference_auth_configured === true;
        const repairConfigured = health?.repair_verification_configured === true && health?.inference_auth_configured === true;
        const analysisAvailable = health?.defect_reasoning_available === true;
        const repairAvailable = health?.repair_verification_available === true;
        return json({
          ...health,
          configured: true,
          available: analysisAvailable,
          repair_verification_available: repairAvailable,
          defect_reasoning_configured: analysisConfigured,
          defect_reasoning_available: analysisAvailable,
          repair_verification_configured: repairConfigured,
          reason: !analysisAvailable
            ? (health?.readiness_message || (analysisConfigured ? "Provider is configured but no recent successful image analysis has been recorded." : "No privacy-permitted image provider is configured."))
            : undefined,
        });
      } catch {
        return json({ configured: true, available: false, repair_verification_available: false, provider: "none", reason: "Vision service health check failed." });
      }
    }

    if (req.method === "POST" && (path.endsWith("/api/ai/analyze") || path.endsWith("/ai/analyze"))) {
      const user = await currentUser(req);
      if (!(await consumeAiAnalysisLimit(req, user?.id || null))) return fail("AI analysis limit reached. Try again later (maximum 20 analyses per hour per account/IP).", 429);
      const form = await req.formData();
      const file = form.get("image");
      if (!(file instanceof File)) return fail("Choose a photo before starting AI analysis.");
      const defect = String(form.get("defect_type") || "unknown").trim().toLowerCase();
      if (!allowedDefects.has(defect)) return fail("Choose a supported issue category.");
      if (file.size < 1 || file.size > 8 * 1024 * 1024) return fail("Image must be between 1 byte and 8 MB.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase())) return fail("Upload a JPG, PNG, or WebP photo.");
      const analysis = await analyze(file, defect);
      const available = analysis.status === "success" && ["openai_vision", "gemini_vision", "openrouter_vision"].includes(analysis.model_source);
      return json({
        available,
        analysis,
        message: available ? "AI photo analysis completed. Review the estimate before submitting." :
          (analysis.metadata?.reason || analysis.reason || "AI analysis is unavailable. The report can still be submitted for manual review."),
      });
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
        try {
          const beforeResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/civic-issue-images/${issue.before_image_path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
          if (!beforeResponse.ok) throw new Error("Could not retrieve before image.");
          const beforeBlob = await beforeResponse.blob();
          if (AI_SERVICE_URL) {
            const verifyForm = new FormData();
            verifyForm.append("before", beforeBlob, "before.jpg");
            verifyForm.append("after", file, file.name || "after.jpg");
            const aiHeaders: Record<string, string> = {};
            const aiToken = Deno.env.get("AI_SERVICE_TOKEN");
            if (aiToken) aiHeaders["x-civicpulse-ai-token"] = aiToken;
            const response = await fetch(`${AI_SERVICE_URL}/verify-resolution`, { method: "POST", headers: aiHeaders, body: verifyForm, signal: AbortSignal.timeout(45000) });
            if (!response.ok) throw new Error("AI verification service failed.");
            verification = await response.json();
          } else {
            verification = {
              status: "unavailable", is_resolved: false, resolution_score: 0,
              reason: "AI_SERVICE_URL is not configured; staff must review the evidence manually.",
              human_review_required: true,
            };
          }
        } catch (error) { verification = { status: "unavailable", is_resolved: false, reason: String(error).slice(0, 200), human_review_required: true }; }
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
        if (!issue.after_image_path) return fail("Upload an after-repair photo before confirming resolution.", 409);
        const body = await req.json().catch(() => ({}));
        const aiPassed = verification?.status === "success"
          && verification?.is_resolved === true
          && Number.isFinite(Number(verification?.confidence))
          && Number(verification.confidence) >= 0.85;
        const manualOverride = body.manual_override === true;
        const reviewNote = String(body.review_note || "").trim().slice(0, 500);
        if (!aiPassed && (!manualOverride || reviewNote.length < 10)) {
          return fail("AI verification did not pass. A staff member must explicitly inspect the after photo and provide a review note to override it.", 409);
        }
        const now = new Date().toISOString();
        const { data, error } = await supabase.from("civic_issues").update({
          status: "Resolved", resolution_verified_at: now, resolved_at: now, assigned_to: auth.user.id,
        }).eq("id", issueId).select("*").single();
        if (error) throw new Error(error.message);
        const eventNote = aiPassed
          ? "Staff confirmed AI-assisted repair verification"
          : "Staff manually overrode AI verification after inspecting repair evidence";
        await addEvent(issueId, auth.user.id, "resolved", issue.status, "Resolved", eventNote, {
          ai_verified: aiPassed,
          manual_override: !aiPassed,
          review_note: reviewNote || null,
          confidence: verification?.confidence ?? null,
          resolution_score: verification?.resolution_score ?? null,
        });
        return json({ ticket: normalizeIssue(data), verified: aiPassed, staff_confirmed: true, manual_override: !aiPassed });
      }
    }

    if (req.method === "POST" && (path.endsWith("/api/chat") || path.endsWith("/chat"))) {
      const body = await req.json().catch(() => ({}));
      const message = String(body.message || "").trim().slice(0, 2000);
      if (!message) return fail("Enter a message.");
      const chatUser = await currentUser(req);
      if (!(await consumeAiAnalysisLimit(req, chatUser?.id || null))) {
        return fail("AI usage limit reached. Try again later (maximum 20 AI requests per hour per account/IP).", 429);
      }

      // Use live ticket context for both the hosted model and the no-key fallback.
      let recentIssues: any[] = [];
      try {
        const { data } = await supabase.from("civic_issues")
          .select("id,status,defect_type,severity,priority_score,created_at")
          .order("created_at", { ascending: false }).limit(30);
        recentIssues = data || [];
      } catch { /* Help responses still work if the database is temporarily unavailable. */ }

      const context = {
        total_recent_reports: recentIssues.length,
        status_counts: recentIssues.reduce((counts: Record<string, number>, issue: any) => {
          const status = String(issue.status || "Pending");
          counts[status] = (counts[status] || 0) + 1;
          return counts;
        }, {}),
        defect_counts: recentIssues.reduce((counts: Record<string, number>, issue: any) => {
          const defect = String(issue.defect_type || "unknown");
          counts[defect] = (counts[defect] || 0) + 1;
          return counts;
        }, {}),
        high_priority_recent: recentIssues.filter((issue: any) => Number(issue.priority_score) >= 75)
          .slice(0, 8).map((issue: any) => ({
            id: issue.id, status: issue.status, defect_type: issue.defect_type,
            severity: issue.severity, priority_score: issue.priority_score, created_at: issue.created_at,
          })),
      };

      // If the vision service is configured with a valid OpenAI key, use its
      // language model. Otherwise keep the help chat operational with grounded answers.
      if (AI_SERVICE_URL) {
        try {
          const chatForm = new FormData();
          chatForm.append("message", message);
          chatForm.append("context", JSON.stringify(context));
          const headers: Record<string, string> = {};
          const aiToken = Deno.env.get("AI_SERVICE_TOKEN");
          if (aiToken) headers["x-civicpulse-ai-token"] = aiToken;
          const response = await fetch(`${AI_SERVICE_URL}/chat`, {
            method: "POST", headers, body: chatForm, signal: AbortSignal.timeout(30000),
          });
          if (response.ok) {
            const aiReply = await response.json();
            if (["success", "partial"].includes(aiReply?.status) && typeof aiReply.reply === "string" && aiReply.reply.trim()) {
              return json({
                reply: aiReply.reply,
                mode: aiReply.status === "success" ? "ai" : "help",
                provider: aiReply.provider || "none",
                ai_status: aiReply.status,
                context: { recent_reports: context.total_recent_reports },
              });
            }
          }
        } catch (error) {
          console.error("AI chat provider unavailable; using civic help fallback:", String(error).slice(0, 160));
        }
      }

      const lower = message.toLowerCase();
      let reply = "I can help with CivicPulse reporting and dispatch. You can ask how to submit a photo, choose a map location, track a ticket, understand priority, or check recent report counts.";
      let mode = "help";
      if (/\b(hello|hi|hey|namaste)\b/.test(lower)) {
        reply = "Hello! I’m the CivicPulse assistant. I can guide you through reporting a civic issue, choosing its location, checking ticket status, and understanding the Command Center.";
      } else if (/\b(how many|count|total|statistics|stats|dashboard|recent reports|how much)\b/.test(lower)) {
        const counts = Object.entries(context.status_counts).map(([status, count]) => `${status}: ${count}`).join(", ") || "No status counts are available";
        const defects = Object.entries(context.defect_counts).map(([type, count]) => `${type}: ${count}`).join(", ") || "No category counts are available";
        reply = `From the latest ${context.total_recent_reports} reports I could retrieve: status breakdown — ${counts}. Issue categories — ${defects}. This is a recent sample, not necessarily the full database total. Open Command Center to inspect the report map and queue.`;
        mode = "live-data-help";
      } else if (/\b(report|submit|photo|image|gallery|upload|camera|pothole|garbage|sewage|streetlight)\b/.test(lower)) {
        reply = "To report an issue, open Citizen Report, choose Take Photo or Choose from Gallery, wait for the compressed preview, select the issue category, set the location on the map or use location search, write a clear description, and submit. AI analysis requires the vision service to be configured; if it is unavailable, the report should still be reviewed manually.";
      } else if (/\b(status|track|ticket|assigned|resolved|repair|verification|dispatch)\b/.test(lower)) {
        reply = "Tickets move through Pending → Assigned → In Progress → Resolved. Residents can check the Command Center for the current queue. Staff need to upload an after-repair photo and confirm resolution; AI recommendations do not automatically close a ticket.";
      } else if (/\b(ai|artificial intelligence|model|vision|confidence|priority|analysis)\b/.test(lower)) {
        reply = AI_SERVICE_URL
          ? "The vision service URL is configured, but model inference may still be disabled or unverified. Check the AI health status, provider keys, external-processing policy flags, and whether a recent real inference succeeded. Reports remain available for manual review."
          : "AI image analysis is offline because AI_SERVICE_URL is not configured in Supabase secrets. Deploy the FastAPI vision service, then set AI_SERVICE_URL and matching AI_SERVICE_TOKEN / VISION_API_TOKEN secrets. Reports remain available for manual review.";
      } else if (/\b(map|location|latitude|longitude|where)\b/.test(lower)) {
        reply = "On the Citizen Report page, tap the map to place a pin or use the location search. Confirm the marker is at the actual issue location before submitting; the Command Center map shows reports with valid saved coordinates.";
      }
      return json({ reply, mode, context: { recent_reports: context.total_recent_reports } });
    }

    return fail("Route not found.", 404);
  } catch (error) {
    console.error("CivicPulse API error:", error);
    return fail(error instanceof Error ? error.message : "Request failed.", 500);
  }
});

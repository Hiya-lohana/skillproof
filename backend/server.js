import express from "express";
import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import multer from "multer";
import { randomUUID } from "node:crypto";

dotenv.config();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be configured.");
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const asyncHandler = handler => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const profileFields = "id, auth_user_id, name, email, college, course, bio, visible_to_recruiters, company, designation, role, created_at, updated_at";
const toProfile = profile => ({
  _id: profile.id,
  name: profile.name,
  email: profile.email,
  college: profile.college || "",
  course: profile.course || "",
  bio: profile.bio || "",
  visibleToRecruiters: profile.visible_to_recruiters !== false,
  company: profile.company || "",
  designation: profile.designation || "",
  role: profile.role,
  createdAt: profile.created_at,
  updatedAt: profile.updated_at
});

const toItem = item => ({
  _id: item.id,
  user: item.user ? toProfile(item.user) : item.user_id,
  type: item.type,
  title: item.title,
  description: item.description,
  details: item.details,
  link: item.link,
  technologies: item.technologies || [],
  githubUrl: item.github_url || "",
  demoUrl: item.demo_url || "",
  visibleToRecruiters: item.visible_to_recruiters !== false,
  status: item.status,
  adminRemark: item.admin_remark,
  createdAt: item.created_at,
  updatedAt: item.updated_at
});

const withToken = token => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { Authorization: `Bearer ${token}` } }
});

const evidenceBucket = "project-evidence";
const allowedEvidenceTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => {
    if (!allowedEvidenceTypes.has(file.mimetype)) {
      const error = new Error("Evidence files must be JPG, PNG, WebP or PDF.");
      error.statusCode = 400;
      return callback(error);
    }
    callback(null, true);
  }
});

const projectStatus = paths => paths.length ? "evidence_submitted" : "self_declared";
const technologiesFrom = value => [...new Set(
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map(technology => technology.trim())
    .filter(Boolean)
)];
const safeHttpUrl = value => {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

const signedEvidenceFor = async item => {
  const paths = item.evidence_paths || [];
  if (!paths.length) return { ...toItem(item), evidence: [] };
  const { data, error } = await admin.storage.from(evidenceBucket)
    .createSignedUrls(paths, 60 * 60);
  if (error) throw error;
  return {
    ...toItem(item),
    evidence: paths.map((path, index) => {
      const signed = data[index];
      if (signed.error) throw signed.error;
      const filename = path.split("/").pop() || "Evidence";
      return {
        id: path,
        name: filename.replace(/^[0-9a-f-]{36}_/i, ""),
        url: signed.signedUrl
      };
    })
  };
};

const signedEvidenceList = items => Promise.all(items.map(signedEvidenceFor));

const uploadEvidenceFiles = async (files, userId, itemId) => {
  const paths = [];
  try {
    for (const file of files) {
      const filename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "evidence";
      const path = `${userId}/${itemId}/${randomUUID()}_${filename}`;
      const { error } = await admin.storage.from(evidenceBucket).upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  } catch (error) {
    if (paths.length) await admin.storage.from(evidenceBucket).remove(paths);
    throw error;
  }
};

const removeEvidenceFiles = async paths => {
  if (!paths.length) return;
  const { error } = await admin.storage.from(evidenceBucket).remove(paths);
  if (error) throw error;
};

const signIn = async (email, password) => {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { error };
  return { session: data.session, user: data.user };
};

const registerAccount = async (req, res, role) => {
  const { name, email: submittedEmail, password, college, course, company, designation } = req.body;
  const email = String(submittedEmail || "").trim().toLowerCase();
  if (!name || !email || !password || (role === "recruiter" && (!company || !designation))) {
    return res.status(400).json({
      message: role === "recruiter"
        ? "Name, company, designation, official email and password are required."
        : "Name, email and password are required."
    });
  }
  if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters." });

  const existing = unwrap(await admin.from("profiles").select("id").eq("email", email).maybeSingle());
  if (existing) return res.status(409).json({ message: "Email already registered." });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });
  if (createError) {
    if (createError.code === "email_exists" || createError.message.toLowerCase().includes("already")) {
      return res.status(409).json({ message: "Email already registered." });
    }
    throw createError;
  }

  const profileResult = await admin.from("profiles").insert({
    auth_user_id: created.user.id,
    name: name.trim(),
    email,
    college: role === "student" ? college || "" : "",
    course: role === "student" ? course || "" : "",
    company: role === "recruiter" ? company.trim() : "",
    designation: role === "recruiter" ? designation.trim() : "",
    role
  }).select("*").single();
  if (profileResult.error) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (profileResult.error.code === "23505") {
      return res.status(409).json({ message: "Email already registered." });
    }
    throw profileResult.error;
  }

  const sessionResult = await signIn(email, password);
  if (sessionResult.error || !sessionResult.session) {
    await admin.from("profiles").delete().eq("id", profileResult.data.id);
    await admin.auth.admin.deleteUser(created.user.id);
    throw sessionResult.error || new Error("Could not start the new session.");
  }
  res.status(201).json({
    token: sessionResult.session.access_token,
    user: toProfile(profileResult.data)
  });
};

const loginAccount = async (req, res, role) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const profile = unwrap(await admin.from("profiles").select("*").eq("email", email).maybeSingle());
  if (!profile) return res.status(401).json({ message: "Incorrect email or password." });
  const isLegacyAdminLogin = role === "student" && profile.role === "admin";
  if (profile.role !== role && !isLegacyAdminLogin) {
    return res.status(403).json({
      message: role === "recruiter"
        ? "This account is not registered as a recruiter. Choose Student login instead."
        : role === "admin"
          ? "This account does not have admin access."
          : "This account is registered as a recruiter. Choose Recruiter login instead."
    });
  }

  let sessionResult;
  if (profile.auth_user_id) {
    sessionResult = await signIn(email, password);
    if (sessionResult.error) return res.status(401).json({ message: "Incorrect email or password." });
  } else {
    const legacy = unwrap(await admin.from("legacy_user_credentials")
      .select("password_hash").eq("user_id", profile.id).maybeSingle());
    if (!legacy || !(await bcrypt.compare(password, legacy.password_hash))) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: profile.name }
    });
    let authUserId = created?.user?.id;
    if (createError) {
      if (createError.code !== "email_exists" && !createError.message.toLowerCase().includes("already")) {
        throw createError;
      }
      sessionResult = await signIn(email, password);
      if (sessionResult.error) return res.status(401).json({ message: "Incorrect email or password." });
      authUserId = sessionResult.user.id;
    }

    const linked = unwrap(await admin.from("profiles").update({ auth_user_id: authUserId })
      .eq("id", profile.id).is("auth_user_id", null).select("auth_user_id").maybeSingle());
    if (!linked) {
      const current = unwrap(await admin.from("profiles").select("auth_user_id").eq("id", profile.id).single());
      if (current.auth_user_id !== authUserId) throw new Error("Could not link the existing account to Supabase Auth.");
    }
    unwrap(await admin.from("legacy_user_credentials").delete().eq("user_id", profile.id).select("user_id").maybeSingle());

    if (!sessionResult) {
      sessionResult = await signIn(email, password);
      if (sessionResult.error) throw sessionResult.error;
    }
  }
  if (!sessionResult.session) throw new Error("Authentication did not return a session.");
  res.json({ token: sessionResult.session.access_token, user: toProfile(profile) });
};

const auth = asyncHandler(async (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ message: "Please log in." });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ message: "Invalid or expired token." });

  const profile = unwrap(await admin.from("profiles").select("*")
    .eq("auth_user_id", data.user.id).maybeSingle());
  if (!profile) return res.status(401).json({ message: "Account not found." });
  req.user = toProfile(profile);
  req.db = withToken(token);
  next();
});

const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: "You do not have permission." });

app.get("/api/health", (_, res) => res.json({ message: "SkillProof API is running" }));

app.post("/api/auth/register", asyncHandler((req, res) => registerAccount(req, res, "student")));
app.post("/api/auth/login", asyncHandler((req, res) => loginAccount(req, res, "student")));
app.post("/api/auth/recruiter/register", asyncHandler((req, res) => registerAccount(req, res, "recruiter")));
app.post("/api/auth/recruiter/login", asyncHandler((req, res) => loginAccount(req, res, "recruiter")));
app.post("/api/auth/admin/login", asyncHandler((req, res) => loginAccount(req, res, "admin")));

app.get("/api/me", auth, asyncHandler(async (req, res) => {
  const items = unwrap(await req.db.from("items").select("*")
    .eq("user_id", req.user._id).order("created_at", { ascending: false }));
  res.json({ user: req.user, items: await signedEvidenceList(items) });
}));

app.get("/api/admin/submissions", auth, allow("admin"), asyncHandler(async (_req, res) => {
  const items = unwrap(await admin.from("items").select("*").order("created_at", { ascending: false }));
  if (!items.length) return res.json([]);
  const profiles = unwrap(await admin.from("profiles").select(profileFields)
    .in("id", [...new Set(items.map(item => item.user_id))]));
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  const submissions = await Promise.all(items.map(async item => {
    const student = profilesById.get(item.user_id);
    if (!student) throw new Error(`Student profile not found for submission ${item.id}.`);
    return { ...await signedEvidenceFor(item), student: toProfile(student) };
  }));
  res.json(submissions);
}));

app.post("/api/admin/submissions/:id/review", auth, allow("admin"), asyncHandler(async (req, res) => {
  const { status, remark = "" } = req.body;
  if (!["verified", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Choose Verified or Rejected." });
  }
  if (typeof remark !== "string" || remark.length > 1000) {
    return res.status(400).json({ message: "Review notes must be 1,000 characters or fewer." });
  }
  const result = await admin.from("items").update({
    status,
    admin_remark: remark.trim(),
    updated_at: new Date().toISOString()
  }).eq("id", req.params.id)
    .in("status", ["pending", "evidence_submitted", "self_declared"])
    .select("*").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return res.status(409).json({ message: "This submission has already been reviewed." });

  const student = unwrap(await admin.from("profiles").select(profileFields)
    .eq("id", result.data.user_id).single());
  res.json({ ...await signedEvidenceFor(result.data), student: toProfile(student) });
}));

app.put("/api/me", auth, allow("student"), asyncHandler(async (req, res) => {
  const updates = {};
  for (const field of ["name", "college", "course", "bio", "visible_to_recruiters"]) {
    if (Object.hasOwn(req.body, field)) updates[field] = req.body[field];
  }
  if (Object.hasOwn(updates, "visible_to_recruiters")) {
    updates.visible_to_recruiters = updates.visible_to_recruiters === true || updates.visible_to_recruiters === "true";
  }
  updates.updated_at = new Date().toISOString();
  const profile = unwrap(await req.db.from("profiles").update(updates)
    .eq("id", req.user._id).select("*").single());
  res.json(toProfile(profile));
}));

const projectFieldsFrom = body => {
  const githubUrl = safeHttpUrl(body.githubUrl);
  const demoUrl = safeHttpUrl(body.demoUrl);
  if (githubUrl === null || demoUrl === null) return { error: "Repository and demo links must be valid HTTP or HTTPS URLs." };
  if (githubUrl && !["github.com", "www.github.com"].includes(new URL(githubUrl).hostname.toLowerCase())) {
    return { error: "Enter a GitHub repository URL." };
  }
  return {
    value: {
      technologies: technologiesFrom(body.technologies),
      github_url: githubUrl,
      demo_url: demoUrl,
      visible_to_recruiters: body.visibleToRecruiters !== "false" && body.visibleToRecruiters !== false
    }
  };
};

app.post("/api/items", auth, allow("student"), evidenceUpload.array("evidence", 5), asyncHandler(async (req, res) => {
  const { type, title, description, details, link } = req.body;
  const files = req.files || [];
  if (!["skill", "project", "certificate", "achievement"].includes(type) || !title?.trim()) {
    return res.status(400).json({ message: "Choose a valid category and enter a title." });
  }
  if (type !== "project" && files.length) {
    return res.status(400).json({ message: "Supporting evidence uploads are only available for projects." });
  }
  const projectFields = type === "project" ? projectFieldsFrom(req.body) : { value: {} };
  if (projectFields.error) return res.status(400).json({ message: projectFields.error });

  const item = unwrap(await req.db.from("items").insert({
    user_id: req.user._id,
    type,
    title: title.trim(),
    description: description || "",
    details: details || "",
    link: link || "",
    ...projectFields.value
  }).select("*").single());
  if (!files.length) return res.status(201).json(await signedEvidenceFor(item));

  let paths;
  try {
    paths = await uploadEvidenceFiles(files, req.user._id, item.id);
  } catch (error) {
    const cleanup = await req.db.from("items").delete().eq("id", item.id).eq("user_id", req.user._id);
    if (cleanup.error) throw cleanup.error;
    throw error;
  }
  const saved = await admin.from("items").update({
    evidence_paths: paths,
    status: projectStatus(paths),
    updated_at: new Date().toISOString()
  }).eq("id", item.id).eq("user_id", req.user._id).select("*").single();
  if (saved.error) {
    await removeEvidenceFiles(paths);
    const cleanup = await req.db.from("items").delete().eq("id", item.id).eq("user_id", req.user._id);
    if (cleanup.error) throw cleanup.error;
    throw saved.error;
  }
  res.status(201).json(await signedEvidenceFor(saved.data));
}));

app.put("/api/items/:id", auth, allow("student"), evidenceUpload.array("evidence", 5), asyncHandler(async (req, res) => {
  const existing = unwrap(await req.db.from("items").select("*")
    .eq("id", req.params.id).eq("user_id", req.user._id).eq("type", "project").maybeSingle());
  if (!existing) return res.status(404).json({ message: "Project not found." });

  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ message: "Enter a project title." });
  const projectFields = projectFieldsFrom(req.body);
  if (projectFields.error) return res.status(400).json({ message: projectFields.error });
  let removePaths;
  try {
    removePaths = JSON.parse(req.body.removeEvidence || "[]");
  } catch {
    return res.status(400).json({ message: "Invalid evidence selection." });
  }
  if (!Array.isArray(removePaths) || removePaths.some(path => !existing.evidence_paths.includes(path))) {
    return res.status(400).json({ message: "Invalid evidence selection." });
  }

  const uploadedPaths = await uploadEvidenceFiles(req.files || [], req.user._id, existing.id);
  const evidencePaths = existing.evidence_paths.filter(path => !removePaths.includes(path)).concat(uploadedPaths);
  const result = await admin.from("items").update({
    title: title.trim(),
    description: req.body.description || "",
    technologies: projectFields.value.technologies,
    github_url: projectFields.value.github_url,
    demo_url: projectFields.value.demo_url,
    visible_to_recruiters: projectFields.value.visible_to_recruiters,
    evidence_paths: evidencePaths,
    status: projectStatus(evidencePaths),
    updated_at: new Date().toISOString()
  }).eq("id", existing.id).eq("user_id", req.user._id).select("*").single();
  if (result.error) {
    await removeEvidenceFiles(uploadedPaths);
    throw result.error;
  }
  await removeEvidenceFiles(removePaths);
  res.json(await signedEvidenceFor(result.data));
}));

app.delete("/api/items/:id", auth, allow("student"), asyncHandler(async (req, res) => {
  const existing = unwrap(await req.db.from("items").select("id, type, status, evidence_paths")
    .eq("id", req.params.id).eq("user_id", req.user._id).maybeSingle());
  if (!existing || (existing.type !== "project" && existing.status === "verified")) {
    return res.status(404).json({ message: "Item not found or cannot be deleted." });
  }
  const item = unwrap(await req.db.from("items").delete()
    .eq("id", req.params.id)
    .eq("user_id", req.user._id)
    .select("id")
    .maybeSingle());
  if (!item) return res.status(404).json({ message: "Item not found." });
  await removeEvidenceFiles(existing.evidence_paths || []);
  res.json({ message: "Item deleted." });
}));

app.get("/api/recruiter/students", auth, allow("recruiter", "admin"), asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const skills = String(req.query.skills || "").split(",").map(skill => skill.trim().toLowerCase()).filter(Boolean);
  let students;
  if (q) {
    const pattern = `%${q}%`;
    const results = await Promise.all(["name", "college", "course"].map(field =>
      req.db.from("profiles").select(profileFields).eq("role", "student")
        .eq("visible_to_recruiters", true).ilike(field, pattern).limit(50)
    ));
    students = [...new Map(results.flatMap(result => unwrap(result)).map(profile => [profile.id, profile])).values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50);
  } else {
    students = unwrap(await req.db.from("profiles").select(profileFields)
      .eq("role", "student").eq("visible_to_recruiters", true).order("name").limit(50));
  }

  const items = students.length
    ? unwrap(await req.db.from("items").select("*")
      .in("user_id", students.map(student => student.id)))
    : [];
  const itemsByUser = new Map();
  for (const item of items) {
    const userItems = itemsByUser.get(item.user_id) || [];
    userItems.push(item);
    itemsByUser.set(item.user_id, userItems);
  }
  const projectStatusFilter = String(req.query.projectStatus || "");
  if (projectStatusFilter && !["verified", "evidence_submitted", "self_declared"].includes(projectStatusFilter)) {
    return res.status(400).json({ message: "Invalid project status filter." });
  }
  const results = await Promise.all(students.map(async student => ({
    user: toProfile(student),
    items: await signedEvidenceList(itemsByUser.get(student.id) || [])
  })));
  const filtered = results.filter(({ items: studentItems }) => {
    const projects = studentItems.filter(item => item.type === "project");
    const matchesStatus = !projectStatusFilter || projects.some(item => item.status === projectStatusFilter);
    const matchesSkills = !skills.length || skills.every(skill =>
      studentItems.some(item =>
        `${item.type} ${item.title} ${(item.technologies || []).join(" ")} ${item.details} ${item.description}`
          .toLowerCase().includes(skill)
      )
    );
    return matchesStatus && matchesSkills;
  });
  res.json(filtered);
}));

app.get("/api/recruiter/shortlists", auth, allow("recruiter"), asyncHandler(async (req, res) => {
  const shortlist = unwrap(await req.db.from("shortlists").select("student_id")
    .eq("recruiter_id", req.user._id).order("created_at", { ascending: false }));
  if (!shortlist.length) return res.json([]);
  const ids = shortlist.map(row => row.student_id);
  const profiles = unwrap(await req.db.from("profiles").select(profileFields)
    .in("id", ids).eq("role", "student").eq("visible_to_recruiters", true));
  const items = unwrap(await req.db.from("items").select("*")
    .in("user_id", ids));
  const itemsByUser = new Map();
  for (const item of items) {
    const userItems = itemsByUser.get(item.user_id) || [];
    userItems.push(item);
    itemsByUser.set(item.user_id, userItems);
  }
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  res.json(await Promise.all(ids.flatMap(id => {
    const profile = profilesById.get(id);
    return profile ? [signedEvidenceList(itemsByUser.get(id) || []).then(items => ({ user: toProfile(profile), items }))] : [];
  })));
}));

app.post("/api/recruiter/shortlists", auth, allow("recruiter"), asyncHandler(async (req, res) => {
  const studentId = req.body.studentId;
  if (!studentId) return res.status(400).json({ message: "A student profile is required." });
  const { error } = await req.db.from("shortlists").insert({
    recruiter_id: req.user._id,
    student_id: studentId
  });
  if (error?.code === "23505") return res.json({ message: "Student is already shortlisted." });
  if (error) throw error;
  res.status(201).json({ message: "Student shortlisted." });
}));

app.delete("/api/recruiter/shortlists/:studentId", auth, allow("recruiter"), asyncHandler(async (req, res) => {
  unwrap(await req.db.from("shortlists").delete()
    .eq("recruiter_id", req.user._id)
    .eq("student_id", req.params.studentId));
  res.json({ message: "Student removed from shortlist." });
}));

app.get("/api/public/:id", auth, allow("recruiter", "admin"), asyncHandler(async (req, res) => {
  const user = unwrap(await req.db.from("profiles").select(profileFields)
    .eq("id", req.params.id).eq("role", "student").eq("visible_to_recruiters", true).maybeSingle());
  if (!user) return res.status(404).json({ message: "Student profile not found." });
  const items = unwrap(await req.db.from("items").select("*")
    .eq("user_id", user.id));
  res.json({ user: toProfile(user), items: await signedEvidenceList(items) });
}));

app.use((err, _req, res, _next) => {
  console.error("API request failed:", err.message);
  if (err instanceof multer.MulterError || err.statusCode === 400) {
    return res.status(400).json({ message: err.message });
  }
  res.status(500).json({ message: "An unexpected server error occurred." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`SkillProof API running on ${PORT}`));

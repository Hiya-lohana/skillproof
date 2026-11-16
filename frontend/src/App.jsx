import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Award, BookOpen, BriefcaseBusiness, CheckCircle2, ChevronRight, ExternalLink, FileText, LayoutDashboard, LogOut, Pencil, Plus, Search, ShieldCheck, Sparkles, Trash2, UserRound, X } from "lucide-react";

const API = "/api";
const api = axios.create({ baseURL: API });
api.interceptors.request.use(config => {
  const token = localStorage.getItem("skillproof_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
const categories = ["skill", "project", "certificate", "achievement"];
const pretty = s => s.charAt(0).toUpperCase() + s.slice(1);
const emptyItemForm = () => ({
  type:"project", title:"", description:"", details:"", link:"",
  technologies:"", githubUrl:"", demoUrl:"", visibleToRecruiters:true, evidence:[]
});

function Auth({ onAuth }) {
  const [role, setRole] = useState("student");
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name:"", email:"", password:"", college:"", course:"", company:"", designation:"" });
  const [error, setError] = useState("");
  const change = e => setForm({ ...form, [e.target.name]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setError("");
    try {
      const path = role === "admin"
        ? "/auth/admin/login"
        : role === "recruiter" ? `/auth/recruiter/${mode}` : `/auth/${mode}`;
      const { data } = await api.post(path, form);
      localStorage.setItem("skillproof_token", data.token); onAuth(data.user);
    } catch (e) { setError(e.response?.data?.message || "Something went wrong. Is the backend running?"); }
  }
  return <div className="auth-wrap"><div className="auth-card">
    <div className="brand"><span className="brand-icon"><ShieldCheck/></span><span>skillproof<span className="dot">.</span></span></div>
    <div className="eyebrow">YOUR WORK. YOUR PROOF.</div><h1>{mode === "login" ? "Welcome back" : role === "recruiter" ? "Create recruiter account" : "Create your passport"}</h1>
    <p className="muted">{role === "recruiter" ? "Discover verified student talent." : "A trusted space to showcase what you can do."}</p>
    <div className={`role-selector ${mode === "login" ? "three-roles" : ""}`} aria-label="Choose account type">
      <button type="button" className={role === "student" ? "selected" : ""} onClick={() => { setRole("student"); setError(""); }}>Continue as Student</button>
      <button type="button" className={role === "recruiter" ? "selected" : ""} onClick={() => { setRole("recruiter"); setError(""); }}>Continue as Recruiter</button>
      {mode === "login" && <button type="button" className={role === "admin" ? "selected" : ""} onClick={() => { setRole("admin"); setError(""); }}>Admin login</button>}
    </div>
    <form onSubmit={submit}>
      {mode === "register" && <>
        <label>Full name</label><input name="name" placeholder="Your name" value={form.name} onChange={change} required/>
        {role === "recruiter"
          ? <><label>Company name</label><input name="company" placeholder="Company / organization" value={form.company} onChange={change} required/><label>Designation</label><input name="designation" placeholder="e.g. Talent Acquisition Lead" value={form.designation} onChange={change} required/></>
          : <><label>College</label><input name="college" placeholder="College / University" value={form.college} onChange={change}/><label>Course</label><input name="course" placeholder="e.g. B.Tech AI & Data Science" value={form.course} onChange={change}/></>}
      </>}
      <label>{role === "recruiter" ? "Official email" : "Email address"}</label><input name="email" type="email" autoComplete="email" placeholder={role === "recruiter" ? "you@company.com" : "you@example.com"} value={form.email} onChange={change} required/>
      <label>Password</label><input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="At least 6 characters" value={form.password} onChange={change} required minLength="6"/>
      {error && <div className="error">{error}</div>}<button className="primary full">{mode === "login" ? `Sign in as ${role}` : "Create account"} <ChevronRight size={17}/></button>
    </form>
    <p className="switch">{mode === "login" ? "New to SkillProof?" : "Already have an account?"} <button onClick={() => {setMode(mode === "login" ? "register" : "login");if(mode === "login"&&role==="admin")setRole("student");setError("");}}>{mode === "login" ? "Create account" : "Sign in"}</button></p>
  </div><div className="auth-side"><div className="orb orb1"/><div className="orb orb2"/><div className="side-content"><div className="side-pill"><Sparkles size={15}/> YOUR SKILL PASSPORT</div><h2>Let your work<br/>speak for you.</h2><p>Bring your skills, projects and achievements together in one student profile.</p><div className="floating-card"><div className="verified"><CheckCircle2 size={18}/> PROJECT EVIDENCE</div><strong>Project completed</strong><span>Supporting evidence attached to a student project</span></div></div></div></div>;
}

function App() {
  const [user, setUser] = useState(null), [items, setItems] = useState([]), [page, setPage] = useState("overview");
  const [loading, setLoading] = useState(true), [modal, setModal] = useState(false), [toast, setToast] = useState("");
  const [form, setForm] = useState(emptyItemForm), [editingItem, setEditingItem] = useState(null);
  const [removeEvidencePaths, setRemoveEvidencePaths] = useState([]);
  const [students, setStudents] = useState([]), [query, setQuery] = useState("");
  const [adminSubmissions, setAdminSubmissions] = useState([]), [adminLoading, setAdminLoading] = useState(false);
  const [skillFilter, setSkillFilter] = useState(""), [projectStatusFilter, setProjectStatusFilter] = useState("");
  const [shortlisted, setShortlisted] = useState([]);
  const [profile, setProfile] = useState({ name:"", college:"", course:"", bio:"", visibleToRecruiters:true });
  const [publicId, setPublicId] = useState("");
  const [publicData, setPublicData] = useState(null);

  async function load() {
    try {
      const { data } = await api.get("/me");
      setUser(data.user);
      setPage(data.user.role === "recruiter" ? "discover" : "overview");
      setItems(data.items);
      setProfile({
        name:data.user.name,
        college:data.user.college || "",
        course:data.user.course || "",
        bio:data.user.bio || "",
        visibleToRecruiters:data.user.visibleToRecruiters !== false
      });
    } catch { localStorage.removeItem("skillproof_token"); setUser(null); }
    setLoading(false);
  }
  useEffect(() => { if (localStorage.getItem("skillproof_token")) load(); else setLoading(false); }, []);
  useEffect(() => {
    if (user?.role === "recruiter") {
      loadShortlist();
      if (page === "discover") searchStudents();
    }
    if (user?.role === "admin" && page === "overview") loadAdminSubmissions();
  }, [user,page]);
  const counts = useMemo(() => ({ skill:items.filter(i=>i.type==="skill").length, project:items.filter(i=>i.type==="project").length, certificate:items.filter(i=>i.type==="certificate").length, verified:items.filter(i=>i.status==="verified").length, pending:items.filter(i=>i.status==="pending").length }), [items]);
  function showError(e) { setToast(e.response?.data?.message || "Request failed"); setTimeout(()=>setToast(""),3000); }
  function logout() { localStorage.removeItem("skillproof_token");setUser(null);setItems([]);setShortlisted([]); }
  function startAddItem() {
    setEditingItem(null);
    setRemoveEvidencePaths([]);
    setForm(emptyItemForm());
    setModal(true);
  }
  function startEditItem(item) {
    setEditingItem(item);
    setRemoveEvidencePaths([]);
    setForm({
      ...emptyItemForm(),
      type:item.type,
      title:item.title,
      description:item.description || "",
      details:item.details || "",
      link:item.link || "",
      technologies:(item.technologies || []).join(", "),
      githubUrl:item.githubUrl || "",
      demoUrl:item.demoUrl || "",
      visibleToRecruiters:item.visibleToRecruiters !== false
    });
    setModal(true);
  }
  async function saveItem(e) {
    e.preventDefault();
    const payload = new FormData();
    for (const field of ["type", "title", "description", "details", "link", "technologies", "githubUrl", "demoUrl"]) {
      payload.append(field, form[field] || "");
    }
    payload.append("visibleToRecruiters", String(form.visibleToRecruiters));
    for (const file of form.evidence) payload.append("evidence", file);
    if (editingItem) payload.append("removeEvidence", JSON.stringify(removeEvidencePaths));
    try {
      const { data } = editingItem
        ? await api.put(`/items/${editingItem._id}`, payload)
        : await api.post("/items", payload);
      setItems(current => editingItem
        ? current.map(item => item._id === data._id ? data : item)
        : [data, ...current]);
      setModal(false);
      setEditingItem(null);
      setRemoveEvidencePaths([]);
      setForm(emptyItemForm());
      setToast(data.type === "project"
        ? data.status === "evidence_submitted" ? "Project and evidence saved." : "Project saved as Self-Declared."
        : "Item submitted.");
      setTimeout(()=>setToast(""),2500);
    } catch(e) { showError(e); }
  }
  async function removeItem(id) { try { await api.delete(`/items/${id}`);setItems(items.filter(i=>i._id!==id)); } catch(e){showError(e);} }
  async function updateProfile(e) { e.preventDefault();try{const {data}=await api.put("/me",{...profile,visible_to_recruiters:profile.visibleToRecruiters});setUser({...user,...data});setToast("Profile saved!");setTimeout(()=>setToast(""),2000);}catch(e){showError(e);} }
  async function searchStudents() {
    try {
      const params = new URLSearchParams({ q: query, skills: skillFilter, projectStatus: projectStatusFilter });
      const { data } = await api.get(`/recruiter/students?${params}`);
      setStudents(data);
    } catch (e) { showError(e); }
  }
  async function loadShortlist() {
    try { const { data } = await api.get("/recruiter/shortlists"); setShortlisted(data); }
    catch (e) { showError(e); }
  }
  async function loadAdminSubmissions() {
    setAdminLoading(true);
    try { const { data } = await api.get("/admin/submissions"); setAdminSubmissions(data); }
    catch (e) { showError(e); }
    finally { setAdminLoading(false); }
  }
  async function reviewSubmission(item, status, remark) {
    try {
      const { data } = await api.post(`/admin/submissions/${item._id}/review`, { status, remark });
      setAdminSubmissions(current => current.map(submission => submission._id === data._id ? data : submission));
      setToast(`Submission ${status}.`);
      setTimeout(()=>setToast(""),2500);
      return true;
    } catch (e) { showError(e); return false; }
  }
  async function toggleShortlist(candidate) {
    const id = candidate.user._id;
    const isSaved = shortlisted.some(entry => entry.user._id === id);
    try {
      if (isSaved) {
        await api.delete(`/recruiter/shortlists/${id}`);
        setShortlisted(current => current.filter(entry => entry.user._id !== id));
      } else {
        await api.post("/recruiter/shortlists", { studentId: id });
        setShortlisted(current => [candidate, ...current]);
      }
    } catch (e) { showError(e); }
  }
  async function openPublic(id) { try { const {data}=await api.get(`/public/${id}`);setPublicData(data);setPublicId(id);setPage("public"); }catch(e){showError(e);} }
  if (loading) return <div className="loading">Loading SkillProof...</div>;
  if (!user) return <Auth onAuth={u=>{setUser(u);load();}}/>;
  const nav = user.role === "student" ? [{id:"overview",label:"Overview",icon:LayoutDashboard},{id:"profile",label:"My profile",icon:UserRound},{id:"portfolio",label:"My portfolio",icon:BookOpen}] : user.role === "admin" ? [{id:"overview",label:"Review submissions",icon:ShieldCheck}] : [{id:"discover",label:"Discover students",icon:Search},{id:"shortlisted",label:"Shortlisted",icon:CheckCircle2}];
  const visibleItems = page==="portfolio" ? items : items.slice(0,4);
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-icon"><ShieldCheck/></span><span>skillproof<span className="dot">.</span></span></div><div className="workspace-label">WORKSPACE</div><nav>{nav.map(n=><button key={n.id} className={page===n.id?"nav active":"nav"} onClick={()=>setPage(n.id)}><n.icon size={18}/>{n.label}</button>)}</nav><div className="sidebar-bottom"><div className="mini-user"><div className="avatar">{user.name?.[0]?.toUpperCase()}</div><div><strong>{user.name}</strong><small>{pretty(user.role)}</small></div></div><button className="logout" onClick={logout}><LogOut size={17}/> Sign out</button></div></aside>
    <main className="main"><header className="topbar"><div><span className="breadcrumb">Workspace</span><ChevronRight size={14}/><strong>{nav.find(n=>n.id===page)?.label || pretty(page)}</strong></div><div className="top-right"><span className="role-tag">{pretty(user.role)} account</span><div className="avatar small">{user.name?.[0]?.toUpperCase()}</div></div></header>
      <div className="content">
        {page==="overview" && user.role==="student" && <>
          <div className="welcome-row"><div><div className="eyebrow">STUDENT DASHBOARD</div><h1>Hey, {user.name.split(" ")[0]} <span className="wave">✦</span></h1><p className="muted">Your skills and achievements, all in one place.</p></div><button className="primary" onClick={startAddItem}><Plus size={18}/> Add to passport</button></div>
          <div className="hero-banner"><div><div className="banner-tag"><Sparkles size={14}/> YOUR DIGITAL SKILL PASSPORT</div><h2>Make your potential<br/>impossible to overlook.</h2><p>Build your profile. Add evidence. Share work you're proud of.</p></div><div className="banner-art"><ShieldCheck size={90}/><span>SKILL<br/>PROOF</span></div></div>
          <div className="stats-grid">{[[Award,"Skills",counts.skill,"purple"],[BriefcaseBusiness,"Projects",counts.project,"blue"],[BookOpen,"Certificates",counts.certificate,"orange"],[CheckCircle2,"Verified",counts.verified,"green"]].map(([Icon,label,num,color])=><div className="stat-card" key={label}><div className={`stat-icon ${color}`}><Icon size={19}/></div><div><strong>{num}</strong><span>{label}</span></div></div>)}</div>
          <div className="section-heading"><div><h2>Recent submissions</h2><p className="muted">Track the status of your achievements.</p></div><button className="text-btn" onClick={()=>setPage("portfolio")}>View all <ChevronRight size={16}/></button></div>
          <ItemList items={visibleItems} onDelete={removeItem}/>
        </>}
        {page==="portfolio" && <><div className="page-heading"><div><div className="eyebrow">YOUR WORK</div><h1>My portfolio</h1><p className="muted">Everything you've added to your skill passport.</p></div><button className="primary" onClick={startAddItem}><Plus size={18}/> Add item</button></div><div className="filter-row">{categories.map(c=><span className="filter-chip" key={c}>{pretty(c)} · {items.filter(i=>i.type===c).length}</span>)}</div><div className="status-explainer"><strong>Project status guide</strong><span><Status status="self_declared"/> Added without supporting evidence.</span><span><Status status="evidence_submitted"/> Supporting files are attached; this is not independent verification.</span><span><Status status="verified"/> Independently verified only.</span></div><ItemList items={items} onDelete={removeItem} onEdit={startEditItem}/></>}
        {page==="profile" && <><div className="page-heading"><div><div className="eyebrow">PERSONAL DETAILS</div><h1>My profile</h1><p className="muted">Help recruiters understand your background.</p></div></div><form className="panel profile-form" onSubmit={updateProfile}><label>Full name</label><input value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/><label>College / University</label><input value={profile.college} onChange={e=>setProfile({...profile,college:e.target.value})}/><label>Course</label><input value={profile.course} onChange={e=>setProfile({...profile,course:e.target.value})}/><label>About me</label><textarea rows="4" value={profile.bio} onChange={e=>setProfile({...profile,bio:e.target.value})} placeholder="Write a short introduction..."/><label className="visibility-control"><input type="checkbox" checked={profile.visibleToRecruiters} onChange={e=>setProfile({...profile,visibleToRecruiters:e.target.checked})}/> Make my profile visible to recruiters</label><button className="primary">Save profile</button><p className="hint">Your public profile ID: {user._id}</p></form></>}
        {page==="overview" && user.role==="admin" && <AdminDashboard submissions={adminSubmissions} loading={adminLoading} onReview={reviewSubmission}/>}
        {page==="discover" && <>
          <div className="page-heading"><div><div className="eyebrow">TALENT DIRECTORY</div><h1>Discover students</h1><p className="muted">Explore verified skill passports and shortlist promising candidates.</p></div></div>
          <div className="searchbar"><Search/><input aria-label="Search students" placeholder="Search by student, college or course..." value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchStudents()}/><button className="primary" onClick={searchStudents}>Search</button></div>
          <div className="technology-filter"><label htmlFor="skill-filter">Filter by skills and technologies</label><div><input id="skill-filter" placeholder="e.g. React, Python, SQL" value={skillFilter} onChange={e=>setSkillFilter(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchStudents()}/><select aria-label="Filter by project status" value={projectStatusFilter} onChange={e=>setProjectStatusFilter(e.target.value)}><option value="">All project statuses</option><option value="verified">Verified</option><option value="evidence_submitted">Evidence Submitted</option><option value="self_declared">Self-Declared</option></select><button className="outline" onClick={searchStudents}>Apply filters</button></div><small>Separate multiple skills with commas. Status and skill filters apply to visible projects.</small></div>
          <CandidateGrid candidates={students} shortlisted={shortlisted} onShortlist={toggleShortlist} onOpen={openPublic} emptyText="No matching students found. Try changing your search or filters."/>
        </>}
        {page==="shortlisted" && <>
          <div className="page-heading"><div><div className="eyebrow">YOUR CANDIDATES</div><h1>Shortlisted students</h1><p className="muted">Profiles you saved for follow-up.</p></div></div>
          <CandidateGrid candidates={shortlisted} shortlisted={shortlisted} onShortlist={toggleShortlist} onOpen={openPublic} emptyText="You haven't shortlisted any students yet."/>
        </>}
        {page==="public" && publicData && <><button className="text-btn back" onClick={()=>setPage("discover")}>← Back to students</button><div className="public-hero"><div className="avatar large">{publicData.user.name[0]}</div><div><div className="eyebrow">STUDENT SKILL PASSPORT</div><h1>{publicData.user.name}</h1><p>{publicData.user.course} · {publicData.user.college}</p><p>{publicData.user.bio}</p></div></div><h2 className="subheading">Projects and achievements</h2><ItemList items={publicData.items} publicView/></>}
      </div>
    </main>
    {modal&&<div className="modal-backdrop" onClick={()=>setModal(false)}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="modal-title"><div><div className="eyebrow">GROW YOUR PASSPORT</div><h2>{editingItem ? "Edit project" : "Add to passport"}</h2></div><button className="icon-btn" onClick={()=>setModal(false)}><X/></button></div>
      <form onSubmit={saveItem}>
        {!editingItem && <><label>Category</label><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{categories.map(c=><option value={c} key={c}>{pretty(c)}</option>)}</select></>}
        <label>{form.type === "project" ? "Project title" : "Title"}</label><input required placeholder="e.g. Food Delivery App" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
        <label>Description</label><textarea rows="3" placeholder="Briefly describe this work..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/>
        {form.type === "project" ? <>
          <label>Technologies used</label><input placeholder="React, Node.js, PostgreSQL" value={form.technologies} onChange={e=>setForm({...form,technologies:e.target.value})}/>
          <label>GitHub repository link</label><input type="url" placeholder="https://github.com/you/project" value={form.githubUrl} onChange={e=>setForm({...form,githubUrl:e.target.value})}/>
          <label>Live demo link</label><input type="url" placeholder="https://your-project.example" value={form.demoUrl} onChange={e=>setForm({...form,demoUrl:e.target.value})}/>
          {editingItem?.evidence?.length > 0 && <div className="existing-evidence"><label>Current evidence</label>{editingItem.evidence.map(file=><label className="evidence-remove" key={file.id}><input type="checkbox" checked={removeEvidencePaths.includes(file.id)} onChange={e=>setRemoveEvidencePaths(e.target.checked ? [...removeEvidencePaths,file.id] : removeEvidencePaths.filter(path=>path!==file.id))}/>{file.name}</label>)}</div>}
          <label htmlFor="evidence-upload">Supporting evidence (screenshots or PDF, up to 5 files)</label><input id="evidence-upload" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" multiple onChange={e=>setForm({...form,evidence:Array.from(e.target.files || [])})}/>
          {!!form.evidence.length && <small className="selected-files">{form.evidence.map(file=>file.name).join(", ")}</small>}
          <label className="visibility-control"><input type="checkbox" checked={form.visibleToRecruiters} onChange={e=>setForm({...form,visibleToRecruiters:e.target.checked})}/> Make this project visible to recruiters</label>
          <div className="modal-note"><ShieldCheck size={16}/><span>Without evidence the project is Self-Declared. Attached files change it to Evidence Submitted. Neither status means independently Verified.</span></div>
        </> : <>
          <label>Organization / Technologies</label><input placeholder="e.g. Deloitte / React, Node.js" value={form.details} onChange={e=>setForm({...form,details:e.target.value})}/>
          <label>Link (optional)</label><input type="url" placeholder="Certificate or project URL" value={form.link} onChange={e=>setForm({...form,link:e.target.value})}/>
        </>}
        <button className="primary full">{editingItem ? "Save project" : form.type === "project" ? "Save project" : "Submit item"}</button>
      </form>
    </div></div>}
    {toast&&<div className="toast">{toast}</div>}
  </div>;
}

function CandidateGrid({ candidates, shortlisted, onShortlist, onOpen, emptyText }) {
  const shortlistIds = new Set(shortlisted.map(candidate => candidate.user._id));
  if (!candidates.length) return <Empty text={emptyText}/>;
  return <div className="student-grid">{candidates.map(candidate => {
    const { user, items } = candidate;
    const saved = shortlistIds.has(user._id);
    const counts = ["skill", "project", "certificate"].map(type => [
      type,
      items.filter(item => item.type === type).length
    ]);
    return <article className="student-card" key={user._id}>
      <div className="student-top"><div className="avatar large">{user.name[0]}</div><span className="verified-mini">{items.length} visible items</span></div>
      <h3>{user.name}</h3>
      <p>{user.course || "Student"} · {user.college || "College not added"}</p>
      <p className="bio">{user.bio || "Building skills and creating projects."}</p>
      <div className="candidate-counts">{counts.map(([type, count]) => <span key={type}>{count} {pretty(type)}{count === 1 ? "" : "s"}</span>)}</div>
      <div className="skill-pills">{items.slice(0, 5).map(item => <span key={item._id}>{item.title}{item.technologies?.length ? ` · ${item.technologies.join(", ")}` : item.details ? ` · ${item.details}` : ""}</span>)}</div>
      <div className="project-status-list">{items.filter(item => item.type === "project").slice(0, 3).map(item => <div key={item._id}><strong>{item.title}</strong><Status status={item.status}/></div>)}</div>
      <div className="candidate-actions"><button className="outline" onClick={() => onOpen(user._id)}>View skill passport <ChevronRight size={16}/></button><button className={saved ? "shortlist-btn saved" : "shortlist-btn"} onClick={() => onShortlist(candidate)}>{saved ? "Shortlisted" : "Shortlist"}</button></div>
    </article>;
  })}</div>;
}

function AdminDashboard({ submissions, loading, onReview }) {
  const [filter, setFilter] = useState("review");
  const [remarks, setRemarks] = useState({});
  const [busyId, setBusyId] = useState("");
  const reviewable = item => ["pending", "evidence_submitted", "self_declared"].includes(item.status);
  const counts = {
    review: submissions.filter(reviewable).length,
    verified: submissions.filter(item => item.status === "verified").length,
    rejected: submissions.filter(item => item.status === "rejected").length
  };
  const filtered = submissions.filter(item => filter === "all"
    ? true
    : filter === "review" ? reviewable(item) : item.status === filter);

  async function submitReview(item, status) {
    setBusyId(item._id);
    if (await onReview(item, status, remarks[item._id] || "")) {
      setRemarks(current => ({ ...current, [item._id]: "" }));
    }
    setBusyId("");
  }

  return <>
    <div className="page-heading"><div><div className="eyebrow">ADMIN DASHBOARD</div><h1>Review submissions</h1><p className="muted">Verify student claims before approved items are shared with recruiters.</p></div></div>
    <div className="stats-grid admin-stats">{[[FileText,"Awaiting review",counts.review,"orange"],[CheckCircle2,"Verified",counts.verified,"green"],[X,"Rejected",counts.rejected,"purple"]].map(([Icon,label,count,color])=><div className="stat-card" key={label}><div className={`stat-icon ${color}`}><Icon size={19}/></div><div><strong>{count}</strong><span>{label}</span></div></div>)}</div>
    <div className="filter-row">
      {[["review","Awaiting review"],["verified","Verified"],["rejected","Rejected"],["all","All submissions"]].map(([value,label])=><button key={value} className={`filter-chip ${filter===value?"selected":""}`} onClick={()=>setFilter(value)}>{label}</button>)}
    </div>
    {loading ? <div className="panel empty">Loading submissions...</div> : !filtered.length ? <Empty text={filter === "review" ? "All caught up. There are no submissions awaiting review." : "No submissions in this view."}/> :
      <div className="panel admin-submissions">{filtered.map(item => <article className="admin-submission" key={item._id}>
        <div className={`item-symbol ${item.type}`}><Award size={19}/></div>
        <div className="admin-submission-content">
          <div className="admin-submission-heading"><div><strong>{item.title}</strong><p>{pretty(item.type)} · Submitted by {item.student.name} · {item.student.college || "College not provided"}</p></div><Status status={item.status}/></div>
          {item.description && <p className="submission-description">{item.description}</p>}
          {item.details && <p className="submission-detail">{item.details}</p>}
          <div className="evidence-links">
            {item.link && <a href={item.link} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Open submission link</a>}
            {item.githubUrl && <a href={item.githubUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/> GitHub repository</a>}
            {item.demoUrl && <a href={item.demoUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Live demo</a>}
            {(item.evidence || []).map(file=><a key={file.id} href={file.url} target="_blank" rel="noreferrer"><FileText size={13}/> {file.name}</a>)}
          </div>
          {item.adminRemark && <p className="admin-remark">Previous review: {item.adminRemark}</p>}
          {reviewable(item) && <div className="admin-review-controls">
            <textarea aria-label={`Review note for ${item.title}`} rows="2" maxLength="1000" placeholder="Optional note for the student" value={remarks[item._id] || ""} onChange={event=>setRemarks(current=>({...current,[item._id]:event.target.value}))}/>
            <div className="review-actions"><button className="approve" disabled={busyId===item._id} onClick={()=>submitReview(item,"verified")}>Approve</button><button className="reject" disabled={busyId===item._id} onClick={()=>submitReview(item,"rejected")}>Reject</button></div>
          </div>}
        </div>
      </article>)}</div>}
  </>;
}

const statusNames = {
  self_declared:"Self-Declared",
  evidence_submitted:"Evidence Submitted",
  verified:"Verified",
  pending:"Pending",
  rejected:"Rejected"
};
function Status({status}) { return <span className={`status ${status}`}>{status==="verified"&&<CheckCircle2 size={13}/>} {statusNames[status] || pretty(status)}</span>; }
function ItemList({items,onDelete,onEdit,publicView=false}) {
  if (!items.length) return <Empty text="Nothing here yet. Add your first achievement to get started." />;
  return <div className="panel item-list">{items.map(i=><div className="item-row" key={i._id}>
    <div className={`item-symbol ${i.type}`}><Award size={19}/></div>
    <div className="item-info">
      <strong>{i.title}</strong>
      <p>{pretty(i.type)} {i.type === "project" && i.technologies?.length ? `· ${i.technologies.join(", ")}` : i.details ? `· ${i.details}` : ""}</p>
      {i.description&&<small>{i.description}</small>}
      {i.type === "project" && <div className="project-links">
        {i.githubUrl && <a href={i.githubUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/> GitHub repository</a>}
        {i.demoUrl && <a href={i.demoUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Live demo</a>}
      </div>}
      {i.link && <a href={i.link} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Open link</a>}
      {!!i.evidence?.length && <div className="evidence-links">{i.evidence.map(file=><a key={file.id} href={file.url} target="_blank" rel="noreferrer"><FileText size={13}/> {file.name}</a>)}</div>}
      {i.adminRemark&&<small>{i.adminRemark}</small>}
    </div>
    <Status status={i.status}/>
    {!publicView && i.type === "project" && <button className="icon-btn" title="Edit project" onClick={()=>onEdit(i)}><Pencil size={15}/></button>}
    {!publicView && (i.type === "project" || i.status !== "verified") && <button className="icon-btn delete" title="Delete" onClick={()=>onDelete(i._id)}><Trash2 size={16}/></button>}
  </div>)}</div>;
}
function Empty({text}) { return <div className="empty"><div className="empty-icon"><BookOpen/></div><strong>{text}</strong></div>; }

export default App;

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Config ─────────────────────────────────────────────────────────────────
const API = "https://dbr-backend-yjfm.onrender.com";

// ── Helpers ────────────────────────────────────────────────────────────────
function api(path, opts = {}, token) {
  const isFormData = typeof FormData !== "undefined" && opts?.body instanceof FormData;
  const baseHeaders = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs || 180000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(`${API}${path}`, {
    ...opts,
    signal: opts.signal || controller.signal,
    headers: {
      ...baseHeaders,
      ...(opts.headers || {}),
    },
  })
    .then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: "Request failed" }));
        let detail = err?.detail || "Request failed";
        if (Array.isArray(detail)) {
          detail = detail
            .map((d) => (typeof d === "string" ? d : (d?.msg || JSON.stringify(d))))
            .join("; ");
        }
        throw new Error(detail);
      }
      if (r.status === 204) return null;
      return r.json();
    })
    .catch((err) => {
      if (err?.name === "AbortError") {
        throw new Error("Request timed out. The AI review may still be running; please try again in a moment.");
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
    });
}

function apiForm(path, formData, token) {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  }).then(async (r) => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: "Request failed" }));
      throw new Error(err.detail || "Request failed");
    }
    return r.json();
  });
}

const STATUS_COLOR = {
  uploaded: "#6366f1",
  processing: "#f59e0b",
  under_scrutiny: "#3b82f6",
  needs_correction: "#ef4444",
  approved: "#10b981",
};

const ROLE_COLOR = {
  admin: "#8b5cf6",
  officer: "#0ea5e9",
  metro_authority: "#f97316",
};

const CAT_COLOR = {
  safety: "#ef4444",
  calculation: "#f59e0b",
  completeness: "#10b981",
  design: "#6366f1",
};

function Badge({ label, color }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 99,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      background: color + "22", color: color, border: `1px solid ${color}44`,
      textTransform: "uppercase",
    }}>{label}</span>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
      <div style={{
        width: 28, height: 28, border: "3px solid #1e293b",
        borderTopColor: "#6366f1", borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }} />
    </div>
  );
}

function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3200); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 999,
      background: type === "error" ? "#ef4444" : "#10b981",
      color: "#fff", padding: "12px 20px", borderRadius: 10,
      fontSize: 14, fontWeight: 500, boxShadow: "0 4px 24px #0006",
      display: "flex", alignItems: "center", gap: 10,
      animation: "fadeUp 0.25s ease",
    }}>
      {type === "error" ? "✕" : "✓"} {msg}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#00000088", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }} onClick={onClose}>
      <div style={{
        background: "#0f172a", border: "1px solid #1e293b",
        borderRadius: 16, padding: 28, width: "100%",
        maxWidth: wide ? 1200 : 480,
        maxHeight: "92vh", overflowY: "auto",
        animation: "fadeUp 0.2s ease",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, color: "#f1f5f9" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
      {props.type === "textarea" ? (
        <textarea {...props} type={undefined} style={{
          width: "100%", background: "#1e293b", border: "1px solid #334155",
          borderRadius: 8, padding: "10px 12px", color: "#f1f5f9", fontSize: 14,
          outline: "none", resize: "vertical", minHeight: 90,
          boxSizing: "border-box", fontFamily: "inherit",
          ...props.style
        }} />
      ) : props.type === "select" ? (
        <select {...props} type={undefined} style={{
          width: "100%", background: "#1e293b", border: "1px solid #334155",
          borderRadius: 8, padding: "10px 12px", color: "#f1f5f9", fontSize: 14,
          outline: "none", boxSizing: "border-box",
          ...props.style
        }}>{props.children}</select>
      ) : (
        <input {...props} style={{
          width: "100%", background: "#1e293b", border: "1px solid #334155",
          borderRadius: 8, padding: "10px 12px", color: "#f1f5f9", fontSize: 14,
          outline: "none", boxSizing: "border-box",
          ...props.style
        }} />
      )}
    </div>
  );
}

function Btn({ children, variant = "primary", ...props }) {
  const styles = {
    primary: { background: "#6366f1", color: "#fff", border: "none" },
    ghost: { background: "transparent", color: "#94a3b8", border: "1px solid #334155" },
    danger: { background: "#ef4444", color: "#fff", border: "none" },
  };
  return (
    <button {...props} style={{
      padding: "9px 18px", borderRadius: 8, fontSize: 14, fontWeight: 600,
      cursor: props.disabled ? "not-allowed" : "pointer",
      opacity: props.disabled ? 0.5 : 1,
      transition: "opacity 0.15s", fontFamily: "inherit",
      ...styles[variant], ...props.style,
    }}>{children}</button>
  );
}

// ── Login ──────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("admin@uths.gov.in");
  const [pass, setPass] = useState("admin123");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      const form = new FormData();
      form.append("username", email);
      form.append("password", pass);
      const res = await fetch(`${API}/auth/login`, { method: "POST", body: form });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail); }
      const data = await res.json();
      onLogin(data.access_token, data.user);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#020817",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
      `}</style>
      <div style={{
        width: "100%", maxWidth: 400, padding: 40,
        background: "#0f172a", border: "1px solid #1e293b",
        borderRadius: 20, animation: "fadeUp 0.3s ease",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, background: "#6366f122",
            border: "1px solid #6366f144", borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px", fontSize: 24,
          }}>⬡</div>
          <h1 style={{ margin: 0, fontSize: 22, color: "#f1f5f9", fontWeight: 700 }}>DBR Admin Portal</h1>
          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>UTHS Metro Rail Scrutiny System</p>
        </div>
        <form onSubmit={submit}>
          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <Input label="Password" type="password" value={pass} onChange={e => setPass(e.target.value)} required />
          {err && <p style={{ color: "#ef4444", fontSize: 13, margin: "0 0 12px" }}>{err}</p>}
          <Btn type="submit" disabled={loading} style={{ width: "100%", marginTop: 4 }}>
            {loading ? "Signing in…" : "Sign in"}
          </Btn>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard Stats ────────────────────────────────────────────────────────
function StatsCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b",
      borderRadius: 14, padding: "20px 24px",
    }}>
      <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: color || "#f1f5f9", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Dashboard({ token }) {
  const [stats, setStats] = useState(null);
  useEffect(() => { api("/stats", {}, token).then(setStats); }, [token]);
  if (!stats) return <Spinner />;
  return (
    <div>
      <h2 style={{ margin: "0 0 24px", fontSize: 20, color: "#f1f5f9" }}>Overview</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
        <StatsCard label="Total documents" value={stats.total_documents} color="#6366f1" />
        <StatsCard label="Active rules" value={stats.active_rules} sub={`${stats.total_rules} total`} color="#10b981" />
        <StatsCard label="Total users" value={stats.total_users} color="#f59e0b" />
        <StatsCard label="Needs correction" value={stats.documents_by_status.needs_correction} color="#ef4444" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#94a3b8" }}>Documents by status</h3>
          {Object.entries(stats.documents_by_status).map(([status, count]) => (
            <div key={status} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[status] || "#64748b" }} />
              <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", textTransform: "capitalize" }}>{status.replace(/_/g, " ")}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{count}</span>
            </div>
          ))}
        </div>
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: 24 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, color: "#94a3b8" }}>Users by role</h3>
          {Object.entries(stats.users_by_role).map(([role, count]) => (
            <div key={role} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_COLOR[role] || "#64748b" }} />
              <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", textTransform: "capitalize" }}>{role}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Rules ──────────────────────────────────────────────────────────────────
// Section tree mirrors the model DBR document structure.
const SECTION_TREE = [
  { id: "all", label: "All sections", icon: "⊟", children: [] },
  {
    id: "s1", label: "1. Safety Certification & Technical Clearance", icon: "🛡",
    children: [
      { id: "s1_1", label: "1.1 Criteria for Oscillation Trials" },
      { id: "s1_2", label: "1.2 Procedure of Safety Certification" },
      { id: "s1_3", label: "1.3 MoM of Review of Criteria" },
    ],
  },
  {
    id: "s2", label: "2. Standards Documents", icon: "📋",
    children: [
      {
        id: "s2_1", label: "2.1 Civil",
        children: [
          { id: "s2_1_1", label: "2.1.1 Guidelines for Framing SOD" },
          { id: "s2_1_2_1", label: "2.1.2.1 Model DBR — Viaducts" },
          { id: "s2_1_2_2", label: "2.1.2.2 Model DBR — Elevated Stations" },
          { id: "s2_1_2_3", label: "2.1.2.3 Model DBR — Bored Tunnels" },
          { id: "s2_1_2_4", label: "2.1.2.4 Model DBR — Cut and Cover" },
          { id: "s2_1_3", label: "2.1.3 Track Structure — Annexure C1" },
          { id: "s2_1_4", label: "2.1.4 Fastening System — Annexure C2" },
          { id: "s2_1_5", label: "2.1.5 RDSO Rail Structure Interaction v2" },
        ],
      },
      { id: "s2_2", label: "2.2 Mechanical", children: [{ id: "s2_2_1", label: "2.2.1 Rolling Stock Documents — Annexure A" }] },
      {
        id: "s2_3", label: "2.3 Electrical",
        children: [
          { id: "s2_3_1", label: "2.3.1 Rolling Stock Documents — Annexure B" },
          { id: "s2_3_2", label: "2.3.2 Traction & Power Supply — Annexure D1 & D2" },
        ],
      },
      { id: "s2_4", label: "2.4 Signal & Telecom", children: [{ id: "s2_4_1", label: "2.4.1 Signalling & Communication — Annexure E1 & E2" }] },
    ],
  },
  {
    id: "s3", label: "3. Certificates for OSC & EBD Trials", icon: "📄",
    children: [
      { id: "s3_1", label: "3.1 Rolling Stock Fitness Certificate" },
      { id: "s3_2", label: "3.2 Track Fitness & Fastening Certificates" },
      { id: "s3_3", label: "3.3 Bridge & Structure Fitness Certificates" },
      { id: "s3_4", label: "3.4 Infringement of Moving and Fixed Dimension" },
      { id: "s3_5", label: "3.5 Calculation of Speed on Curve" },
    ],
  },
];

function findSectionLabel(id, nodes = SECTION_TREE) {
  for (const n of nodes) {
    if (n.id === id) return n.label;
    if (n.children) { const f = findSectionLabel(id, n.children); if (f) return f; }
  }
  return null;
}

function getLeafSections(nodes = SECTION_TREE) {
  const out = [];
  function walk(n) {
    if (n.id === "all") return;
    if (!n.children || n.children.length === 0) { out.push(n); return; }
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return out;
}

function SectionSidebar({ selected, onSelect, paragraphs }) {
  const [expanded, setExpanded] = useState({ s1: true, s2: true, s2_1: true, s2_2: false, s2_3: false, s2_4: false, s3: true });
  function toggle(id) { setExpanded(e => ({ ...e, [id]: !e[id] })); }
  const hasContent = id => !!(paragraphs[id] && (paragraphs[id].rule_text || paragraphs[id].pdfs?.length));

  function renderNode(node, depth = 0) {
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selected === node.id;
    const isExpanded = expanded[node.id];
    const showDot = !hasChildren && hasContent(node.id);
    return (
      <div key={node.id}>
        <div
          onClick={() => { if (hasChildren) toggle(node.id); else onSelect(node.id); if (node.id === "all") onSelect("all"); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: `7px ${10 + depth * 12}px`,
            cursor: "pointer", borderRadius: 5,
            background: isSelected ? "#6366f122" : "transparent",
            borderLeft: isSelected ? "3px solid #6366f1" : "3px solid transparent",
            color: isSelected ? "#c7d2fe" : depth === 0 ? "#e2e8f0" : "#94a3b8",
            fontWeight: isSelected ? 700 : depth === 0 ? 600 : 500,
            fontSize: depth === 0 ? 13 : 12,
            transition: "all 0.12s", marginBottom: 1,
          }}
        >
          {node.icon && <span style={{ fontSize: 14 }}>{node.icon}</span>}
          {hasChildren && (
            <span style={{ fontSize: 10, color: "#64748b", marginRight: 2, display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▶</span>
          )}
          <span style={{ flex: 1, lineHeight: 1.4 }}>{node.label}</span>
          {showDot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} title="Has rule" />}
        </div>
        {hasChildren && isExpanded && <div>{node.children.map(c => renderNode(c, depth + 1))}</div>}
      </div>
    );
  }

  return (
    <div style={{ width: 280, flexShrink: 0, background: "#0b1220", borderRight: "1px solid #1e293b", overflowY: "auto", padding: "12px 8px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 12px 10px" }}>DBR Sections</div>
      {SECTION_TREE.map(n => renderNode(n))}
    </div>
  );
}

function PdfPreview({ pdfId, token }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setBlobUrl(null);
    setErr("");
    if (!pdfId || !token) {
      setErr("PDF not available");
      return;
    }
    fetch(`${API}/section-pdfs/${pdfId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({ detail: "Unable to load PDF" }));
          throw new Error(d.detail || "Unable to load PDF");
        }
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || "Unable to load PDF");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdfId, token]);

  if (err) return <div style={{ padding: 24, color: "#94a3b8", fontSize: 13, textAlign: "center" }}>📄 {err}</div>;
  if (!blobUrl) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
      <div style={{ width: 22, height: 22, border: "3px solid #1e293b", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
    </div>
  );
  return (
    <object data={blobUrl} type="application/pdf" style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}>
      <div style={{ padding: 16, fontSize: 13, color: "#334155" }}>
        PDF preview is not available in this browser.
        <div style={{ marginTop: 8 }}>
          <a href={blobUrl} target="_blank" rel="noopener noreferrer">Open PDF in new tab</a>
        </div>
      </div>
    </object>
  );
}

function RulesPage({ token, toast }) {
  const [paragraphs, setParagraphs] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("all");
  const [modal, setModal] = useState(null);
  const [draftText, setDraftText] = useState("");
  const [pendingPdf, setPendingPdf] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0);
  const [pdfPanelOpen, setPdfPanelOpen] = useState(true);
  const pdfInputRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    api("/section-rules", {}, token)
      .then(list => {
        const map = {};
        list.forEach(s => { map[s.section_id] = s; });
        setParagraphs(map);
        setLoading(false);
      })
      .catch(e => { toast(e.message, "error"); setLoading(false); });
  }, [token, toast]);

  useEffect(load, [load]);

  const leafSections = useMemo(() => getLeafSections(), []);
  const populatedSections = useMemo(
    () => leafSections.filter(s => {
      const row = paragraphs[s.id];
      return row && (row.rule_text || (row.pdfs && row.pdfs.length));
    }),
    [leafSections, paragraphs]
  );

  const current = activeSection !== "all"
    ? (paragraphs[activeSection] || { section_id: activeSection, rule_text: "", pdfs: [] })
    : null;

  function openEditor(sectionId) {
    setActiveSection(sectionId);
    setPdfPanelOpen(true);
    const existing = paragraphs[sectionId];
    setDraftText(existing?.rule_text || "");
    setPendingPdf(null);
    setModal("edit");
  }

  async function saveDraft() {
    if (activeSection === "all") return;
    setSaving(true);
    try {
      await api(`/section-rules/${activeSection}`, {
        method: "PUT",
        body: JSON.stringify({ rule_text: draftText }),
      }, token);
      if (pendingPdf) {
        const fd = new FormData();
        fd.append("files", pendingPdf);
        const res = await fetch(`${API}/section-rules/${activeSection}/pdfs`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({ detail: "PDF upload failed" }));
          throw new Error(d.detail);
        }
      }
      toast("Section rule saved", "success");
      setModal(null);
      setPendingPdf(null);
      setPdfRefreshKey(k => k + 1);
      load();
    } catch (e) {
      toast(e.message, "error");
    }
    setSaving(false);
  }

  async function removePdf(pdfId) {
    if (!pdfId) return;
    if (!window.confirm("Remove the attached reference PDF?")) return;
    try {
      await api(`/section-pdfs/${pdfId}`, { method: "DELETE" }, token);
      toast("PDF removed", "success");
      setPdfRefreshKey(k => k + 1);
      load();
    } catch (e) { toast(e.message, "error"); }
  }

  // Live preview URL for the pending file (created/revoked here so it doesn't leak)
  const [pendingPdfUrl, setPendingPdfUrl] = useState(null);
  useEffect(() => {
    if (!pendingPdf) { setPendingPdfUrl(null); return; }
    const url = URL.createObjectURL(pendingPdf);
    setPendingPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingPdf]);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 130px)", margin: "-8px 0 0", border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden", background: "#020817" }}>
      <SectionSidebar selected={activeSection} onSelect={id => { setActiveSection(id); setPdfPanelOpen(true); }} paragraphs={paragraphs} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, color: "#f1f5f9", fontWeight: 700 }}>
              {activeSection === "all" ? "All section rules" : findSectionLabel(activeSection)}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
              {activeSection === "all"
                ? `${populatedSections.length} of ${leafSections.length} sections have a rule paragraph`
                : "One rule paragraph per section, with an optional reference PDF"}
            </p>
          </div>
          {activeSection !== "all" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {current?.pdfs?.length > 0 && !pdfPanelOpen && (
                <Btn variant="ghost" onClick={() => setPdfPanelOpen(true)}>Show PDF</Btn>
              )}
              <Btn onClick={() => openEditor(activeSection)}>
                {current?.rule_text || current?.pdfs?.length ? "Edit rule" : "+ Add rule"}
              </Btn>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }}>
          {loading ? <Spinner /> : activeSection === "all" ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              {populatedSections.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569" }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                  <p style={{ fontSize: 14 }}>No section rules yet. Pick a section from the left to add one.</p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {populatedSections.map(s => {
                    const p = paragraphs[s.id];
                    return (
                      <div key={s.id} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "16px 18px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#c7d2fe", marginBottom: 4 }}>{s.label}</div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              {p.pdfs?.length > 0 && <Badge label={`📎 ${p.pdfs[0]?.name || "PDF"}${p.pdfs.length > 1 ? ` (+${p.pdfs.length - 1})` : ""}`} color="#6366f1" />}
                              {p.updated_at && <span style={{ fontSize: 11, color: "#475569" }}>Updated {new Date(p.updated_at).toLocaleDateString("en-IN")}</span>}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setActiveSection(s.id)}>Open</Btn>
                            <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => openEditor(s.id)}>Edit</Btn>
                          </div>
                        </div>
                        {p.rule_text && (
                          <p style={{ margin: 0, fontSize: 13, color: "#cbd5e1", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                            {p.rule_text.length > 320 ? p.rule_text.slice(0, 320) + "…" : p.rule_text}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minWidth: 0 }}>
                {current.rule_text ? (
                  <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "20px 22px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Rule paragraph</div>
                    <p style={{ margin: 0, fontSize: 14, color: "#e2e8f0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{current.rule_text}</p>
                    <div style={{ marginTop: 18, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {current.pdfs?.length > 0
                        ? <Badge label={`📎 ${current.pdfs[0]?.name || "Reference PDF attached"}${current.pdfs.length > 1 ? ` (+${current.pdfs.length - 1})` : ""}`} color="#6366f1" />
                        : <span style={{ fontSize: 12, color: "#64748b" }}>No reference PDF attached</span>}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569" }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📝</div>
                    <p style={{ fontSize: 14, marginBottom: 16 }}>No rule paragraph for this section yet.</p>
                    <Btn onClick={() => openEditor(activeSection)}>+ Add rule paragraph</Btn>
                  </div>
                )}
              </div>

              {pdfPanelOpen && <div style={{ width: 520, flexShrink: 0, borderLeft: "1px solid #1e293b", background: "#0b1220", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>📄 Reference PDF</span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {current.pdfs?.length > 0 && (
                      <button onClick={() => removePdf(current.pdfs[0]?.id)} style={{ background: "none", border: "none", color: "#ef4444", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Remove</button>
                    )}
                    <button onClick={() => setPdfPanelOpen(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 18, lineHeight: 1, cursor: "pointer" }} aria-label="Close PDF preview">×</button>
                  </div>
                </div>
                <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
                  {current.pdfs?.length > 0
                    ? <PdfPreview pdfId={current.pdfs[0]?.id} token={token} />
                    : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#475569", padding: 24, textAlign: "center" }}>
                        <div style={{ fontSize: 32, marginBottom: 10 }}>📎</div>
                        <p style={{ fontSize: 13, margin: "0 0 14px" }}>No reference PDF attached</p>
                        <Btn variant="ghost" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => openEditor(activeSection)}>Attach PDF</Btn>
                      </div>
                    )}
                </div>
              </div>}
            </>
          )}
        </div>
      </div>

      {modal === "edit" && activeSection !== "all" && (
        <Modal wide title={`Edit rule — ${findSectionLabel(activeSection)}`} onClose={() => { setModal(null); setPendingPdf(null); }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, minHeight: 520 }}>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Rule paragraph for this section</label>
              <textarea
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                placeholder="Paste or type the full set of rules for this section as a single paragraph (or multiple lines)."
                style={{
                  flex: 1, minHeight: 360, background: "#020817", border: "1px solid #334155",
                  borderRadius: 8, padding: "12px 14px", color: "#f1f5f9", fontSize: 14,
                  lineHeight: 1.6, outline: "none", resize: "none",
                  boxSizing: "border-box", fontFamily: "inherit",
                }}
              />
              <div style={{ marginTop: 14 }}>
                <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>Reference PDF</label>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: "none" }}
                  onChange={e => { if (e.target.files[0]) setPendingPdf(e.target.files[0]); }}
                />
                {pendingPdf ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#1e293b", border: "1px solid #6366f1", borderRadius: 8 }}>
                    <span style={{ fontSize: 13, color: "#c7d2fe", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {pendingPdf.name}</span>
                    <button onClick={() => setPendingPdf(null)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}>×</button>
                    <button onClick={() => pdfInputRef.current?.click()} style={{ background: "none", border: "1px solid #334155", color: "#94a3b8", padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Change</button>
                  </div>
                ) : current?.pdfs?.length > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}>
                    <span style={{ fontSize: 13, color: "#cbd5e1", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {current.pdfs[0]?.name || "PDF attached"}</span>
                    <button onClick={() => pdfInputRef.current?.click()} style={{ background: "none", border: "1px solid #334155", color: "#94a3b8", padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Replace</button>
                  </div>
                ) : (
                  <button
                    onClick={() => pdfInputRef.current?.click()}
                    style={{
                      width: "100%", padding: "12px", background: "#020817",
                      border: "1px dashed #334155", borderRadius: 8, color: "#94a3b8",
                      fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >📎 Click to attach a reference PDF</button>
                )}
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "#475569" }}>
                  The PDF preview on the right shows {pendingPdf ? "the newly selected file" : current?.pdfs?.length ? "the currently attached PDF" : "nothing yet"}.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden", background: "#0b1220", minHeight: 0 }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid #1e293b", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
                Reference PDF preview
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                {pendingPdfUrl ? (
                  <iframe
                    src={pendingPdfUrl}
                    title="New PDF preview"
                    style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
                  />
                ) : current?.pdfs?.length ? (
                  <PdfPreview pdfId={current.pdfs[0]?.id} token={token} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#475569", fontSize: 13, padding: 20, textAlign: "center" }}>
                    Attach a PDF on the left to preview it here while you edit the rule text.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => { setModal(null); setPendingPdf(null); }}>Cancel</Btn>
            <Btn onClick={saveDraft} disabled={saving || (!draftText.trim() && !pendingPdf && !current?.pdfs?.length)}>
              {saving ? "Saving…" : "Save section rule"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────
function DocumentPdfViewer({ docId, token }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setBlobUrl(null);
    setErr("");
    if (!docId) return;
    fetch(`${API}/documents/${docId}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({ detail: "Unable to load PDF" }));
          throw new Error(d.detail || "Unable to load PDF");
        }
        return r.blob();
      })
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId, token]);

  if (err) return <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>{err}</div>;
  if (!blobUrl) return <Spinner />;
  return <object data={blobUrl} type="application/pdf" style={{ width: "100%", height: "100%", border: "none", background: "#fff" }} />;
}

function DocumentsPage({ token, toast, user }) {
  const [tab, setTab] = useState(user.role === "metro_authority" ? "user" : "authority");
  const [sections, setSections] = useState([]);
  const [userDocs, setUserDocs] = useState([]);
  const [reviewDocs, setReviewDocs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [sectionId, setSectionId] = useState("");
  const [files, setFiles] = useState([]);
  const [decisionComment, setDecisionComment] = useState("");
  const [pdfOpen, setPdfOpen] = useState(true);
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const [pdfWidth, setPdfWidth] = useState("wide");

  const statusColor = {
    uploaded: "#64748b",
    processing: "#f59e0b",
    under_scrutiny: "#3b82f6",
    needs_correction: "#f97316",
    approved: "#10b981",
    flagged: "#ef4444",
    pending_rules: "#a855f7",
    ai_error: "#ef4444",
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api("/sections", {}, token),
      user.role === "metro_authority" ? api("/metro-authority/documents", {}, token).catch(() => []) : Promise.resolve([]),
      user.role !== "metro_authority" ? api("/review-documents", {}, token).catch(() => []) : Promise.resolve([]),
    ]).then(([sectionList, ownDocs, allDocs]) => {
      setSections(sectionList);
      setUserDocs(ownDocs);
      setReviewDocs(allDocs);
      setSectionId(sectionList[0]?.id || "");
      setLoading(false);
    }).catch(e => { toast(e.message, "error"); setLoading(false); });
  }, [token, toast, user.role]);

  useEffect(load, [load]);

  async function uploadFiles() {
    if (!sectionId || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${API}/metro-authority/upload?section_id=${encodeURIComponent(sectionId)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({ detail: "Upload failed" }));
          throw new Error(d.detail || "Upload failed");
        }
      }
      toast("PDF submitted for AI review", "success");
      setFiles([]);
      load();
    } catch (e) { toast(e.message, "error"); }
    setUploading(false);
  }

  async function resubmit(doc, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API}/metro-authority/documents/${doc.id}/resubmit?section_id=${encodeURIComponent(doc.section_id || sectionId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ detail: "Resubmit failed" }));
        throw new Error(d.detail || "Resubmit failed");
      }
      toast("Corrected version uploaded", "success");
      load();
    } catch (e) { toast(e.message, "error"); }
  }

  async function openReview(doc) {
    const detail = await api(`/review-documents/${doc.id}`, {}, token);
    setSelected(detail);
    setDecisionComment(detail.review_comment || "");
    setPdfOpen(true);
    setPdfExpanded(false);
  }

  async function decide(decision) {
    if (!selected) return;
    try {
      const updated = await api(`/review-documents/${selected.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, comment: decision === "flagged" ? decisionComment : "" }),
      }, token);
      toast(decision === "approved" ? "Document approved" : "Document flagged", "success");
      setSelected(updated);
      load();
    } catch (e) { toast(e.message, "error"); }
  }

  async function rerunAiReview() {
    if (!selected) return;
    try {
      const updated = await api(`/review-documents/${selected.id}/rerun-ai`, { method: "POST", timeoutMs: 240000 }, token);
      setSelected(updated);
      setDecisionComment("");
      toast("AI review rerun with latest subsection rules", "success");
      load();
    } catch (e) { toast(e.message, "error"); }
  }

  const groupedDocs = reviewDocs.reduce((acc, doc) => {
    const key = doc.section_label || "Unassigned";
    acc[key] = acc[key] || [];
    acc[key].push(doc);
    return acc;
  }, {});

  function DocTable({ docs, reviewMode }) {
    return (
      <div style={{ overflowX: "auto", border: "1px solid #1e293b", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#0b1220", borderBottom: "1px solid #1e293b" }}>
              {["File", "User", "Section", "Uploaded", "Status", "Result"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {docs.map(doc => (
              <tr key={doc.id} onClick={() => reviewMode && openReview(doc)} style={{ borderBottom: "1px solid #0f172a", cursor: reviewMode ? "pointer" : "default" }}>
                <td style={{ padding: "12px", color: "#e2e8f0", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.filename}</td>
                <td style={{ padding: "12px", color: "#94a3b8" }}>{doc.metro_authority_name}</td>
                <td style={{ padding: "12px", color: "#94a3b8" }}>{doc.section_label || "-"}</td>
                <td style={{ padding: "12px", color: "#64748b", whiteSpace: "nowrap" }}>{new Date(doc.uploaded_at).toLocaleDateString("en-IN")}</td>
                <td style={{ padding: "12px" }}><Badge label={doc.status.replace(/_/g, " ")} color={statusColor[doc.status] || "#64748b"} /></td>
                <td style={{ padding: "12px", color: "#94a3b8" }}>
                  {doc.review_comment || doc.ai_result?.overallStatus?.replace(/_/g, " ") || "Pending"}
                  {!reviewMode && doc.status === "flagged" && (
                    <label style={{ marginLeft: 10, color: "#c7d2fe", cursor: "pointer" }}>
                      Upload correction
                      <input type="file" accept=".pdf" style={{ display: "none" }} onChange={e => resubmit(doc, e.target.files[0])} />
                    </label>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "#f1f5f9" }}>AI Compliance Review</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant={tab === "user" ? "primary" : "ghost"} onClick={() => setTab("user")}>User Upload Dashboard</Btn>
          <Btn variant={tab === "authority" ? "primary" : "ghost"} onClick={() => setTab("authority")}>Authority Review Dashboard</Btn>
        </div>
      </div>

      {loading ? <Spinner /> : tab === "user" ? (
        <div style={{ display: "grid", gap: 18 }}>
          {user.role === "metro_authority" && (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(260px, 1fr) auto", gap: 12, alignItems: "end" }}>
                <Input label="Section / subsection" type="select" value={sectionId} onChange={e => setSectionId(e.target.value)}>
                  {sections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
                </Input>
                <Input label="PDF files" type="file" accept=".pdf" multiple onChange={e => setFiles(Array.from(e.target.files || []))} />
                <Btn onClick={uploadFiles} disabled={uploading || !sectionId || files.length === 0}>{uploading ? "Uploading..." : "Upload"}</Btn>
              </div>
            </div>
          )}
          <DocTable docs={user.role === "metro_authority" ? userDocs : reviewDocs} />
        </div>
      ) : selected ? (
        <div style={{ minHeight: "calc(100vh - 150px)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            padding: "12px 14px", border: "1px solid #1e293b", borderRadius: 10,
            background: "#0b1220",
          }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.filename}</h3>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>{selected.section_label}</p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Badge label={selected.ai_result?.overallStatus?.replace(/_/g, " ") || selected.status} color={statusColor[selected.status] || "#64748b"} />
              {!pdfOpen && <Btn variant="ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setPdfOpen(true)}>Reopen PDF</Btn>}
              <Btn variant="ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={rerunAiReview}>Rerun AI Review</Btn>
              <Btn variant="ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => { setSelected(null); setPdfOpen(true); setPdfExpanded(false); }}>X Close Review</Btn>
            </div>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: pdfOpen ? (pdfExpanded ? "minmax(780px, 1.75fr) minmax(360px, 0.55fr)" : pdfWidth === "wide" ? "minmax(680px, 1.45fr) minmax(420px, 0.75fr)" : "minmax(520px, 1fr) minmax(460px, 0.9fr)") : "1fr",
            border: "1px solid #1e293b",
            borderRadius: 10,
            overflow: "hidden",
            background: "#0b1220",
            minHeight: "calc(100vh - 230px)",
          }}>
              {pdfOpen && (
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderBottom: "1px solid #1e293b", background: "#0f172a" }}>
                    <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 700 }}>PDF Review</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {!pdfExpanded && <Btn variant="ghost" style={{ padding: "5px 9px", fontSize: 11 }} onClick={() => setPdfWidth(pdfWidth === "wide" ? "balanced" : "wide")}>{pdfWidth === "wide" ? "Balanced" : "Wider PDF"}</Btn>}
                      <Btn variant="ghost" style={{ padding: "5px 9px", fontSize: 11 }} onClick={() => setPdfExpanded(v => !v)}>{pdfExpanded ? "Exit expand" : "Expand PDF"}</Btn>
                      <Btn variant="ghost" style={{ padding: "5px 9px", fontSize: 11 }} onClick={() => setPdfOpen(false)}>Close PDF</Btn>
                    </div>
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <DocumentPdfViewer docId={selected.id} token={token} />
                  </div>
                </div>
              )}
              <div style={{ borderLeft: pdfOpen ? "1px solid #1e293b" : "none", padding: 16, overflowY: "auto", background: "#0b1220" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#f1f5f9" }}>Compliance Card</h3>
                {selected.ai_result?.metadata && (
                  <div style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 10, marginBottom: 12, background: "#020817" }}>
                    <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.7 }}>
                      <div><strong style={{ color: "#cbd5e1" }}>AI mode:</strong> {selected.ai_result.metadata.aiMode} / {selected.ai_result.metadata.model}</div>
                      <div><strong style={{ color: "#cbd5e1" }}>Subsection:</strong> {selected.ai_result.metadata.sectionId} - {selected.ai_result.metadata.subsectionLabel}</div>
                      <div><strong style={{ color: "#cbd5e1" }}>Rules used:</strong> {selected.ai_result.metadata.ruleCount} fragments, {selected.ai_result.metadata.rulesTextLength} characters</div>
                    </div>
                    {selected.ai_result.metadata.rulesTextLength === 0 ? (
                      <div style={{ marginTop: 8, color: "#f59e0b", fontSize: 12 }}>No text rules were found for this subsection. Add rules in the Rules page and rerun AI review.</div>
                    ) : (
                      <details style={{ marginTop: 8, color: "#94a3b8", fontSize: 12 }}>
                        <summary style={{ cursor: "pointer", color: "#c7d2fe" }}>Rules preview</summary>
                        <div style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "#94a3b8" }}>{selected.ai_result.metadata.rulesPreview}</div>
                      </details>
                    )}
                  </div>
                )}
                {(selected.ai_result?.issues || []).length === 0 ? (
                  (() => {
                    const status = selected.ai_result?.overallStatus;
                    const msg = selected.ai_result?.metadata?.message;
                    if (status === "pending_rules") {
                      return (
                        <div style={{ background: "#1e1040", border: "1px solid #a855f744", borderRadius: 10, padding: 18 }}>
                          <div style={{ color: "#c084fc", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>⏳ No rules configured for this section</div>
                          <p style={{ margin: 0, color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>{msg || "Add a rule paragraph for this section in the Rules page, then click Rerun AI Review."}</p>
                        </div>
                      );
                    }
                    if (status === "ai_error") {
                      return (
                        <div style={{ background: "#1f0e0e", border: "1px solid #ef444444", borderRadius: 10, padding: 18 }}>
                          <div style={{ color: "#f87171", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>⚠ AI model error</div>
                          <p style={{ margin: "0 0 8px", color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>{msg || "The AI model could not complete the review."}</p>
                          {selected.ai_result?.metadata?.error && (
                            <code style={{ display: "block", fontSize: 11, color: "#64748b", background: "#0f172a", padding: "6px 10px", borderRadius: 6, wordBreak: "break-all" }}>
                              {String(selected.ai_result.metadata.error)}
                            </code>
                          )}
                        </div>
                      );
                    }
                    return <p style={{ color: "#94a3b8", fontSize: 13 }}>No missing, violation, or manual-review issues were returned.</p>;
                  })()
                ) : selected.ai_result.issues.map((issue, index) => (
                  <div key={`${issue.ruleId}-${index}`} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 12, marginBottom: 10, background: "#0f172a" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                      <strong style={{ color: "#f1f5f9", fontSize: 13 }}>{issue.ruleTitle || issue.ruleId}</strong>
                      <Badge label={`${issue.issueType} / ${issue.severity}`} color={issue.severity === "high" ? "#ef4444" : "#f59e0b"} />
                    </div>
                    <p style={{ margin: "0 0 8px", color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 }}>{issue.explanation}</p>
                    <p style={{ margin: "0 0 8px", color: "#94a3b8", fontSize: 12 }}>Suggested: {issue.suggestedCorrection}</p>
                    {(issue.pageNumber || issue.matchedText) && (
                      <div style={{ borderTop: "1px solid #1e293b", paddingTop: 8, color: "#64748b", fontSize: 12 }}>
                        Page {issue.pageNumber || "-"}: {issue.matchedText || "No matched text returned"}
                      </div>
                    )}
                  </div>
                ))}
                <textarea
                  value={decisionComment}
                  onChange={e => setDecisionComment(e.target.value)}
                  placeholder="Reason required when flagging/rejecting"
                  style={{ width: "100%", minHeight: 76, marginTop: 8, background: "#020817", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", padding: 10, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <Btn onClick={() => decide("approved")}>Pass / Approve</Btn>
                  <Btn variant="danger" onClick={() => decide("flagged")}>Flag / Reject</Btn>
                </div>
              </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16, alignContent: "start", minHeight: "calc(100vh - 180px)" }}>
          {Object.entries(groupedDocs).map(([section, docs]) => (
            <div key={section}>
              <h3 style={{ margin: "0 0 8px", color: "#cbd5e1", fontSize: 14 }}>{section}</h3>
              <DocTable docs={docs} reviewMode />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Users ──────────────────────────────────────────────────────────────────
function UsersPage({ token, toast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "officer" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api("/users", {}, token).then(d => { setUsers(d); setLoading(false); });
  }, [token]);

  useEffect(load, [load]);

  async function createUser() {
    setSaving(true);
    try {
      await api("/users", { method: "POST", body: JSON.stringify(form) }, token);
      toast("User created", "success"); setModal(false); load();
    } catch (e) { toast(e.message, "error"); }
    setSaving(false);
  }

  async function toggleUser(user) {
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !user.is_active }) }, token);
      toast(`User ${user.is_active ? "deactivated" : "activated"}`, "success"); load();
    } catch (e) { toast(e.message, "error"); }
  }

  async function deleteUser(id) {
    if (!window.confirm("Delete this user?")) return;
    try {
      await api(`/users/${id}`, { method: "DELETE" }, token);
      toast("User deleted", "success"); load();
    } catch (e) { toast(e.message, "error"); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "#f1f5f9" }}>Users</h2>
        <Btn onClick={() => { setForm({ name: "", email: "", password: "", role: "officer" }); setModal(true); }}>+ Add user</Btn>
      </div>
      {loading ? <Spinner /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {users.map(user => (
            <div key={user.id} style={{
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14,
              padding: "18px 20px", opacity: user.is_active ? 1 : 0.5,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: (ROLE_COLOR[user.role] || "#64748b") + "22",
                  border: `1px solid ${(ROLE_COLOR[user.role] || "#64748b")}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 15, fontWeight: 700, color: ROLE_COLOR[user.role] || "#64748b",
                }}>
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{user.name}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{user.email}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Badge label={user.role} color={ROLE_COLOR[user.role] || "#64748b"} />
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => toggleUser(user)}>
                    {user.is_active ? "Deactivate" : "Activate"}
                  </Btn>
                  <Btn variant="danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => deleteUser(user.id)}>Delete</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title="Add user" onClose={() => setModal(false)}>
          <Input label="Full name" type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <Input label="Password" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <Input label="Role" type="select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="admin">Admin</option>
            <option value="officer">Reviewing officer</option>
            <option value="metro_authority">Metro Authority</option>
          </Input>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn onClick={createUser} disabled={saving || !form.name || !form.email || !form.password}>
              {saving ? "Creating…" : "Create user"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Audit Log ──────────────────────────────────────────────────────────────
function AuditPage({ token }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/audit-logs", {}, token).then(d => { setLogs(d); setLoading(false); });
  }, [token]);

  const ACTION_COLOR = { created: "#10b981", updated: "#6366f1", deleted: "#ef4444", approved: "#10b981", dismissed: "#f59e0b", modified: "#6366f1", deactivated: "#ef4444", status_changed: "#3b82f6" };

  return (
    <div>
      <h2 style={{ margin: "0 0 24px", fontSize: 20, color: "#f1f5f9" }}>Audit log</h2>
      {loading ? <Spinner /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {logs.map(log => (
            <div key={log.id} style={{
              background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 10, padding: "12px 18px",
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <Badge label={log.action} color={ACTION_COLOR[log.action] || "#64748b"} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, color: "#cbd5e1" }}>
                  <strong style={{ color: "#f1f5f9" }}>{log.actor_name}</strong>
                  {" "}{log.action}{" "}
                  <code style={{ fontSize: 11, color: "#94a3b8", background: "#1e293b", padding: "1px 6px", borderRadius: 4 }}>{log.entity_type}</code>
                </span>
                {log.detail && <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{log.detail}</div>}
              </div>
              <span style={{ fontSize: 11, color: "#475569", whiteSpace: "nowrap" }}>
                {new Date(log.created_at).toLocaleString("en-IN")}
              </span>
            </div>
          ))}
          {logs.length === 0 && <p style={{ color: "#475569", textAlign: "center", padding: 40 }}>No audit logs yet.</p>}
        </div>
      )}
    </div>
  );
}

// ── App Shell ──────────────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "rules", label: "Rules", icon: "⊟" },
  { id: "documents", label: "Compliance", icon: "⊞" },
  { id: "users", label: "Users", icon: "⊛" },
  { id: "audit", label: "Audit log", icon: "⊕" },
];

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("token"));
  const [user, setUser] = useState(() => { try { return JSON.parse(sessionStorage.getItem("user")); } catch { return null; } });
  const [page, setPage] = useState("dashboard");
  const [toast, setToast] = useState(null);

  function handleLogin(t, u) {
    sessionStorage.setItem("token", t);
    sessionStorage.setItem("user", JSON.stringify(u));
    setToken(t); setUser(u);
  }

  function logout() {
    sessionStorage.clear();
    setToken(null); setUser(null);
  }

  function showToast(msg, type = "success") {
    setToast({ msg, type, key: Date.now() });
  }

  if (!token || !user) return <LoginPage onLogin={handleLogin} />;

  return (
    <div style={{
      minHeight: "100vh", background: "#020817",
      display: "flex", fontFamily: "'DM Sans', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        table tr:hover td { background: #0f172a88; }
      `}</style>

      {/* Sidebar */}
      <div style={{
        width: 220, background: "#0a1628", borderRight: "1px solid #1e293b",
        display: "flex", flexDirection: "column", padding: "24px 0",
        position: "sticky", top: 0, height: "100vh",
      }}>
        <div style={{ padding: "0 20px 24px", borderBottom: "1px solid #1e293b" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#6366f1", letterSpacing: "0.08em", textTransform: "uppercase" }}>DBR Portal</div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Admin Console</div>
        </div>
        <nav style={{ flex: 1, padding: "16px 12px" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)} style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "10px 12px", borderRadius: 8,
              background: page === n.id ? "#6366f122" : "transparent",
              border: page === n.id ? "1px solid #6366f144" : "1px solid transparent",
              color: page === n.id ? "#818cf8" : "#64748b",
              fontSize: 14, fontWeight: page === n.id ? 600 : 400,
              cursor: "pointer", textAlign: "left", marginBottom: 2,
              transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 16 }}>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: "16px 20px", borderTop: "1px solid #1e293b" }}>
          <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, marginBottom: 2 }}>{user.name}</div>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 12 }}>{user.email}</div>
          <Btn variant="ghost" style={{ width: "100%", fontSize: 12, padding: "7px 12px" }} onClick={logout}>Sign out</Btn>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: 32, overflowY: "auto" }}>
        {page === "dashboard" && <Dashboard token={token} />}
        {page === "rules" && <RulesPage token={token} toast={showToast} />}
        {page === "documents" && <DocumentsPage token={token} toast={showToast} user={user} />}
        {page === "users" && <UsersPage token={token} toast={showToast} />}
        {page === "audit" && <AuditPage token={token} />}
      </div>

      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Config ─────────────────────────────────────────────────────────────────
const API = "http://localhost:8000";

// ── Helpers ────────────────────────────────────────────────────────────────
function api(path, opts = {}, token) {
  return fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  }).then(async (r) => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: "Request failed" }));
      throw new Error(err.detail || "Request failed");
    }
    if (r.status === 204) return null;
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
  contractor: "#f97316",
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
        borderRadius: 16, padding: 28, width: "100%", maxWidth: wide ? 960 : 480,
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
        <p style={{ textAlign: "center", marginTop: 20, color: "#475569", fontSize: 12 }}>
          Default: admin@uths.gov.in / admin123
        </p>
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


// ── Rules ───────────────────────────────────────────────────────────────────

const SECTION_TREE = [
  { id: "all", label: "All Rules", icon: "⊟", children: [] },
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

function getAllSectionIds(nodes) {
  const ids = [];
  function walk(n) {
    if (!n.children || n.children.length === 0) { ids.push(n.id); return; }
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return ids;
}

function SectionSidebar({ selected, onSelect }) {
  const [expanded, setExpanded] = useState({ s1: true, s2: true, s2_1: false, s2_2: false, s2_3: false, s2_4: false, s3: true });
  function toggle(id) { setExpanded(e => ({ ...e, [id]: !e[id] })); }

  function renderNode(node, depth = 0) {
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selected === node.id;
    const isExpanded = expanded[node.id];
    return (
      <div key={node.id}>
        <div
          onClick={() => { hasChildren ? toggle(node.id) : onSelect(node.id); if (!hasChildren) onSelect(node.id); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: `7px ${12 + depth * 12}px`,
            cursor: "pointer", borderRadius: 5,
            background: isSelected ? "#0b3d9118" : "transparent",
            borderLeft: isSelected ? "3px solid #0b3d91" : "3px solid transparent",
            color: isSelected ? "#0b3d91" : depth === 0 ? "#111827" : "#374151",
            fontWeight: isSelected ? 700 : depth === 0 ? 600 : 400,
            fontSize: depth === 0 ? 13 : 12,
            transition: "all 0.12s", marginBottom: 1,
          }}
          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#f3f4f6"; }}
          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
        >
          {node.icon && <span style={{ fontSize: 14 }}>{node.icon}</span>}
          {hasChildren && (
            <span style={{ fontSize: 10, color: "#9ca3af", marginRight: 2, transition: "transform 0.15s", display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
          )}
          <span style={{ flex: 1, lineHeight: 1.4 }}>{node.label}</span>
        </div>
        {hasChildren && isExpanded && <div>{node.children.map(child => renderNode(child, depth + 1))}</div>}
      </div>
    );
  }

  return (
    <div style={{ width: 260, flexShrink: 0, background: "#f8fafc", borderRight: "1px solid #e5e7eb", overflowY: "auto", padding: "12px 8px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 12px 10px" }}>Model Documents</div>
      {SECTION_TREE.map(node => renderNode(node, 0))}
    </div>
  );
}

// ── PDF Preview Panel ──────────────────────────────────────────────────────
function PdfPreviewPanel({ pdfUrl, title = "Reference PDF", onClose }) {
  return (
    <div style={{
      width: 480, flexShrink: 0, display: "flex", flexDirection: "column",
      borderLeft: "1px solid #e5e7eb", background: "#f8fafc",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid #e5e7eb",
        background: "#fff", flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>📄 Reference PDF</span>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 12, color: "#6366f1", textDecoration: "none",
              padding: "4px 10px", borderRadius: 5, border: "1px solid #e0e7ff",
              background: "#eef2ff",
            }}
          >Open in new tab ↗</a>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#9ca3af", lineHeight: 1 }}>×</button>
        </div>
      </div>
      {pdfUrl && <iframe
        key={pdfUrl}
        src={pdfUrl}
        title={title}
        style={{ flex: 1, border: "none", width: "100%" }}
      />}
    </div>
  );
}

// ── Rules Page ─────────────────────────────────────────────────────────────
function RulesPage({ token, toast }) {
  const [rules, setRules] = useState([]);
  const [sectionRefs, setSectionRefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("all");
  const [modal, setModal] = useState(null); // "add" | "edit" | null
  const [form, setForm] = useState({ clause_ref: "", category: "safety", rule_text: "", is_active: true, section_ids: [] });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState({ q: "", category: "", status: "" });

  // PDF preview state: which rule's PDF is open in the side panel
  const [previewRuleId, setPreviewRuleId] = useState(null);
  const [previewSectionPdf, setPreviewSectionPdf] = useState(null);
  // PDF upload for modal (before saving rule, we store a pending file)
  const [pendingPdf, setPendingPdf] = useState(null); // File | null
  const pdfInputRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api("/rules", {}, token),
      api("/section-rules", {}, token),
    ])
      .then(([ruleData, sectionData]) => {
        setRules(ruleData);
        setSectionRefs(Object.fromEntries(sectionData.map(item => [item.section_id, item])));
        setLoading(false);
      })
      .catch(e => { toast(e.message, "error"); setLoading(false); });
  }, [token, toast]);

  useEffect(load, [load]);

  const visibleRules = useMemo(() => {
    let result = rules;
    if (activeSection !== "all") {
      result = result.filter(r => (r.section_ids || []).includes(activeSection));
    }
    if (filter.q) {
      const q = filter.q.toLowerCase();
      result = result.filter(r => r.rule_text?.toLowerCase().includes(q) || r.clause_ref?.toLowerCase().includes(q));
    }
    if (filter.category) result = result.filter(r => r.category === filter.category);
    if (filter.status === "active") result = result.filter(r => r.is_active);
    if (filter.status === "inactive") result = result.filter(r => !r.is_active);
    return result;
  }, [rules, activeSection, filter]);

  const activeSectionPdfs = activeSection === "all" ? [] : (sectionRefs[activeSection]?.pdfs || []);
  const previewUrl = previewSectionPdf
    ? `${API}/section-pdfs/${previewSectionPdf.id}`
    : previewRuleId
      ? `${API}/rules/${previewRuleId}/pdf`
      : null;
  const previewTitle = previewSectionPdf?.name || "Reference PDF";

  function getSectionLabel(id) {
    function find(nodes) {
      for (const n of nodes) {
        if (n.id === id) return n.label;
        if (n.children) { const f = find(n.children); if (f) return f; }
      }
      return null;
    }
    return find(SECTION_TREE) || "All Rules";
  }

  const allLeafIds = useMemo(() => getAllSectionIds(SECTION_TREE.slice(1)), []);

  // Save rule (create or update), then upload PDF if pending
  async function saveRule() {
    setSaving(true);
    try {
      const payload = {
        clause_ref: form.clause_ref || "Unreferenced",
        category: form.category,
        rule_text: form.rule_text,
        is_active: form.is_active !== false,
        section_ids: form.section_ids || [],
      };
      let savedRule;
      if (modal === "edit" && form.id) {
        savedRule = await api(`/rules/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) }, token);
        toast("Rule updated", "success");
      } else {
        savedRule = await api("/rules", { method: "POST", body: JSON.stringify(payload) }, token);
        toast("Rule created", "success");
      }
      // Upload PDF if one was selected
      if (pendingPdf && savedRule?.id) {
        const fd = new FormData();
        fd.append("file", pendingPdf);
        await fetch(`${API}/rules/${savedRule.id}/pdf`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        toast("PDF attached", "success");
      }
      setModal(null);
      setPendingPdf(null);
      load();
    } catch (e) { toast(e.message, "error"); }
    setSaving(false);
  }

  async function toggleActive(rule) {
    try {
      await api(`/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !rule.is_active }) }, token);
      toast(`Rule ${rule.is_active ? "deactivated" : "activated"}`, "success");
      load();
    } catch (e) { toast(e.message, "error"); }
  }

  async function deleteRule(id) {
    if (!window.confirm("Delete this rule? This cannot be undone.")) return;
    try {
      await api(`/rules/${id}`, { method: "DELETE" }, token);
      if (previewRuleId === id) setPreviewRuleId(null);
      toast("Rule deleted", "success"); load();
    } catch (e) { toast(e.message, "error"); }
  }

  async function removePdf(ruleId) {
    try {
      await fetch(`${API}/rules/${ruleId}/pdf`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (previewRuleId === ruleId) setPreviewRuleId(null);
      toast("PDF removed", "success"); load();
    } catch (e) { toast(e.message, "error"); }
  }

  // Upload PDF for an existing rule directly from the rule card
  async function uploadPdfForRule(ruleId, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API}/rules/${ruleId}/pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail); }
      toast("PDF attached", "success"); load();
    } catch (e) { toast(e.message, "error"); }
  }

  function openAdd() {
    setForm({ clause_ref: "", category: "safety", rule_text: "", is_active: true, section_ids: activeSection !== "all" ? [activeSection] : [] });
    setPendingPdf(null);
    setModal("add");
  }

  function toggleSectionId(id) {
    setForm(f => {
      const ids = f.section_ids || [];
      return { ...f, section_ids: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] };
    });
  }

  const CAT_COLOR_LOCAL = { safety: "#ef4444", calculation: "#f59e0b", completeness: "#0b3d91", design: "#6366f1" };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", overflow: "hidden", margin: "-32px", marginTop: 0 }}>
      {/* Left sidebar */}
      <SectionSidebar selected={activeSection} onSelect={id => { setActiveSection(id); setPreviewRuleId(null); setPreviewSectionPdf(null); }} />

      {/* Centre — rules list */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", background: "#fff", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, color: "#111827", fontWeight: 700 }}>{getSectionLabel(activeSection)}</h2>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#9ca3af" }}>{visibleRules.length} rule{visibleRules.length !== 1 ? "s" : ""}</p>
            </div>
            <Btn onClick={openAdd}>+ Add rule</Btn>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              placeholder="Search rules…"
              value={filter.q}
              onChange={e => setFilter({ ...filter, q: e.target.value })}
              style={{ flex: 1, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 4, padding: "7px 12px", fontSize: 13, color: "#111827", outline: "none" }}
            />
            <select value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 4, padding: "7px 10px", fontSize: 13, color: "#374151", outline: "none" }}>
              <option value="">All categories</option>
              <option value="safety">Safety</option>
              <option value="calculation">Calculation</option>
              <option value="completeness">Completeness</option>
              <option value="design">Design</option>
            </select>
            <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 4, padding: "7px 10px", fontSize: 13, color: "#374151", outline: "none" }}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {/* Rules list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {!loading && activeSectionPdfs.length > 0 && (
            <div style={{ marginBottom: 14, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", letterSpacing: "0.05em", textTransform: "uppercase" }}>Reference PDFs</div>
                <span style={{ fontSize: 11, color: "#9ca3af" }}>{activeSectionPdfs.length} file{activeSectionPdfs.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {activeSectionPdfs.map(pdf => {
                  const selected = previewSectionPdf?.id === pdf.id;
                  return (
                    <button
                      key={pdf.id}
                      type="button"
                      onClick={() => { setPreviewRuleId(null); setPreviewSectionPdf(selected ? null : pdf); }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 10, width: "100%", textAlign: "left", padding: "8px 10px",
                        borderRadius: 5, border: selected ? "1px solid #6366f1" : "1px solid #e5e7eb",
                        background: selected ? "#eef2ff" : "#f9fafb", cursor: "pointer",
                        color: "#374151", fontSize: 12, fontFamily: "inherit",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdf.name}</span>
                      <span style={{ color: selected ? "#6366f1" : "#64748b", fontWeight: 700 }}>{selected ? "Hide" : "View"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {loading ? <Spinner /> : visibleRules.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
              <p style={{ color: "#9ca3af", fontSize: 14 }}>No rules in this section yet.</p>
              <Btn onClick={openAdd} style={{ marginTop: 12 }}>+ Add first rule</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleRules.map(rule => {
                const isPreviewing = previewRuleId === rule.id;
                return (
                  <div key={rule.id} style={{
                    background: isPreviewing ? "#f0f4ff" : "#fff",
                    border: isPreviewing ? "1px solid #6366f1" : "1px solid #e5e7eb",
                    borderLeft: `3px solid ${CAT_COLOR_LOCAL[rule.category] || "#6b7280"}`,
                    borderRadius: 6, padding: "14px 18px",
                    opacity: rule.is_active ? 1 : 0.55,
                    display: "flex", gap: 14, alignItems: "flex-start",
                    transition: "all 0.15s",
                  }}>
                    <div style={{ flexShrink: 0, marginTop: 2 }}>
                      <code style={{ fontSize: 11, color: "#4b5563", background: "#f3f4f6", padding: "3px 8px", borderRadius: 3, border: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{rule.clause_ref}</code>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{rule.rule_text}</p>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <Badge label={rule.category} color={CAT_COLOR_LOCAL[rule.category] || "#6b7280"} />
                        {!rule.is_active && <Badge label="Inactive" color="#9ca3af" />}
                        {rule.has_pdf && (
                          <span style={{ fontSize: 10, color: "#6366f1", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 3, padding: "1px 6px" }}>📎 PDF</span>
                        )}
                        {(rule.section_ids || []).slice(0, 3).map(sid => {
                          const label = getSectionLabel(sid);
                          return label ? (
                            <span key={sid} style={{ fontSize: 10, color: "#6b7280", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 3, padding: "1px 6px" }}>{label.split("—")[0].trim()}</span>
                          ) : null;
                        })}
                        {(rule.section_ids || []).length > 3 && (
                          <span style={{ fontSize: 10, color: "#9ca3af" }}>+{rule.section_ids.length - 3} more</span>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {/* PDF button */}
                      {rule.has_pdf ? (
                        <>
                          <Btn
                            variant="ghost"
                            style={{ padding: "5px 10px", fontSize: 12, color: isPreviewing ? "#6366f1" : "#64748b", borderColor: isPreviewing ? "#6366f1" : "#334155" }}
                            onClick={() => { setPreviewSectionPdf(null); setPreviewRuleId(isPreviewing ? null : rule.id); }}
                          >{isPreviewing ? "Hide PDF" : "View PDF"}</Btn>
                          <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                            onClick={() => { if (window.confirm("Remove attached PDF?")) removePdf(rule.id); }}>✕ PDF</Btn>
                        </>
                      ) : (
                        <>
                          <input
                            type="file"
                            accept=".pdf"
                            style={{ display: "none" }}
                            id={`pdf-upload-${rule.id}`}
                            onChange={e => { if (e.target.files[0]) uploadPdfForRule(rule.id, e.target.files[0]); e.target.value = ""; }}
                          />
                          <label htmlFor={`pdf-upload-${rule.id}`}>
                            <span style={{
                              display: "inline-block", padding: "5px 10px", borderRadius: 8, fontSize: 12,
                              fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                              background: "transparent", color: "#94a3b8",
                              border: "1px solid #334155",
                            }}>📎 Attach PDF</span>
                          </label>
                        </>
                      )}
                      <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                        onClick={() => { setForm({ ...rule, section_ids: rule.section_ids || [] }); setPendingPdf(null); setModal("edit"); }}>Edit</Btn>
                      <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                        onClick={() => toggleActive(rule)}>{rule.is_active ? "Deactivate" : "Activate"}</Btn>
                      <Btn variant="danger" style={{ padding: "5px 10px", fontSize: 12 }}
                        onClick={() => deleteRule(rule.id)}>Delete</Btn>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right — PDF preview panel */}
      {previewUrl && (
        <PdfPreviewPanel
          pdfUrl={previewUrl}
          title={previewTitle}
          onClose={() => { setPreviewRuleId(null); setPreviewSectionPdf(null); }}
        />
      )}

      {/* Add/Edit modal */}
      {modal && (
        <Modal title={modal === "edit" ? "Edit rule" : "Add rule"} onClose={() => { setModal(null); setPendingPdf(null); }}>
          <Input label="Clause reference" type="text" value={form.clause_ref} onChange={e => setForm({ ...form, clause_ref: e.target.value })} placeholder="e.g. IS:456 Cl.5.1 or Sec 6.3.1" />
          <Input label="Category" type="select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            <option value="safety">Safety</option>
            <option value="calculation">Calculation</option>
            <option value="completeness">Completeness</option>
            <option value="design">Design</option>
          </Input>
          <Input label="Rule text" type="textarea" value={form.rule_text} onChange={e => setForm({ ...form, rule_text: e.target.value })} placeholder="Enter the full compliance rule text…" />

          {/* Section assignment */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, color: "#4b5563", marginBottom: 8, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Applies to sections</label>
            <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 4, padding: 10, background: "#f9fafb" }}>
              {SECTION_TREE.slice(1).map(top => (
                <div key={top.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{top.label}</div>
                  {function renderCheckboxes(nodes) {
                    return nodes.map(n => {
                      if (n.children && n.children.length > 0) {
                        return (
                          <div key={n.id} style={{ marginLeft: 8, marginBottom: 4 }}>
                            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 3, fontWeight: 600 }}>{n.label}</div>
                            {renderCheckboxes(n.children)}
                          </div>
                        );
                      }
                      return (
                        <label key={n.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#374151", marginBottom: 3, marginLeft: n.id.split("_").length > 2 ? 16 : 8, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={(form.section_ids || []).includes(n.id)}
                            onChange={() => toggleSectionId(n.id)}
                            style={{ accentColor: "#0b3d91" }}
                          />
                          {n.label}
                        </label>
                      );
                    });
                  }(top.children || [])}
                </div>
              ))}
            </div>
            {(form.section_ids || []).length > 0 && (
              <p style={{ margin: "5px 0 0", fontSize: 11, color: "#6b7280" }}>{form.section_ids.length} section{form.section_ids.length !== 1 ? "s" : ""} selected</p>
            )}
          </div>

          {/* PDF attachment in modal */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, color: "#4b5563", marginBottom: 8, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Reference PDF</label>
            {modal === "edit" && form.has_pdf && !pendingPdf ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6 }}>
                <span style={{ fontSize: 13, color: "#166534" }}>📎 PDF already attached</span>
                <button
                  onClick={() => { if (window.confirm("Remove current PDF?")) { removePdf(form.id); setForm(f => ({ ...f, has_pdf: false })); } }}
                  style={{ marginLeft: "auto", background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                >Remove</button>
                <label htmlFor="modal-pdf-replace" style={{ fontSize: 12, color: "#6366f1", cursor: "pointer", fontWeight: 600 }}>Replace</label>
                <input id="modal-pdf-replace" type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) setPendingPdf(e.target.files[0]); }} />
              </div>
            ) : pendingPdf ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 6 }}>
                <span style={{ fontSize: 13, color: "#4338ca" }}>📄 {pendingPdf.name}</span>
                <button onClick={() => setPendingPdf(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            ) : (
              <label htmlFor="modal-pdf-upload" style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, padding: "10px 16px", cursor: "pointer",
                border: "1px dashed #334155", borderRadius: 8, color: "#94a3b8", fontSize: 13,
                background: "#1e293b",
              }}>
                <span>📎</span> Click to attach a reference PDF
                <input id="modal-pdf-upload" type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) setPendingPdf(e.target.files[0]); }} />
              </label>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => { setModal(null); setPendingPdf(null); }}>Cancel</Btn>
            <Btn onClick={saveRule} disabled={saving || !form.rule_text}>
              {saving ? "Saving…" : "Save rule"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────
function DocumentsPage({ token, toast }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api("/documents", {}, token).then(d => { setDocs(d); setLoading(false); });
  }, [token]);

  useEffect(load, [load]);

  async function changeStatus(id, status) {
    try {
      await api(`/documents/${id}/status?status=${status}`, { method: "PATCH" }, token);
      toast("Status updated", "success"); load();
    } catch (e) { toast(e.message, "error"); }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 24px", fontSize: 20, color: "#f1f5f9" }}>Documents</h2>
      {loading ? <Spinner /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e293b" }}>
                {["Filename", "Contractor", "Status", "Pages", "Version", "Uploaded", "Action"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => (
                <tr key={doc.id} style={{ borderBottom: "1px solid #0f172a" }}>
                  <td style={{ padding: "13px 14px", color: "#e2e8f0", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.filename}</td>
                  <td style={{ padding: "13px 14px", color: "#94a3b8" }}>{doc.metro_authority_name}</td>
                  <td style={{ padding: "13px 14px" }}><Badge label={doc.status.replace(/_/g, " ")} color={STATUS_COLOR[doc.status] || "#64748b"} /></td>
                  <td style={{ padding: "13px 14px", color: "#94a3b8" }}>{doc.page_count || "—"}</td>
                  <td style={{ padding: "13px 14px", color: "#94a3b8" }}>v{doc.version}</td>
                  <td style={{ padding: "13px 14px", color: "#64748b", whiteSpace: "nowrap" }}>{new Date(doc.uploaded_at).toLocaleDateString("en-IN")}</td>
                  <td style={{ padding: "13px 14px" }}>
                    <select defaultValue="" onChange={e => e.target.value && changeStatus(doc.id, e.target.value)} style={{
                      background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
                      padding: "5px 8px", color: "#f1f5f9", fontSize: 12, cursor: "pointer",
                    }}>
                      <option value="" disabled>Change…</option>
                      {["uploaded", "processing", "under_scrutiny", "needs_correction", "approved"].map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    if (!confirm("Delete this user?")) return;
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
            <option value="contractor">Metro contractor</option>
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
  { id: "documents", label: "Documents", icon: "⊞" },
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
        {page === "documents" && <DocumentsPage token={token} toast={showToast} />}
        {page === "users" && <UsersPage token={token} toast={showToast} />}
        {page === "audit" && <AuditPage token={token} />}
      </div>

      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

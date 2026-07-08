import React, { useState, useEffect } from "react";
import { api } from "./api.js";

// Legacy E2E Lineage — grouped table -> field -> lineage, with column-level
// DWH type/length/precision and a data-variance verdict. Backward navigation:
// pick a DWH field, trace SRC <- STG1 <- STG2 <- DWH, plus per-stage proof.

const STAGE_COLOR = { SRC: "#7c3aed", STG1: "#00a3a3", STG2: "#0091bf", DWH: "#0f4775" };

export default function LegacyLineage({ t }) {
  const [tables, setTables] = useState([]);
  const [open, setOpen] = useState({});         // table -> bool
  const [fieldsByTable, setFieldsByTable] = useState({});
  const [openField, setOpenField] = useState({}); // lineage_id -> bool
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => { api.legacyLineageTables().then((r) => setTables(r.tables || [])); }, []);

  const toggleTable = (name) => {
    const willOpen = !open[name];
    setOpen((o) => ({ ...o, [name]: willOpen }));
    if (willOpen && !fieldsByTable[name]) {
      api.legacyLineageFields(name).then((r) =>
        setFieldsByTable((m) => ({ ...m, [name]: r.fields || [] })));
    }
  };
  const toggleField = (id) => setOpenField((o) => ({ ...o, [id]: !o[id] }));
  const allTables = (v) => setOpen(Object.fromEntries(tables.map((x) => [x.table_name, v])));

  const varChip = (status, detail) => {
    const map = {
      clean: { bg: "#e3f7ec", c: "#159943", label: "CLEAN" },
      changed: { bg: "#fff0e6", c: "#a8560f", label: "CHANGED" },
      no_data: { bg: "#f0f0f2", c: "#888", label: "NO DATA" },
    };
    const s = map[status] || map.no_data;
    return <span title={detail} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px",
      borderRadius: 999, background: s.bg, color: s.c, whiteSpace: "nowrap" }}>{s.label}</span>;
  };
  const statusPill = (st) => {
    const na = (st || "").toLowerCase().startsWith("not applicable");
    const ud = (st || "").toLowerCase().includes("ud");
    const bg = na ? "#f0f0f2" : ud ? "#efe6fb" : "#e3f7ec";
    const c = na ? "#888" : ud ? "#7c3aed" : "#159943";
    return <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
      background: bg, color: c }}>{(st || "—").toUpperCase()}</span>;
  };

  const stageNode = (label, tbl, col, tp, skip) => (
    <div style={{ border: `1.5px ${skip ? "dashed" : "solid"} ${skip ? t.border : (label === "DWH" ? t.accent : t.border)}`,
      borderRadius: 8, padding: "8px 11px", minWidth: 130, background: "#fff", opacity: skip ? 0.45 : 1 }}>
      <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", padding: "2px 6px",
        borderRadius: 3, color: "#fff", background: STAGE_COLOR[label] }}>{label}</span>
      <div style={{ fontFamily: "monospace", fontSize: 12, color: t.navy, fontWeight: 600, marginTop: 3 }}>{col || "—"}</div>
      <div style={{ fontSize: 10, color: t.sub }}>{tbl || (skip ? "N/A" : "")}</div>
      {tp && <div style={{ fontSize: 9, color: t.textMuted, fontFamily: "monospace", marginTop: 2 }}>{tp}</div>}
    </div>
  );
  const arrow = (xf) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: t.textMuted, fontSize: 15 }}>{"\u2192"}</div>
      {xf && xf !== "1:1" && <div style={{ fontSize: 10, color: t.warning, fontFamily: "monospace", maxWidth: 100 }}>{xf}</div>}
    </div>
  );

  const tp = (ty, ln, pr) => [ty, ln, pr].filter((x) => x && x !== "").join("(") + ((ln || pr) ? ")" : "");

  const renderField = (f) => {
    const id = f.lineage_id;
    const na = (f.lineage_status || "").toLowerCase().startsWith("not applicable");
    const isUd = f.is_ud === "Y";
    return (
      <div key={id} style={{ borderBottom: `1px solid #eef1f1`, background: isUd ? "#faf7ff" : "#fff" }}>
        <div onClick={() => toggleField(id)} style={{ display: "grid",
          gridTemplateColumns: "16px 250px 120px 66px 66px 1fr 120px", alignItems: "center", gap: 10,
          padding: "9px 16px 9px 26px", cursor: "pointer" }}>
          <span style={{ color: t.textMuted, fontSize: 10 }}>{openField[id] ? "\u25BC" : "\u25B6"}</span>
          <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600,
            color: isUd ? "#7c3aed" : t.navy }}>{isUd ? "\u21B3 " : ""}{f.dwh_target_column}</span>
          <span style={{ fontSize: 11.5, color: t.sub, fontFamily: "monospace" }}>{f.dwh_type || "—"}</span>
          <span style={{ fontSize: 11.5, color: t.sub, fontFamily: "monospace" }}>{f.dwh_length || "—"}</span>
          <span style={{ fontSize: 11.5, color: t.sub, fontFamily: "monospace" }}>{f.dwh_precision || "—"}</span>
          <span style={{ fontSize: 11, color: t.textMuted, fontFamily: "monospace" }}>
            {na ? "STG2 Not Applicable" : `${f.src_source_table || "?"}.${f.src_source_column || "?"} \u2192 \u2026 \u2192 DWH`}</span>
          {varChip(f.variance_status, f.variance_detail)}
        </div>
        {openField[id] && (
          <div style={{ padding: "6px 16px 16px 46px", background: "#fbfdfe", borderTop: `1px dashed ${t.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: t.sub, margin: "12px 0 6px" }}>Backward lineage</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {stageNode("SRC", f.src_source_table, f.src_source_column, null, na || !f.src_source_column)}
              {arrow(f.src_to_stg1_transform)}
              {stageNode("STG1", f.stg1_source_table, f.stg1_source_column, tp(f.stg1_type, f.stg1_length, f.stg1_precision), na || !f.stg1_source_column)}
              {arrow(f.stg1_to_stg2_transform)}
              {stageNode("STG2", f.stg2_source_table, f.stg2_source_column, tp(f.stg2_type, f.stg2_length, f.stg2_precision), na)}
              {arrow(f.stg2_to_dwh_transform)}
              {stageNode("DWH", f.dwh_target_table, f.dwh_target_column, tp(f.dwh_type, f.dwh_length, f.dwh_precision), false)}
            </div>
            {na && f.lineage_status_detail && (
              <div style={{ fontSize: 12, color: "#a8560f", background: "#fff6f0", padding: "9px 12px", borderRadius: 6 }}>
                {"\u26A0"} {f.lineage_status_detail}</div>
            )}
            {(f.proof || []).length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: t.sub, margin: "14px 0 6px" }}>Data variance (proof) — by stage</div>
                <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", border: `1px solid ${t.border}`, borderRadius: 6, overflow: "hidden" }}>
                  <thead><tr>{["Stage", "Sample value", "UD"].map((h) => (
                    <th key={h} style={{ background: "#f7f4ee", textAlign: "left", padding: "7px 10px", fontSize: 9,
                      fontWeight: 700, textTransform: "uppercase", color: t.sub }}>{h}</th>))}</tr></thead>
                  <tbody>
                    {["SRC", "STG1", "STG2", "DWH"].map((stg) => {
                      const p = (f.proof || []).find((x) => x.stage === stg);
                      if (!p) return null;
                      return (
                        <tr key={stg}>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #f0eee8" }}>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                              color: "#fff", background: STAGE_COLOR[stg] }}>{stg}</span></td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #f0eee8", fontFamily: "monospace",
                            fontSize: 12, wordBreak: "break-all" }}>{p.field_value || "—"}</td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #f0eee8", fontSize: 11, color: t.textMuted }}>{p.is_ud === "Y" ? p.ud_key : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const matchTable = (name) => !q || name.toLowerCase().includes(q.toLowerCase());

  return (
    <div>
      <div style={{ fontSize: 12.5, color: t.sub, margin: "0 0 16px", maxWidth: 900, lineHeight: 1.5 }}>
        Back-track any DWH field to its legacy source through the staging chain (SRC {"\u2192"} STG1 {"\u2192"} STG2 {"\u2192"} DWH),
        grouped by table {"\u2192"} field {"\u2192"} lineage. Each field shows DWH type/length/precision and a data-variance
        verdict; expand for the full chain and per-stage proof. UD attributes from the JSON CLOB are broken out
        as their own fields, and the original CLOB is kept too.
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search table…"
          style={{ width: 260, height: 32, borderRadius: 8, border: `1px solid ${t.border}`, padding: "0 12px", fontSize: 13 }} />
        <button onClick={() => allTables(true)} style={btn(t)}>Expand all</button>
        <button onClick={() => allTables(false)} style={btn(t)}>Collapse all</button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: t.textMuted }}>{tables.length} tables</span>
      </div>

      {tables.filter((tb) => matchTable(tb.table_name)).map((tb) => (
        <div key={tb.table_name} style={{ background: t.panel, border: `1px solid ${t.border}`,
          borderRadius: 10, marginBottom: 14, overflow: "hidden" }}>
          <div onClick={() => toggleTable(tb.table_name)} style={{ display: "flex", alignItems: "center", gap: 10,
            padding: "12px 16px", cursor: "pointer", background: "#f0f4f8", borderBottom: open[tb.table_name] ? `1px solid ${t.border}` : "none" }}>
            <span style={{ color: t.accent, fontSize: 11, transform: open[tb.table_name] ? "rotate(90deg)" : "none", transition: "transform .15s" }}>{"\u25B6"}</span>
            <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: t.navy }}>{tb.table_name}</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: t.textMuted }}>
              {tb.field_count} fields · {tb.mapped} mapped{tb.not_applicable ? ` · ${tb.not_applicable} N/A` : ""}{tb.ud_count ? ` · ${tb.ud_count} UD` : ""}</span>
          </div>
          {open[tb.table_name] && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "16px 250px 120px 66px 66px 1fr 120px", gap: 10,
                padding: "6px 16px 6px 26px", background: "#f7f9fb", fontSize: 9, fontWeight: 700,
                textTransform: "uppercase", color: t.textMuted, letterSpacing: ".4px" }}>
                <span></span><span>Field</span><span>DWH Type</span><span>Length</span><span>Precision</span>
                <span>Lineage preview</span><span>Data variance</span>
              </div>
              {(fieldsByTable[tb.table_name] || []).map(renderField)}
              {!fieldsByTable[tb.table_name] && <div style={{ padding: 16, color: t.textMuted, fontSize: 12 }}>Loading…</div>}
            </div>
          )}
        </div>
      ))}
      {tables.length === 0 && (
        <div style={{ color: t.textMuted, fontSize: 13, padding: 20 }}>
          No legacy lineage loaded yet. Run <code>python -m ingestion.run legacy_lineage</code> after placing the workbook.
        </div>
      )}
    </div>
  );
}

function btn(t) {
  return { fontSize: 11, padding: "6px 11px", border: `1px solid ${t.border}`, borderRadius: 6,
    background: "#fff", cursor: "pointer", color: t.sub };
}

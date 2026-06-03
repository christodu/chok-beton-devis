import { useState, useCallback, useEffect } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { supabase } from "./supabase";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const UNITES = ["cml", "ml", "m²", "U", "Forfait", "Ens"];
const PROXY_URL = "";

const STATUTS = {
  brouillon: { label: "Brouillon", color: "#999",    bg: "#F5F5F5" },
  envoye:    { label: "Envoyé",    color: "#2980B9", bg: "#EBF5FB" },
  accepte:   { label: "Accepté",   color: "#27AE60", bg: "#EAFAF1" },
  refuse:    { label: "Refusé",    color: "#E74C3C", bg: "#FDEDEC" },
  expire:    { label: "Expiré",    color: "#E67E22", bg: "#FEF9E7" },
};

const TYPES_DOC = {
  devis:     { label: "Devis",     color: "#E8A838", prefix: "CDJ" },
  facture:   { label: "Facture",   color: "#8E44AD", prefix: "FAC" },
  situation: { label: "Situation", color: "#16A085", prefix: "SIT" },
};

const AVC_DEFAUT = `* Traçage précis des carottages\n* Fourniture de l'électricité 220 V mono 16 A à 20 m\n* Fourniture de l'eau avec un robinet à 20 m\n* Bennes à gravats\n* Toutes les protections collectives\n* Tous les travaux de maçonneries\n* Installation des moyens d'accès sur la terrasse`;

const SOCIETE = {
  nom: "CHOK'BÉTON", adresse: "1 Rue Hector Berlioz", cp_ville: "95210 Saint-Gratien",
  siret: "410 442 875 00036", rcs: "RCS Pontoise", tva_intra: "FR64410442875",
  tel: "01 34 50 93 56", mobile: "06 24 26 21 05",
  web: "www.chok-beton.fr", forme: "SA au capital de 645 027 €",
};
const LOGO_SRC = "/chok-beton-devis/logo.jpg";

// ─── UTILITAIRES ──────────────────────────────────────────────────────────────
function formatMontant(val) {
  if (!val && val !== 0) return "—";
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(val).replace(/\u202f/g, " ").replace(/\u00a0/g, " ");
}

function statutDoc(doc) {
  if (!doc) return "brouillon";
  if (doc.type_doc !== "devis") return doc.statut || "brouillon";
  if (doc.statut && doc.statut !== "brouillon") return doc.statut;
  const exp = new Date(doc.date);
  exp.setDate(exp.getDate() + parseInt(doc.validite || 30));
  if (new Date() > exp) return "expire";
  return doc.statut || "brouillon";
}

function joursRestants(doc) {
  const exp = new Date(doc.date);
  exp.setDate(exp.getDate() + parseInt(doc.validite || 30));
  return Math.ceil((exp - new Date()) / 86400000);
}

function calcTotaux(doc) {
  const ht = (doc.lignes || []).reduce((s, l) => s + (parseFloat(l.quantite || 0) * parseFloat(l.pu || 0)), 0);
  const tva = doc.sans_tva ? 0 : ht * ((doc.tva || 20) / 100);
  return { ht, tva, ttc: ht + tva };
}

// ─── NUMÉROTATION ─────────────────────────────────────────────────────────────
function genererNumero(type = "devis") {
  const annee = String(new Date().getFullYear()).slice(-2);
  const prefix = TYPES_DOC[type]?.prefix || "CDJ";
  const cle = `chok_cpt_${type}_${annee}`;
  const cleAnnee = `chok_annee_${type}`;
  const anneeStockee = localStorage.getItem(cleAnnee);
  let n = parseInt(localStorage.getItem(cle) || "0", 10);
  if (anneeStockee !== annee) { n = 0; localStorage.setItem(cleAnnee, annee); }
  n += 1;
  localStorage.setItem(cle, String(n));
  return `${prefix} ${annee}.${String(n).padStart(3, "0")}`;
}

// ─── NOUVEAU DOC ──────────────────────────────────────────────────────────────
function nouveauDoc(type = "devis", base = null) {
  const now = new Date().toISOString();
  return {
    id: Date.now(),
    type_doc: type,
    numero: genererNumero(type),
    date: now.split("T")[0],
    validite: 30,
    client: base?.client || "",
    chantier: base?.chantier || "",
    contact: base?.contact || "",
    email_client: base?.email_client || "",
    objet: base?.objet || "",
    lignes: base?.lignes ? base.lignes.map(l => ({ ...l, id: Date.now() + Math.random() })) : [],
    sans_tva: base?.sans_tva || false,
    tva: base?.tva || 20,
    statut: "brouillon",
    date_envoi: null,
    a_votre_charge: base?.a_votre_charge || AVC_DEFAUT,
    notes_bas: type === "facture" ? "Règlement à 45 jours fin de mois." : "Devis valable 30 jours. Paiement à 45 jours fin de mois.",
    devis_origine: base?.id || null,
    numero_situation: type === "situation" ? 1 : null,
  };
}

// ─── SUPABASE CRUD ────────────────────────────────────────────────────────────
async function fetchDocs() {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function upsertDoc(doc, userId) {
  const payload = {
    id: doc.id,
    user_id: userId,
    type_doc: doc.type_doc,
    numero: doc.numero,
    date: doc.date,
    validite: doc.validite,
    client: doc.client,
    chantier: doc.chantier,
    contact: doc.contact,
    email_client: doc.email_client || "",
    objet: doc.objet,
    lignes: doc.lignes,
    sans_tva: doc.sans_tva,
    tva: doc.tva,
    statut: doc.statut,
    date_envoi: doc.date_envoi || null,
    a_votre_charge: doc.a_votre_charge,
    notes_bas: doc.notes_bas,
    devis_origine: doc.devis_origine || null,
    numero_situation: doc.numero_situation || null,
  };
  const { error } = await supabase.from("documents").upsert(payload);
  if (error) throw error;
}

async function deleteDoc(id) {
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw error;
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const inp = { background: "#FFF", border: "1px solid #D0D0D0", borderRadius: 6, color: "#1A1A1A", padding: "7px 10px", fontSize: 13, width: "100%", outline: "none", fontFamily: "'Barlow', sans-serif" };
const sel = { ...inp, cursor: "pointer" };
const btn = (color = "#E8A838", outline = false) => ({
  background: outline ? "transparent" : color,
  border: `1.5px solid ${color}`,
  color: outline ? color : (color === "#E8A838" || color === "#999" || color === "#DDD") ? "#000" : "#FFF",
  borderRadius: 7, padding: "9px 18px", fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "'Barlow Condensed', sans-serif",
  letterSpacing: "0.05em", textTransform: "uppercase",
});
const lbl = { display: "block", fontSize: 11, color: "#777", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 };
const card = { background: "#FFF", border: "1px solid #E0E0E0", borderRadius: 10, padding: "20px 24px", marginBottom: 20 };

// ─── COMPOSANTS UI ────────────────────────────────────────────────────────────
function Badge({ statut }) {
  const s = STATUTS[statut] || STATUTS.brouillon;
  return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}40`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{s.label}</span>;
}

function BadgeType({ type }) {
  const t = TYPES_DOC[type] || TYPES_DOC.devis;
  return <span style={{ background: `${t.color}20`, color: t.color, border: `1px solid ${t.color}50`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{t.label}</span>;
}

function StatCard({ label, value, sub, color = "#E8A838" }) {
  return (
    <div style={{ background: "#FFF", border: "1px solid #E8E8E8", borderTop: `3px solid ${color}`, borderRadius: 10, padding: "16px 18px", flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Barlow Condensed', sans-serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#AAA", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function LigneDevis({ ligne, index, onUpdate, onDelete }) {
  const m = parseFloat(ligne.quantite || 0) * parseFloat(ligne.pu || 0);
  return (
    <div style={{ background: "#FFF", border: "1px solid #E8E8E8", borderLeft: "3px solid #E8A838", borderRadius: 8, padding: "10px 12px", marginBottom: 6, display: "grid", gridTemplateColumns: "3fr 100px 90px 90px 110px 32px", gap: 8, alignItems: "start" }}>
      <textarea placeholder="Désignation de la prestation..." value={ligne.designation} onChange={e => onUpdate(index, { designation: e.target.value })} rows={2} spellCheck lang="fr" style={{ ...inp, resize: "vertical", minHeight: 56, lineHeight: 1.5 }} />
      <select value={ligne.unite} onChange={e => onUpdate(index, { unite: e.target.value })} style={sel}>
        <option value="">Unité</option>
        {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
      <input type="number" placeholder="Qté" value={ligne.quantite} onChange={e => onUpdate(index, { quantite: e.target.value })} style={{ ...inp, textAlign: "right" }} />
      <input type="number" placeholder="PU HT" value={ligne.pu} onChange={e => onUpdate(index, { pu: e.target.value })} style={{ ...inp, textAlign: "right" }} />
      <div style={{ color: m > 0 ? "#E8A838" : "#CCC", fontSize: 13, fontWeight: 700, textAlign: "right", paddingTop: 8 }}>{m > 0 ? `${formatMontant(m)} €` : "—"}</div>
      <button onClick={() => onDelete(index)} style={{ background: "transparent", border: "1px solid #DDD", color: "#999", borderRadius: 4, width: 28, height: 28, cursor: "pointer", fontSize: 16, marginTop: 4 }}>×</button>
    </div>
  );
}

// ─── GÉNÉRATION PDF ───────────────────────────────────────────────────────────
async function genererPDF(doc, totaux) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, mL = 15, mR = 15;
  let y = 8;
  const gold = [232, 168, 56], noir = [26, 26, 26], gris = [120, 120, 120], grisC = [248, 248, 248];
  const typeDoc = TYPES_DOC[doc.type_doc] || TYPES_DOC.devis;

  pdf.setFillColor(...gold); pdf.rect(0, 0, W, 4, "F");

  try {
    const resp = await fetch(LOGO_SRC);
    const blob = await resp.blob();
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    pdf.addImage(b64, "JPEG", mL, y, 30, 19);
  } catch(e) {}

  pdf.setFontSize(8); pdf.setTextColor(...gris);
  pdf.text(`${SOCIETE.adresse}, ${SOCIETE.cp_ville}`, mL + 33, y + 5);
  pdf.text(`Tél. ${SOCIETE.tel}`, mL + 33, y + 9);
  pdf.text(SOCIETE.web, mL + 33, y + 13);

  pdf.setFontSize(26); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...noir);
  pdf.text(typeDoc.label.toUpperCase(), W - mR, y + 8, { align: "right" });
  pdf.setFontSize(13); pdf.setTextColor(...gold);
  pdf.text(doc.numero, W - mR, y + 15, { align: "right" });
  pdf.setFontSize(8); pdf.setTextColor(...gris); pdf.setFont("helvetica", "normal");
  pdf.text(`Émis le ${new Date(doc.date).toLocaleDateString("fr-FR")}`, W - mR, y + 20, { align: "right" });
  if (doc.type_doc === "devis") pdf.text(`Validité : ${doc.validite} jours`, W - mR, y + 24, { align: "right" });
  y += 30;

  pdf.setDrawColor(...gold); pdf.setLineWidth(0.5); pdf.line(mL, y, W - mR, y); y += 4;
  pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...noir);
  pdf.text("CHOK'BÉTON – Sciage & Découpe de Béton", W / 2, y, { align: "center" }); y += 4;
  pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...gris);
  pdf.text("Démolition au robot  ·  Renforcement de structure – métallique et carbone", W / 2, y, { align: "center" }); y += 7;

  const colW = (W - mL - mR - 4) / 2;
  pdf.setFillColor(...grisC); pdf.rect(mL, y, colW, 16, "F");
  pdf.setFillColor(...gold); pdf.rect(mL, y, 1.5, 16, "F");
  pdf.setFillColor(...grisC); pdf.rect(mL + colW + 4, y, colW, 16, "F");
  pdf.setFontSize(7); pdf.setTextColor(...gris); pdf.text("CLIENT", mL + 3, y + 4);
  pdf.setFontSize(9); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...noir);
  pdf.text(doc.client || "—", mL + 3, y + 9);
  if (doc.contact) { pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...gris); pdf.text(doc.contact, mL + 3, y + 13); }
  pdf.setFontSize(7); pdf.setTextColor(...gris); pdf.setFont("helvetica", "normal");
  pdf.text("CHANTIER", mL + colW + 6, y + 4);
  pdf.setFontSize(9); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...noir);
  pdf.text(pdf.splitTextToSize(doc.chantier || "—", colW - 4), mL + colW + 6, y + 9);
  y += 20;

  if (doc.objet) {
    pdf.setFillColor(255, 251, 242); pdf.setDrawColor(240, 216, 136);
    pdf.rect(mL, y, W - mL - mR, 8, "FD");
    pdf.setFillColor(...gold); pdf.rect(mL, y, 1.5, 8, "F");
    pdf.setFontSize(8); pdf.setFont("helvetica", "bold"); pdf.setTextColor(184, 134, 26);
    pdf.text("Objet : ", mL + 3, y + 5);
    pdf.setFont("helvetica", "normal"); pdf.setTextColor(51, 51, 51);
    pdf.text(doc.objet, mL + 16, y + 5);
    y += 11;
  }

  autoTable(pdf, {
    startY: y,
    head: [["Désignation", "Unité", "Quantité", "PU HT (€)", "Total HT (€)"]],
    body: (doc.lignes || []).map(l => {
      const m = parseFloat(l.quantite || 0) * parseFloat(l.pu || 0);
      return [l.designation || "—", l.unite || "—", l.quantite || "—", l.pu ? formatMontant(parseFloat(l.pu)) : "—", m > 0 ? formatMontant(m) : "—"];
    }),
    margin: { left: mL, right: mR },
    styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: [238, 238, 238], lineWidth: 0.2 },
    headStyles: { fillColor: noir, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 18, halign: "center" }, 2: { cellWidth: 22, halign: "right" }, 3: { cellWidth: 32, halign: "right" }, 4: { cellWidth: 34, halign: "right", fontStyle: "bold" } },
    alternateRowStyles: { fillColor: [247, 247, 247] }, theme: "grid",
  });
  y = (pdf.lastAutoTable?.finalY || y) + 5;

  if (doc.a_votre_charge && doc.type_doc === "devis") {
    pdf.setFillColor(255, 251, 242); pdf.setDrawColor(240, 216, 136);
    const lines = pdf.splitTextToSize(doc.a_votre_charge, W - mL - mR - 8);
    const h = lines.length * 4 + 8;
    pdf.rect(mL, y, W - mL - mR, h, "FD");
    pdf.setFillColor(...gold); pdf.rect(mL, y, 1.5, h, "F");
    pdf.setFontSize(7); pdf.setFont("helvetica", "bold"); pdf.setTextColor(184, 134, 26);
    pdf.text("À VOTRE CHARGE", mL + 3, y + 4);
    pdf.setFont("helvetica", "normal"); pdf.setTextColor(85, 85, 85); pdf.setFontSize(8);
    pdf.text(lines, mL + 3, y + 8);
    y += h + 4;
  }

  const totW = 75, totX = W - mR - totW;
  pdf.setFontSize(9); pdf.setFont("helvetica", "normal"); pdf.setDrawColor(232, 232, 232); pdf.setLineWidth(0.2);
  pdf.line(totX, y, W - mR, y); pdf.setTextColor(...gris); pdf.text("Total HT", totX + 2, y + 4);
  pdf.setTextColor(...noir); pdf.text(`${formatMontant(totaux.ht)} €`, W - mR - 2, y + 4, { align: "right" }); y += 6;
  if (!doc.sans_tva) {
    pdf.line(totX, y, W - mR, y); pdf.setTextColor(...gris); pdf.text(`TVA ${doc.tva}%`, totX + 2, y + 4);
    pdf.setTextColor(...noir); pdf.text(`${formatMontant(totaux.tva)} €`, W - mR - 2, y + 4, { align: "right" }); y += 6;
  }
  pdf.setFillColor(...noir); pdf.rect(totX, y, totW, 8, "F");
  pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...gold);
  pdf.text(doc.sans_tva ? "TOTAL HT" : "TOTAL TTC", totX + 3, y + 5.5);
  pdf.text(`${formatMontant(doc.sans_tva ? totaux.ht : totaux.ttc)} €`, W - mR - 2, y + 5.5, { align: "right" }); y += 12;

  if (doc.notes_bas) {
    pdf.setFillColor(...grisC);
    const cl = pdf.splitTextToSize(doc.notes_bas, W - mL - mR - 6);
    const ch = cl.length * 4 + 8;
    pdf.rect(mL, y, W - mL - mR, ch, "F");
    pdf.setFontSize(7); pdf.setFont("helvetica", "bold"); pdf.setTextColor(68, 68, 68);
    pdf.text("CONDITIONS", mL + 3, y + 4);
    pdf.setFont("helvetica", "normal"); pdf.setTextColor(...gris);
    pdf.text(cl, mL + 3, y + 8); y += ch + 5;
  }

  const sigW = (W - mL - mR - 8) / 2;
  pdf.setDrawColor(220, 220, 220); pdf.setLineWidth(0.3);
  pdf.rect(mL, y, sigW, 22); pdf.rect(mL + sigW + 8, y, sigW, 22);
  pdf.setFontSize(7); pdf.setFont("helvetica", "bold"); pdf.setTextColor(100, 100, 100);
  pdf.text(doc.type_doc === "devis" ? "BON POUR ACCORD — SIGNATURE CLIENT" : "SIGNATURE CLIENT", mL + 2, y + 4);
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(...gris); pdf.text("Date :", mL + 2, y + 8);
  pdf.setFont("helvetica", "bold"); pdf.setTextColor(100, 100, 100);
  pdf.text("CHOK'BÉTON — Christopher Dupré", mL + sigW + 10, y + 4);
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(...gris);
  pdf.text("christopher@chok-beton.fr  ·  06 24 26 21 05", mL + sigW + 10, y + 8);

  const pH = pdf.internal.pageSize.height;
  pdf.setDrawColor(238, 238, 238); pdf.setLineWidth(0.2); pdf.line(mL, pH - 12, W - mR, pH - 12);
  pdf.setFontSize(6.5); pdf.setFont("helvetica", "normal"); pdf.setTextColor(180, 180, 180);
  pdf.text(`${SOCIETE.nom} · ${SOCIETE.forme} · ${SOCIETE.rcs}`, mL, pH - 8);
  pdf.text(`SIRET ${SOCIETE.siret} · TVA ${SOCIETE.tva_intra}`, W - mR, pH - 8, { align: "right" });
  pdf.setFillColor(...gold); pdf.rect(0, pH - 3, W, 3, "F");
  return pdf;
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [step, setStep] = useState("dashboard");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState("");
  const [doc, setDoc] = useState(null);
  const [liste, setListe] = useState([]);
  const [listeLoading, setListeLoading] = useState(false);
  const [confirmSuppr, setConfirmSuppr] = useState(null);
  const [confirmConvert, setConfirmConvert] = useState(null);
  const [filtreStatut, setFiltreStatut] = useState("tous");
  const [filtreType, setFiltreType] = useState("tous");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Charger docs quand connecté
  useEffect(() => {
    if (session) loadDocs();
  }, [session]);

  const loadDocs = async () => {
    setListeLoading(true);
    try {
      const data = await fetchDocs();
      setListe(data);
    } catch(e) {
      showToast("❌ Erreur chargement : " + e.message);
    }
    setListeLoading(false);
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const login = async () => {
    setAuthBusy(true); setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message === "Invalid login credentials" ? "Email ou mot de passe incorrect" : error.message);
    setAuthBusy(false);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setListe([]); setDoc(null); setStep("dashboard");
  };

  const totaux = doc ? calcTotaux(doc) : { ht: 0, tva: 0, ttc: 0 };

  const updateLigne = useCallback((i, p) => setDoc(d => { const l = [...d.lignes]; l[i] = { ...l[i], ...p }; return { ...d, lignes: l }; }), []);
  const deleteLigne = useCallback((i) => setDoc(d => ({ ...d, lignes: d.lignes.filter((_, j) => j !== i) })), []);
  const addLigne = () => setDoc(d => ({ ...d, lignes: [...d.lignes, { id: Date.now(), designation: "", unite: "", quantite: "", pu: "" }] }));

  const creerDoc = (type = "devis") => { setDoc(nouveauDoc(type)); setNote(""); setStep("note"); };
  const ouvrirDoc = (d) => { setDoc(d); setStep("formulaire"); };

  const sauvegarder = async (silent = false) => {
    if (!doc || !session) return;
    setSaving(true);
    try {
      await upsertDoc(doc, session.user.id);
      await loadDocs();
      if (!silent) showToast(`✅ ${TYPES_DOC[doc.type_doc]?.label} ${doc.numero} sauvegardé`);
    } catch(e) {
      showToast("❌ Erreur sauvegarde : " + e.message);
    }
    setSaving(false);
  };

  const changerStatut = async (id, statut) => {
    const d = liste.find(d => d.id === id);
    if (!d || !session) return;
    const updated = { ...d, statut, date_envoi: statut === "envoye" ? new Date().toISOString().split("T")[0] : d.date_envoi };
    try {
      await upsertDoc(updated, session.user.id);
      await loadDocs();
      if (doc?.id === id) setDoc(updated);
    } catch(e) { showToast("❌ " + e.message); }
  };

  const convertirEn = async (type) => {
    if (!doc || !session) return;
    const situations = liste.filter(d => d.devis_origine === doc.id && d.type_doc === "situation");
    const newDoc = nouveauDoc(type, doc);
    if (type === "situation") newDoc.numero_situation = situations.length + 1;
    await changerStatut(doc.id, "accepte");
    try {
      await upsertDoc(newDoc, session.user.id);
      await loadDocs();
      setDoc(newDoc);
      setConfirmConvert(null);
      setStep("formulaire");
      showToast(`✅ Converti en ${TYPES_DOC[type].label} — ${newDoc.numero}`);
    } catch(e) { showToast("❌ " + e.message); }
  };

  const supprimer = async (id) => {
    try {
      await deleteDoc(id);
      await loadDocs();
      setConfirmSuppr(null);
      showToast("🗑 Document supprimé");
    } catch(e) { showToast("❌ " + e.message); }
  };

  const nomFichier = () => {
    if (!doc) return "document";
    const num = doc.numero.replace(/CDJ |FAC |SIT /, "");
    const cli = (doc.client || "Client").trim().toUpperCase();
    const chan = (doc.chantier || "").trim();
    return [num, cli, chan].filter(Boolean).join(" ").replace(/[/\\:*?"<>|]/g, "-");
  };

  const envoyerMail = () => {
    if (!doc) return;
    const t = calcTotaux(doc);
    const sujet = encodeURIComponent(`${TYPES_DOC[doc.type_doc]?.label} ${doc.numero} – CHOK'BÉTON`);
    const corps = encodeURIComponent(`Bonjour${doc.contact ? ` ${doc.contact}` : ""},\n\nVeuillez trouver ci-joint notre ${TYPES_DOC[doc.type_doc]?.label?.toLowerCase()} ${doc.numero}${doc.objet ? ` concernant : ${doc.objet}` : ""}.\nChantier : ${doc.chantier || "—"}\n\nMontant ${doc.sans_tva ? "HT" : "TTC"} : ${formatMontant(doc.sans_tva ? t.ht : t.ttc)} €\n\nCordialement,\nChristopher Dupré\nCHOK'BÉTON – Tél. ${SOCIETE.tel} – ${SOCIETE.mobile}\nchristopher@chok-beton.fr`);
    window.location.href = `mailto:${doc.email_client || ""}?subject=${sujet}&body=${corps}`;
    if (doc.type_doc === "devis") changerStatut(doc.id, "envoye");
    showToast("📧 Mail ouvert — pensez à joindre le PDF !");
  };

  const exporterPDF = async () => {
    if (!doc) return;
    const pdf = await genererPDF(doc, totaux);
    pdf.save(`${nomFichier()}.pdf`);
  };

  const exporterXLSX = () => {
    if (!doc) return;
    const wb = XLSX.utils.book_new();
    const rows = [
      ["Désignation", "Unité", "Quantité", "PU HT (€)", "Total HT (€)"],
      ...(doc.lignes || []).map(l => [l.designation, l.unite, parseFloat(l.quantite) || "", parseFloat(l.pu) || "", parseFloat(l.quantite || 0) * parseFloat(l.pu || 0) || ""]),
      [], ["", "", "", "Total HT", totaux.ht],
      ["", "", "", `TVA ${doc.tva}%`, totaux.tva],
      ["", "", "", "TOTAL TTC", totaux.ttc],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 50 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, TYPES_DOC[doc.type_doc]?.label || "Document");
    XLSX.writeFile(wb, `${nomFichier()}.xlsx`);
  };

  // Stats
  const devisList = liste.filter(d => d.type_doc === "devis");
  const facturesList = liste.filter(d => d.type_doc === "facture");
  const situationsList = liste.filter(d => d.type_doc === "situation");
  const devisAcceptes = devisList.filter(d => d.statut === "accepte");
  const devisRefuses = devisList.filter(d => d.statut === "refuse");
  const devisEnvoyes = devisList.filter(d => d.statut === "envoye");
  const tauxAcceptation = (devisAcceptes.length + devisRefuses.length) > 0 ? Math.round(devisAcceptes.length / (devisAcceptes.length + devisRefuses.length) * 100) : null;
  const caDevis = devisAcceptes.reduce((s, d) => s + calcTotaux(d).ttc, 0);
  const caFactures = facturesList.reduce((s, d) => s + calcTotaux(d).ttc, 0);
  const alertes = liste.filter(d => { const s = statutDoc(d); const j = joursRestants(d); return d.type_doc === "devis" && ((s === "envoye" && j <= 7) || s === "expire"); });
  const listeFiltree = liste.filter(d => {
    const matchType = filtreType === "tous" || d.type_doc === filtreType;
    const matchStatut = filtreStatut === "tous" || statutDoc(d) === filtreStatut;
    return matchType && matchStatut;
  });

  // ── ÉCRAN DE CONNEXION ───────────────────────────────────────────────────
  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#F4F4F4", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#E8A838", fontSize: 16, fontFamily: "'Barlow', sans-serif" }}>Chargement...</div>
    </div>
  );

  if (!session) return (
    <div style={{ minHeight: "100vh", background: "#F4F4F4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet" />
      <div style={{ background: "#FFF", borderRadius: 16, padding: "40px 44px", width: 380, boxShadow: "0 8px 40px rgba(0,0,0,0.1)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img src={LOGO_SRC} alt="CHOK'BÉTON" style={{ height: 60, objectFit: "contain", marginBottom: 12 }} />
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 800, color: "#E8A838" }}>CHOK'BÉTON</div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>Gestion commerciale</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} placeholder="votre@email.fr" onKeyDown={e => e.key === "Enter" && login()} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Mot de passe</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inp} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && login()} />
        </div>
        {authError && <div style={{ background: "#FFF0F0", border: "1px solid #E07070", borderRadius: 6, padding: "8px 12px", marginBottom: 16, color: "#C0392B", fontSize: 13 }}>⚠️ {authError}</div>}
        <button onClick={login} disabled={authBusy || !email || !password} style={{ ...btn("#E8A838"), width: "100%", padding: "12px", fontSize: 14, opacity: authBusy ? 0.7 : 1 }}>
          {authBusy ? "Connexion..." : "Se connecter"}
        </button>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "#AAA" }}>
          Accès réservé aux directeurs CHOK'BÉTON
        </div>
      </div>
    </div>
  );

  // ── APP PRINCIPALE ────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#F4F4F4", fontFamily: "'Barlow', 'Helvetica Neue', sans-serif", color: "#1A1A1A" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@500;700;800&display=swap" rel="stylesheet" />

      {toast && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1A1A1A", color: "#FFF", padding: "12px 24px", borderRadius: 30, fontSize: 13, fontWeight: 600, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", whiteSpace: "nowrap" }}>{toast}</div>}

      {/* HEADER */}
      <div style={{ background: "#FFF", borderBottom: "1px solid #E0E0E0", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setStep("dashboard")}>
          <img src={LOGO_SRC} alt="CHOK'BÉTON" style={{ height: 36, objectFit: "contain" }} />
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, color: "#E8A838" }}>CHOK'BÉTON</div>
            <div style={{ fontSize: 9, color: "#999", letterSpacing: "0.1em", textTransform: "uppercase" }}>Gestion commerciale</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {alertes.length > 0 && <span style={{ background: "#E74C3C", color: "#FFF", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>⚠️ {alertes.length}</span>}
          {["dashboard", "liste"].map(s => (
            <button key={s} onClick={() => setStep(s)} style={{ ...btn(step === s ? "#E8A838" : "#DDD", step !== s), padding: "5px 12px", fontSize: 11, color: step === s ? "#000" : "#666" }}>
              {s === "dashboard" ? "📊 Dashboard" : "📋 Documents"}
            </button>
          ))}
          {(step === "formulaire" || step === "apercu") && (
            <>
              <button onClick={() => sauvegarder()} disabled={saving} style={{ ...btn("#27AE60"), padding: "5px 12px", fontSize: 11, opacity: saving ? 0.7 : 1 }}>
                {saving ? "⏳" : "💾"} Sauvegarder
              </button>
              {step === "formulaire" && <button onClick={() => setStep("apercu")} style={{ ...btn("#E8A838"), padding: "5px 12px", fontSize: 11 }}>👁 Aperçu</button>}
            </>
          )}
          <div style={{ fontSize: 11, color: "#999", marginLeft: 8 }}>{session.user.email}</div>
          <button onClick={logout} style={{ ...btn("#999", true), padding: "5px 10px", fontSize: 11 }}>Déco.</button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>

        {/* ── DASHBOARD ── */}
        {step === "dashboard" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 800, margin: 0 }}>Tableau de bord</h1>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => creerDoc("devis")} style={{ ...btn("#E8A838"), padding: "7px 14px", fontSize: 12 }}>+ Devis</button>
                <button onClick={() => creerDoc("facture")} style={{ ...btn("#8E44AD"), padding: "7px 14px", fontSize: 12 }}>+ Facture</button>
                <button onClick={() => creerDoc("situation")} style={{ ...btn("#16A085"), padding: "7px 14px", fontSize: 12 }}>+ Situation</button>
              </div>
            </div>

            {alertes.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                {alertes.map(d => {
                  const j = joursRestants(d);
                  return (
                    <div key={d.id} style={{ background: j < 0 ? "#FDEDEC" : "#FEF9E7", border: `1px solid ${j < 0 ? "#E74C3C" : "#E67E22"}`, borderRadius: 8, padding: "10px 16px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: j < 0 ? "#E74C3C" : "#E67E22", fontWeight: 600 }}>
                        {j < 0 ? `⚠️ ${d.numero} – ${d.client} – Expiré depuis ${Math.abs(j)} jour(s)` : `⏰ ${d.numero} – ${d.client} – Expire dans ${j} jour(s)`}
                      </span>
                      <button onClick={() => ouvrirDoc(d)} style={{ ...btn("#E8A838"), padding: "4px 12px", fontSize: 11 }}>Ouvrir</button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="CA Devis acceptés" value={`${formatMontant(caDevis)} €`} sub={`${devisAcceptes.length} devis`} color="#27AE60" />
              <StatCard label="CA Facturé" value={`${formatMontant(caFactures)} €`} sub={`${facturesList.length} facture(s)`} color="#8E44AD" />
              <StatCard label="Taux acceptation" value={tauxAcceptation !== null ? `${tauxAcceptation}%` : "—"} sub={`${devisAcceptes.length} acc. / ${devisRefuses.length} ref.`} color="#E8A838" />
              <StatCard label="En attente" value={devisEnvoyes.length} sub="devis envoyés" color="#2980B9" />
              <StatCard label="Situations" value={situationsList.length} sub="en cours" color="#16A085" />
            </div>

            <div style={card}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Derniers documents</div>
              {listeLoading ? (
                <div style={{ color: "#AAA", textAlign: "center", padding: "20px" }}>Chargement...</div>
              ) : liste.length === 0 ? (
                <div style={{ color: "#AAA", textAlign: "center", padding: "24px 0" }}>Aucun document — créez votre premier devis</div>
              ) : liste.slice(0, 8).map(d => {
                const t = calcTotaux(d);
                const s = statutDoc(d);
                return (
                  <div key={d.id} onClick={() => ouvrirDoc(d)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #F0F0F0", cursor: "pointer" }}>
                    <BadgeType type={d.type_doc} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#E8A838", fontFamily: "'Barlow Condensed', sans-serif" }}>{d.numero}</span>
                        <Badge statut={s} />
                      </div>
                      <div style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.client || "—"} — {d.chantier || "—"}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{formatMontant(d.sans_tva ? t.ht : t.ttc)} €</div>
                      <div style={{ fontSize: 10, color: "#AAA" }}>{new Date(d.date).toLocaleDateString("fr-FR")}</div>
                    </div>
                  </div>
                );
              })}
              {liste.length > 8 && <button onClick={() => setStep("liste")} style={{ ...btn("#999", true), width: "100%", marginTop: 12, padding: "7px" }}>Voir tous les documents ({liste.length})</button>}
            </div>
          </div>
        )}

        {/* ── LISTE ── */}
        {step === "liste" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 800, margin: 0 }}>Documents ({liste.length})</h1>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => creerDoc("devis")} style={{ ...btn("#E8A838"), padding: "7px 14px", fontSize: 12 }}>+ Devis</button>
                <button onClick={() => creerDoc("facture")} style={{ ...btn("#8E44AD"), padding: "7px 14px", fontSize: 12 }}>+ Facture</button>
                <button onClick={() => creerDoc("situation")} style={{ ...btn("#16A085"), padding: "7px 14px", fontSize: 12 }}>+ Situation</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {[["tous","Tous"], ["devis","Devis"], ["facture","Factures"], ["situation","Situations"]].map(([k, l]) => (
                <button key={k} onClick={() => setFiltreType(k)} style={{ ...btn(filtreType === k ? "#E8A838" : "#DDD", filtreType !== k), padding: "5px 12px", fontSize: 11, color: filtreType === k ? "#000" : "#666" }}>{l}</button>
              ))}
              <span style={{ margin: "0 4px", color: "#CCC", alignSelf: "center" }}>|</span>
              {[["tous","Tous"], ...Object.entries(STATUTS).map(([k, v]) => [k, v.label])].map(([k, l]) => (
                <button key={k} onClick={() => setFiltreStatut(k)} style={{ ...btn(filtreStatut === k ? "#1A1A1A" : "#DDD", filtreStatut !== k), padding: "5px 12px", fontSize: 11, color: filtreStatut === k ? "#FFF" : "#666" }}>{l}</button>
              ))}
            </div>

            {listeLoading ? (
              <div style={{ color: "#AAA", textAlign: "center", padding: "40px" }}>Chargement...</div>
            ) : listeFiltree.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px", color: "#AAA", border: "1px dashed #DDD", borderRadius: 12 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>Aucun document
              </div>
            ) : listeFiltree.map(d => {
              const t = calcTotaux(d);
              const s = statutDoc(d);
              const j = joursRestants(d);
              return (
                <div key={d.id} style={{ background: "#FFF", border: "1px solid #E8E8E8", borderLeft: `4px solid ${TYPES_DOC[d.type_doc]?.color || "#E8A838"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <BadgeType type={d.type_doc} />
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 800, color: "#E8A838" }}>{d.numero}</span>
                      <Badge statut={s} />
                      {d.type_doc === "devis" && s === "envoye" && j >= 0 && j <= 7 && <span style={{ fontSize: 10, color: "#E67E22", fontWeight: 600 }}>⏰ {j}j</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{d.client || "—"}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{d.chantier} · {new Date(d.date).toLocaleDateString("fr-FR")}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{formatMontant(d.sans_tva ? t.ht : t.ttc)} €</div>
                    <div style={{ fontSize: 10, color: "#AAA" }}>{d.sans_tva ? "HT" : "TTC"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap" }}>
                    {d.type_doc === "devis" && s === "brouillon" && <button onClick={() => changerStatut(d.id, "envoye")} style={{ ...btn("#2980B9"), padding: "4px 10px", fontSize: 10 }}>📤</button>}
                    {d.type_doc === "devis" && s === "envoye" && <button onClick={() => changerStatut(d.id, "accepte")} style={{ ...btn("#27AE60"), padding: "4px 10px", fontSize: 10 }}>✅</button>}
                    {d.type_doc === "devis" && s === "envoye" && <button onClick={() => changerStatut(d.id, "refuse")} style={{ ...btn("#E74C3C"), padding: "4px 10px", fontSize: 10 }}>❌</button>}
                    <button onClick={() => ouvrirDoc(d)} style={{ ...btn("#E8A838"), padding: "4px 10px", fontSize: 10 }}>✏️ Modifier</button>
                    <button onClick={() => setConfirmSuppr(d.id)} style={{ ...btn("#E74C3C", true), padding: "4px 8px", fontSize: 10 }}>🗑</button>
                  </div>
                </div>
              );
            })}

            {confirmSuppr && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
                <div style={{ background: "#FFF", borderRadius: 12, padding: "28px", maxWidth: 360, width: "90%", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Supprimer ce document ?</div>
                  <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>Action irréversible.</div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button onClick={() => setConfirmSuppr(null)} style={{ ...btn("#999", true), padding: "7px 18px" }}>Annuler</button>
                    <button onClick={() => supprimer(confirmSuppr)} style={{ ...btn("#E74C3C"), padding: "7px 18px" }}>Supprimer</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── NOTE IA ── */}
        {step === "note" && doc && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <BadgeType type={doc.type_doc} />
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 800, color: "#E8A838" }}>{doc.numero}</div>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div onClick={() => setStep("formulaire")} style={{ ...card, flex: 1, cursor: "pointer", textAlign: "center", padding: "24px" }}>
                <div style={{ fontSize: 28 }}>📝</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 700, color: "#555", marginTop: 8 }}>SAISIE DIRECTE</div>
                <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>Formulaire ligne par ligne</div>
              </div>
              <div style={{ ...card, flex: 2, borderColor: "#E8A838" }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 700, color: "#E8A838", marginBottom: 10 }}>🤖 INTERPRÉTATION IA</div>
                {!PROXY_URL && <div style={{ background: "#FFF8E1", border: "1px solid #F9A825", borderRadius: 6, padding: "7px 12px", marginBottom: 10, fontSize: 11, color: "#856404" }}>⚠️ Proxy IA non encore configuré — utilisez la saisie directe</div>}
                <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Décris les travaux librement..." spellCheck lang="fr" style={{ ...inp, minHeight: 120, resize: "vertical", lineHeight: 1.7 }} />
                {erreur && <div style={{ background: "#FFF0F0", border: "1px solid #E07070", borderRadius: 6, padding: "7px 12px", margin: "8px 0", color: "#C0392B", fontSize: 12 }}>⚠️ {erreur}</div>}
                <button onClick={async () => {
                  if (!note.trim() || !PROXY_URL) return;
                  setLoading(true); setErreur("");
                  try {
                    const r = await fetch(PROXY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: "Extrais les lignes de devis en JSON: {\"lignes\":[{\"designation\":\"...\",\"unite\":\"cml|ml|m²|U|Forfait|Ens\",\"quantite\":10}],\"client_detecte\":\"...\",\"chantier_detecte\":\"...\"}", messages: [{ role: "user", content: note }] }) });
                    const data = await r.json();
                    const text = data.content?.map(b => b.text || "").join("") || "{}";
                    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
                    const lignesIA = (result.lignes || []).map((l, i) => ({ id: Date.now() + i, designation: l.designation || "", unite: l.unite || "", quantite: l.quantite ? String(l.quantite) : "", pu: "" }));
                    setDoc(d => ({ ...d, lignes: lignesIA, client: result.client_detecte || d.client, chantier: result.chantier_detecte || d.chantier }));
                    setStep("formulaire");
                  } catch(e) { setErreur("Erreur : " + e.message); }
                  setLoading(false);
                }} disabled={loading || !note.trim() || !PROXY_URL} style={{ ...btn(PROXY_URL ? "#E8A838" : "#CCC"), marginTop: 10, opacity: !PROXY_URL ? 0.5 : 1 }}>
                  {loading ? "⏳ Analyse..." : "🤖 Interpréter"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── FORMULAIRE ── */}
        {step === "formulaire" && doc && doc.type_doc && (
          <div>
            <div style={{ ...card, padding: "12px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <BadgeType type={doc.type_doc} />
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 800, color: "#E8A838" }}>{doc.numero}</span>
                {doc.type_doc === "devis" && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {Object.entries(STATUTS).map(([k, v]) => (
                      <button key={k} onClick={() => setDoc(d => ({ ...d, statut: k }))}
                        style={{ ...btn(v.color, (doc.statut || "brouillon") !== k), padding: "3px 10px", fontSize: 10 }}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
                {doc.type_doc === "devis" && (
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button onClick={() => setConfirmConvert("facture")} style={{ ...btn("#8E44AD"), padding: "4px 12px", fontSize: 11 }}>→ Facture</button>
                    <button onClick={() => setConfirmConvert("situation")} style={{ ...btn("#16A085"), padding: "4px 12px", fontSize: 11 }}>→ Situation</button>
                  </div>
                )}
                {doc.type_doc === "situation" && doc.numero_situation && (
                  <span style={{ fontSize: 12, color: "#16A085", fontWeight: 600 }}>Situation n°{doc.numero_situation}</span>
                )}
              </div>
            </div>

            <div style={{ ...card, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <div><label style={lbl}>N° Document</label><input value={doc.numero} onChange={e => setDoc(d => ({ ...d, numero: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Date</label><input type="date" value={doc.date} onChange={e => setDoc(d => ({ ...d, date: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>{doc.type_doc === "devis" ? "Validité (jours)" : "Échéance"}</label><input value={doc.validite} onChange={e => setDoc(d => ({ ...d, validite: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Client</label><input value={doc.client} onChange={e => setDoc(d => ({ ...d, client: e.target.value }))} style={inp} placeholder="Nom client" /></div>
              <div><label style={lbl}>Chantier</label><input value={doc.chantier} onChange={e => setDoc(d => ({ ...d, chantier: e.target.value }))} style={inp} placeholder="Adresse du chantier" /></div>
              <div><label style={lbl}>Contact</label><input value={doc.contact} onChange={e => setDoc(d => ({ ...d, contact: e.target.value }))} style={inp} placeholder="Nom contact" /></div>
              <div><label style={lbl}>Email client</label><input type="email" value={doc.email_client || ""} onChange={e => setDoc(d => ({ ...d, email_client: e.target.value }))} style={inp} placeholder="email@client.fr" /></div>
              <div style={{ gridColumn: "2/-1" }}><label style={lbl}>Objet</label><input value={doc.objet} onChange={e => setDoc(d => ({ ...d, objet: e.target.value }))} style={inp} spellCheck lang="fr" placeholder="Objet des travaux" /></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "3fr 100px 90px 90px 110px 32px", gap: 8, padding: "0 12px", marginBottom: 6, fontSize: 10, color: "#666", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
              <span>Désignation</span><span>Unité</span><span style={{ textAlign: "right" }}>Quantité</span><span style={{ textAlign: "right" }}>PU HT €</span><span style={{ textAlign: "right" }}>Total HT €</span><span />
            </div>
            {(doc.lignes || []).map((l, i) => <LigneDevis key={l.id} ligne={l} index={i} onUpdate={updateLigne} onDelete={deleteLigne} />)}
            {(doc.lignes || []).length === 0 && <div style={{ textAlign: "center", padding: "28px", color: "#BBB", border: "1px dashed #DDD", borderRadius: 10, marginBottom: 12 }}>Aucune ligne</div>}
            <button onClick={addLigne} style={{ ...btn("#999", true), width: "100%", marginBottom: 16 }}>+ Ajouter une ligne</button>

            {doc.type_doc === "devis" && (
              <div style={{ background: "#FFFBF2", border: "1px solid #F0D080", borderLeft: "3px solid #E8A838", borderRadius: 8, padding: "14px 16px", marginBottom: 20 }}>
                <label style={{ ...lbl, color: "#B8861A" }}>À votre charge</label>
                <textarea value={doc.a_votre_charge || ""} onChange={e => setDoc(d => ({ ...d, a_votre_charge: e.target.value }))} spellCheck lang="fr" style={{ ...inp, minHeight: 80, resize: "vertical", lineHeight: 1.6 }} />
              </div>
            )}

            <div style={card}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", minWidth: 300, padding: "4px 0" }}>
                  <span style={{ color: "#555", fontSize: 13 }}>Total HT</span>
                  <span style={{ color: "#333", fontSize: 14, fontWeight: 500 }}>{formatMontant(totaux.ht)} €</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#555" }}>
                    <input type="checkbox" checked={doc.sans_tva || false} onChange={e => setDoc(d => ({ ...d, sans_tva: e.target.checked }))} style={{ width: 16, height: 16, accentColor: "#E8A838" }} />
                    Sans TVA
                  </label>
                  {!doc.sans_tva && (
                    <>
                      <span style={{ color: "#666", fontSize: 13 }}>TVA</span>
                      <input type="number" value={doc.tva} onChange={e => setDoc(d => ({ ...d, tva: parseFloat(e.target.value) || 0 }))} style={{ ...inp, width: 60, textAlign: "center" }} />
                      <span style={{ color: "#666", fontSize: 13 }}>%</span>
                      <span style={{ color: "#555", fontSize: 14, minWidth: 120, textAlign: "right" }}>{formatMontant(totaux.tva)} €</span>
                    </>
                  )}
                </div>
                <div style={{ borderTop: "1px solid #EEE", paddingTop: 8, marginTop: 4, width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", minWidth: 300 }}>
                  <span style={{ color: "#B8861A", fontSize: 15, fontWeight: 700 }}>{doc.sans_tva ? "TOTAL HT" : "TOTAL TTC"}</span>
                  <span style={{ color: "#B8861A", fontSize: 18, fontWeight: 800 }}>{formatMontant(doc.sans_tva ? totaux.ht : totaux.ttc)} €</span>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={lbl}>Notes / Conditions</label>
                <textarea value={doc.notes_bas || ""} onChange={e => setDoc(d => ({ ...d, notes_bas: e.target.value }))} spellCheck lang="fr" style={{ ...inp, minHeight: 60, resize: "vertical" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => sauvegarder()} disabled={saving} style={{ ...btn("#27AE60"), opacity: saving ? 0.7 : 1 }}>
                {saving ? "⏳ Sauvegarde..." : "💾 Sauvegarder"}
              </button>
              <button onClick={exporterXLSX} style={btn("#2980B9")}>📊 XLSX</button>
              <button onClick={() => setStep("apercu")} style={btn("#E8A838")}>👁 Aperçu PDF</button>
              <button onClick={envoyerMail} style={btn("#E67E22")}>📧 Envoyer</button>
              <button onClick={() => setStep(liste.length > 0 ? "liste" : "dashboard")} style={btn("#999", true)}>← Retour</button>
            </div>

            {confirmConvert && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
                <div style={{ background: "#FFF", borderRadius: 12, padding: "28px", maxWidth: 400, width: "90%", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>{confirmConvert === "facture" ? "🧾" : "📋"}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Convertir en {TYPES_DOC[confirmConvert]?.label} ?</div>
                  <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>Un nouveau document sera créé avec les mêmes lignes.<br />Le devis passera au statut "Accepté".</div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button onClick={() => setConfirmConvert(null)} style={{ ...btn("#999", true), padding: "7px 18px" }}>Annuler</button>
                    <button onClick={() => convertirEn(confirmConvert)} style={{ ...btn(TYPES_DOC[confirmConvert]?.color || "#E8A838"), padding: "7px 18px" }}>Convertir</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── APERÇU ── */}
        {step === "apercu" && doc && (
          <div>
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 700, color: "#E8A838", margin: 0 }}>Aperçu — {doc.numero}</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStep("formulaire")} style={btn("#999", true)}>← Modifier</button>
                <button onClick={() => sauvegarder()} style={btn("#27AE60")}>💾</button>
                <button onClick={exporterXLSX} style={btn("#2980B9")}>📊 XLSX</button>
                <button onClick={exporterPDF} style={btn("#E8A838")}>📄 PDF</button>
                <button onClick={envoyerMail} style={btn("#E67E22")}>📧 Mail</button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", background: "#2A2A2A", padding: "28px 0 40px", borderRadius: 12 }}>
              <div id="doc-print" style={{ width: 794, minHeight: 1123, background: "#FFF", fontFamily: "'Barlow', Arial, sans-serif", fontSize: 11, color: "#1A1A1A", lineHeight: 1.5, boxShadow: "0 8px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column" }}>
                <div style={{ background: "#E8A838", height: 6, flexShrink: 0 }} />
                <div style={{ padding: "28px 44px 0", flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <img src={LOGO_SRC} alt="" style={{ height: 68, objectFit: "contain", flexShrink: 0 }} />
                      <div style={{ paddingTop: 4, borderLeft: "2px solid #F0F0F0", paddingLeft: 14 }}>
                        <div style={{ fontSize: 8, color: "#999", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Contact</div>
                        <div style={{ fontSize: 9.5, color: "#444", lineHeight: 1.8 }}>{SOCIETE.adresse}, {SOCIETE.cp_ville}<br />Tél. {SOCIETE.tel}<br />{SOCIETE.web}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.06em", lineHeight: 1 }}>{(TYPES_DOC[doc.type_doc]?.label || "DEVIS").toUpperCase()}</div>
                      <div style={{ fontSize: 15, color: "#E8A838", fontWeight: 700, marginTop: 3, fontFamily: "'Barlow Condensed', sans-serif" }}>{doc.numero}</div>
                      <div style={{ fontSize: 9.5, color: "#666", marginTop: 6, lineHeight: 1.8 }}>Émis le {new Date(doc.date).toLocaleDateString("fr-FR")}<br />{doc.type_doc === "devis" && `Validité : ${doc.validite} jours`}</div>
                    </div>
                  </div>
                  <div style={{ height: 1, background: "linear-gradient(to right, #E8A838, #F0F0F0)", marginBottom: 10 }} />
                  <div style={{ textAlign: "center", marginBottom: 14, padding: "6px 0" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.06em", textTransform: "uppercase" }}>CHOK'BÉTON – Sciage &amp; Découpe de Béton</div>
                    <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>Démolition au robot · Renforcement de structure – métallique et carbone</div>
                  </div>
                  <div style={{ display: "flex", marginBottom: 14 }}>
                    <div style={{ flex: 1, background: "#F8F8F8", borderRadius: "6px 0 0 6px", padding: "9px 12px", borderLeft: "3px solid #E8A838" }}>
                      <div style={{ fontSize: 7, fontWeight: 700, color: "#999", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>Client</div>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{doc.client || "—"}</div>
                      {doc.contact && <div style={{ fontSize: 9.5, color: "#666" }}>{doc.contact}</div>}
                    </div>
                    <div style={{ width: 1, background: "#E8E8E8" }} />
                    <div style={{ flex: 1, background: "#F8F8F8", borderRadius: "0 6px 6px 0", padding: "9px 12px" }}>
                      <div style={{ fontSize: 7, fontWeight: 700, color: "#999", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>Chantier</div>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{doc.chantier || "—"}</div>
                    </div>
                  </div>
                  {doc.objet && <div style={{ background: "#FFFBF2", border: "1px solid #F0D888", borderLeft: "3px solid #E8A838", borderRadius: 4, padding: "6px 12px", marginBottom: 12, fontSize: 10 }}><span style={{ fontWeight: 700, color: "#B8861A", marginRight: 6 }}>Objet :</span>{doc.objet}</div>}
                  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10, tableLayout: "fixed" }}>
                    <colgroup><col style={{ width: "45%" }} /><col style={{ width: "10%" }} /><col style={{ width: "12%" }} /><col style={{ width: "16%" }} /><col style={{ width: "17%" }} /></colgroup>
                    <thead>
                      <tr style={{ background: "#1A1A1A" }}>
                        {[["Désignation","left"],["Unité","center"],["Quantité","right"],["PU HT (€)","right"],["Total HT (€)","right"]].map(([l,a]) => (
                          <th key={l} style={{ padding: "7px 9px", textAlign: a, fontSize: 8.5, fontWeight: 700, color: "#FFF", letterSpacing: "0.07em", textTransform: "uppercase" }}>{l}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(doc.lignes || []).map((l, i) => {
                        const m = parseFloat(l.quantite || 0) * parseFloat(l.pu || 0);
                        return (
                          <tr key={l.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F7F7F7" }}>
                            <td style={{ padding: "7px 9px", borderBottom: "1px solid #EEE", fontSize: 10, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{l.designation || "—"}</td>
                            <td style={{ padding: "7px 9px", borderBottom: "1px solid #EEE", textAlign: "center", fontSize: 9.5, fontWeight: 600 }}>{l.unite || "—"}</td>
                            <td style={{ padding: "7px 9px", borderBottom: "1px solid #EEE", textAlign: "right", fontSize: 10 }}>{l.quantite || "—"}</td>
                            <td style={{ padding: "7px 9px", borderBottom: "1px solid #EEE", textAlign: "right", fontSize: 10 }}>{l.pu ? formatMontant(parseFloat(l.pu)) : "—"}</td>
                            <td style={{ padding: "7px 9px", borderBottom: "1px solid #EEE", textAlign: "right", fontSize: 10, fontWeight: 600, color: m > 0 ? "#1A1A1A" : "#BBB" }}>{m > 0 ? formatMontant(m) : "—"}</td>
                          </tr>
                        );
                      })}
                      {(doc.lignes || []).length < 5 && Array.from({ length: Math.max(0, 3 - (doc.lignes || []).length) }).map((_, i) => (
                        <tr key={`e${i}`} style={{ background: ((doc.lignes || []).length + i) % 2 === 0 ? "#FFF" : "#F7F7F7" }}>
                          {[...Array(5)].map((_, j) => <td key={j} style={{ padding: "7px 9px", borderBottom: "1px solid #EEE", height: 26 }}>&nbsp;</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {doc.a_votre_charge && doc.type_doc === "devis" && (
                    <div style={{ marginBottom: 10, border: "1px solid #F0D888", borderLeft: "3px solid #E8A838", borderRadius: 4, padding: "7px 12px", background: "#FFFBF2" }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "#B8861A", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>À votre charge</div>
                      <div style={{ fontSize: 9.5, color: "#555", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{doc.a_votre_charge}</div>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                    <div style={{ width: 270 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", borderTop: "1px solid #E8E8E8" }}><span style={{ fontSize: 9.5, color: "#666" }}>Total HT</span><span style={{ fontSize: 9.5, fontWeight: 600 }}>{formatMontant(totaux.ht)} €</span></div>
                      {!doc.sans_tva && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", borderTop: "1px solid #E8E8E8" }}><span style={{ fontSize: 9.5, color: "#666" }}>TVA {doc.tva}%</span><span style={{ fontSize: 9.5, fontWeight: 600 }}>{formatMontant(totaux.tva)} €</span></div>}
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: "#1A1A1A", borderRadius: 4, marginTop: 4 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#E8A838" }}>{doc.sans_tva ? "TOTAL HT" : "TOTAL TTC"}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: "#E8A838" }}>{formatMontant(doc.sans_tva ? totaux.ht : totaux.ttc)} €</span>
                      </div>
                    </div>
                  </div>
                  {doc.notes_bas && <div style={{ background: "#F8F8F8", borderRadius: 4, padding: "7px 12px", marginBottom: 10, fontSize: 9, color: "#666", lineHeight: 1.6 }}><span style={{ fontWeight: 700, color: "#444", display: "block", marginBottom: 2, fontSize: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Conditions</span>{doc.notes_bas}</div>}
                  <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
                    {[[doc.type_doc === "devis" ? "Bon pour accord — Signature client" : "Signature client", "Date :"], ["CHOK'BÉTON — Christopher Dupré", "christopher@chok-beton.fr  ·  06 24 26 21 05"]].map(([t,s]) => (
                      <div key={t} style={{ flex: 1, border: "1px solid #E0E0E0", borderRadius: 4, padding: "9px 12px" }}>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{t}</div>
                        <div style={{ fontSize: 8.5, color: "#AAA", marginBottom: 5 }}>{s}</div>
                        <div style={{ height: 36 }} />
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ borderTop: "1px solid #EEE", margin: "0 44px", padding: "7px 0", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
                  <span style={{ fontSize: 7.5, color: "#AAA" }}>{SOCIETE.nom} · {SOCIETE.forme} · {SOCIETE.rcs}</span>
                  <span style={{ fontSize: 7.5, color: "#AAA" }}>SIRET {SOCIETE.siret} · TVA {SOCIETE.tva_intra}</span>
                </div>
                <div style={{ background: "#E8A838", height: 4, flexShrink: 0 }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; }
          body > * { display: none !important; }
          .no-print { display: none !important; }
          #doc-print { display: flex !important; position: fixed !important; top: 0; left: 0; width: 210mm !important; min-height: 297mm !important; box-shadow: none !important; }
        }
        button:hover { opacity: 0.85; }
        input:focus, textarea:focus, select:focus { border-color: #E8A838 !important; outline: none; }
        select option { background: #fff; color: #1A1A1A; }
      `}</style>
    </div>
  );
}

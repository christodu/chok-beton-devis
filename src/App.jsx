import { useState, useCallback, useEffect } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

// ─── CONSTANTES MÉTIER ───────────────────────────────────────────────────────
const EMPTY_LIGNE = { id: Date.now(), designation: "", unite: "", quantite: "", pu: "", commentaire: "" };
const UNITES = ["cml", "ml", "m²", "U", "Forfait", "Ens"];
const STORAGE_KEY = "chok_beton_devis_liste";

const SOCIETE = {
  nom: "CHOK'BÉTON", adresse: "1 Rue Hector Berlioz", cp_ville: "95210 Saint-Gratien",
  siret: "410 442 875 00036", rcs: "RCS Pontoise", tva_intra: "FR64410442875",
  tel: "01 34 50 93 56", mobile: "06 24 26 21 05", fax: "01 34 50 19 15",
  web: "www.chok-beton.fr", forme: "SA au capital de 645 027 €",
};

const LOGO_SRC = "/chok-beton-devis/logo.jpg";

// ─── NUMÉROTATION ────────────────────────────────────────────────────────────
function genererNumero() {
  const annee = String(new Date().getFullYear()).slice(-2);
  const cleCompteur = `chok_compteur_${annee}`;
  const cleAnnee = "chok_annee";
  const anneeStockee = localStorage.getItem(cleAnnee);
  let compteur = parseInt(localStorage.getItem(cleCompteur) || "0", 10);
  if (anneeStockee !== annee) { compteur = 0; localStorage.setItem(cleAnnee, annee); }
  compteur += 1;
  localStorage.setItem(cleCompteur, String(compteur));
  return `CDJ ${annee}.${String(compteur).padStart(3, "0")}`;
}

// ─── STORAGE DEVIS ───────────────────────────────────────────────────────────
function chargerDevisList() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function sauvegarderDevis(devis) {
  const liste = chargerDevisList();
  const idx = liste.findIndex(d => d.id === devis.id);
  const entry = { ...devis, updatedAt: new Date().toISOString() };
  if (idx >= 0) liste[idx] = entry; else liste.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(liste));
}
function supprimerDevis(id) {
  const liste = chargerDevisList().filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(liste));
}

// ─── DEVIS VIDE ──────────────────────────────────────────────────────────────
function nouveauDevis() {
  return {
    id: Date.now(),
    numero: genererNumero(),
    date: new Date().toISOString().split("T")[0],
    validite: 30, client: "", chantier: "", contact: "", objet: "",
    lignes: [], sans_tva: false, a_votre_charge: "* Traçage précis des carottages\n* Fourniture de l'électricité 220 V mono 16 A à 20 m\n* Fourniture de l'eau avec un robinet à 20 m\n* Bennes à gravats\n* Toutes les protections collectives\n* Tous les travaux de maçonneries\n* Installation des moyens d'accès sur la terrasse", tva: 20,
    notes_bas: "Devis valable 30 jours. Paiement à 45 jours fin de mois.",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

// ─── IA ──────────────────────────────────────────────────────────────────────
async function interpreterNoteIA(note) {
  const systemPrompt = `Tu es un assistant expert en travaux de béton spécialisé dans le sciage diamant et le carottage.
Tu travailles pour CHOK'BÉTON, entreprise de découpe béton en Île-de-France.
Extrais les lignes de devis depuis la note de chantier fournie.
Réponds UNIQUEMENT en JSON valide, sans aucun texte avant ou après, sans backticks.
Format JSON:
{
  "lignes": [{"designation":"...","unite":"cml|ml|m²|U|Forfait|Ens","quantite":10,"commentaire":"..."}],
  "client_detecte": "...", "chantier_detecte": "...", "notes_globales": "..."
}
Règles: carottage→cml, sciage→m², carbone→ml, démolition/recépage→ml, forfait→Forfait.
Désignation professionnelle complète avec diamètre/épaisseur si pertinent.`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: systemPrompt, messages: [{ role: "user", content: `Note:\n${note}` }] }),
  });
  const data = await response.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const inp = { background: "#FFFFFF", border: "1px solid #D0D0D0", borderRadius: 6, color: "#1A1A1A", padding: "7px 10px", fontSize: 13, width: "100%", outline: "none", fontFamily: "'Barlow', sans-serif" };
const sel = { ...inp, cursor: "pointer" };
const btn = (color = "#E8A838", outline = false) => ({
  background: outline ? "transparent" : color, border: `1.5px solid ${color}`,
  color: outline ? color : "#000", borderRadius: 7, padding: "9px 18px", fontSize: 13,
  fontWeight: 700, cursor: "pointer", fontFamily: "'Barlow Condensed', sans-serif",
  letterSpacing: "0.05em", textTransform: "uppercase", transition: "all 0.15s",
});
const lbl = { display: "block", fontSize: 11, color: "#777", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 5 };
const card = { background: "#FFFFFF", border: "1px solid #E0E0E0", borderRadius: 10, padding: "20px 24px", marginBottom: 20 };

// ─── COMPOSANT LIGNE ─────────────────────────────────────────────────────────
function LigneDevis({ ligne, index, onUpdate, onDelete }) {
  const montant = ligne.quantite && ligne.pu ? (parseFloat(ligne.quantite) * parseFloat(ligne.pu)).toFixed(2) : "";
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E8E8E8", borderLeft: "3px solid #E8A838", borderRadius: 8, padding: "10px 12px", marginBottom: 6, display: "grid", gridTemplateColumns: "3fr 100px 90px 90px 110px 32px", gap: 8, alignItems: "start" }}>
      <textarea placeholder="Ex : Carottages Ø150 – RDC voile béton armé 20cm..." value={ligne.designation} onChange={e => onUpdate(index, { designation: e.target.value })} rows={2} spellCheck={true} lang="fr" style={{ ...inp, resize: "vertical", minHeight: 56, lineHeight: 1.5 }} />
      <select value={ligne.unite} onChange={e => onUpdate(index, { unite: e.target.value })} style={sel}>
        <option value="">Unité</option>
        {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
      <input type="number" placeholder="Qté" value={ligne.quantite} onChange={e => onUpdate(index, { quantite: e.target.value })} style={{ ...inp, textAlign: "right" }} />
      <input type="number" placeholder="PU HT" value={ligne.pu} onChange={e => onUpdate(index, { pu: e.target.value })} style={{ ...inp, textAlign: "right" }} />
      <div style={{ color: montant ? "#E8A838" : "#CCC", fontSize: 13, fontWeight: 700, textAlign: "right" }}>
        {montant ? `${parseFloat(montant).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €` : "—"}
      </div>
      <button onClick={() => onDelete(index)} style={{ background: "transparent", border: "1px solid #DDD", color: "#999", borderRadius: 4, width: 28, height: 28, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
    </div>
  );
}

// ─── COMPOSANT TOTAUX ────────────────────────────────────────────────────────
function TotalRow({ label, value, highlight }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minWidth: 300, padding: "4px 0" }}>
      <span style={{ color: highlight ? "#B8861A" : "#555", fontSize: highlight ? 15 : 13, fontWeight: highlight ? 700 : 400 }}>{label}</span>
      <span style={{ color: highlight ? "#B8861A" : "#333", fontSize: highlight ? 18 : 14, fontWeight: highlight ? 800 : 500 }}>{value.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</span>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState("liste"); // liste | note | formulaire | apercu
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState("");
  const [infoIA, setInfoIA] = useState(null);
  const [devis, setDevis] = useState(null);
  const [liste, setListe] = useState([]);
  const [confirmSuppr, setConfirmSuppr] = useState(null);

  useEffect(() => { setListe(chargerDevisList()); }, []);

  const totalHT = devis ? devis.lignes.reduce((s, l) => { const m = parseFloat(l.quantite || 0) * parseFloat(l.pu || 0); return s + (isNaN(m) ? 0 : m); }, 0) : 0;
  const totalTVA = totalHT * ((devis?.tva || 20) / 100);
  const totalTTC = totalHT + totalTVA;

  const updateLigne = useCallback((index, patch) => {
    setDevis(d => { const lignes = [...d.lignes]; lignes[index] = { ...lignes[index], ...patch }; return { ...d, lignes }; });
  }, []);
  const deleteLigne = useCallback((index) => { setDevis(d => ({ ...d, lignes: d.lignes.filter((_, i) => i !== index) })); }, []);
  const addLigne = () => setDevis(d => ({ ...d, lignes: [...d.lignes, { ...EMPTY_LIGNE, id: Date.now() }] }));

  const creerNouveau = () => { setDevis(nouveauDevis()); setNote(""); setInfoIA(null); setStep("note"); };

  const ouvrirDevis = (d) => { setDevis(d); setNote(""); setInfoIA(null); setStep("formulaire"); };

  const dupliquerDevis = (d) => {
    const copie = { ...d, id: Date.now(), numero: genererNumero(), date: new Date().toISOString().split("T")[0], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setDevis(copie); setNote(""); setInfoIA(null); setStep("formulaire");
  };

  const sauvegarder = () => {
    if (!devis) return;
    sauvegarderDevis(devis);
    setListe(chargerDevisList());
    alert(`✅ Devis ${devis.numero} sauvegardé`);
  };

  const supprimer = (id) => { supprimerDevis(id); setListe(chargerDevisList()); setConfirmSuppr(null); };

  const lancerIA = async () => {
    if (!note.trim()) return;
    setLoading(true); setErreur("");
    try {
      const result = await interpreterNoteIA(note);
      setInfoIA(result);
      const lignesIA = (result.lignes || []).map((l, i) => ({ id: Date.now() + i, designation: l.designation || "", unite: l.unite || "", quantite: l.quantite ? String(l.quantite) : "", pu: "", commentaire: l.commentaire || "" }));
      setDevis(d => ({ ...d, lignes: lignesIA, client: result.client_detecte || d.client, chantier: result.chantier_detecte || d.chantier }));
      setStep("formulaire");
    } catch (e) { setErreur("Erreur d'interprétation : " + e.message); }
    setLoading(false);
  };

  const nomFichierBase = () => {
    // Format : 26.001 DUPONT 10 rue de la Paix Paris
    const numero = devis.numero.replace("CDJ ", ""); // "26.001"
    const client = (devis.client || "Client").trim().toUpperCase();
    const chantier = (devis.chantier || "").trim();
    const parts = [numero, client, chantier].filter(Boolean);
    // Nettoyer les caractères interdits dans un nom de fichier
    return parts.join(" ").replace(/[/\\:*?"<>|]/g, "-");
  };

  const exporterXLSX = () => {
    if (!devis) return;
    const wb = XLSX.utils.book_new();

    // Données lignes
    const rows = [
      ["Désignation", "Unité", "Quantité", "PU HT (€)", "Total HT (€)"],
      ...devis.lignes.map(l => [
        l.designation,
        l.unite,
        parseFloat(l.quantite) || "",
        parseFloat(l.pu) || "",
        parseFloat(l.quantite || 0) * parseFloat(l.pu || 0) || "",
      ]),
      [],
      ["", "", "", "Total HT", totalHT],
      ["", "", "", `TVA ${devis.tva}%`, totalTVA],
      ["", "", "", "TOTAL TTC", totalTTC],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Largeurs colonnes
    ws["!cols"] = [{ wch: 50 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];

    XLSX.utils.book_append_sheet(wb, ws, "Devis");
    XLSX.writeFile(wb, `${nomFichierBase()}.xlsx`);
  };

  const exporterPDF = async () => {
    if (!devis) return;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210;
    const mL = 15, mR = 15, mT = 15;
    let y = mT;

    const gold = [232, 168, 56];
    const noir = [26, 26, 26];
    const gris = [120, 120, 120];
    const grisClair = [248, 248, 248];

    // Bande jaune haute
    doc.setFillColor(...gold);
    doc.rect(0, 0, W, 4, "F");
    y = 8;

    // Logo
    try {
      const logoUrl = LOGO_SRC;
      const resp = await fetch(logoUrl);
      const blob = await resp.blob();
      const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      doc.addImage(b64, "JPEG", mL, y, 30, 19);
    } catch(e) {}

    // Coordonnées société
    doc.setFontSize(8);
    doc.setTextColor(...gris);
    doc.text(`${SOCIETE.adresse}, ${SOCIETE.cp_ville}`, mL + 33, y + 5);
    doc.text(`Tél. ${SOCIETE.tel}`, mL + 33, y + 9);
    doc.text(SOCIETE.web, mL + 33, y + 13);

    // DEVIS + numéro
    doc.setFontSize(26);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...noir);
    doc.text("DEVIS", W - mR, y + 8, { align: "right" });
    doc.setFontSize(13);
    doc.setTextColor(...gold);
    doc.text(devis.numero, W - mR, y + 15, { align: "right" });
    doc.setFontSize(8);
    doc.setTextColor(...gris);
    doc.setFont("helvetica", "normal");
    doc.text(`Émis le ${new Date(devis.date).toLocaleDateString("fr-FR")}`, W - mR, y + 20, { align: "right" });
    doc.text(`Validité : ${devis.validite} jours`, W - mR, y + 24, { align: "right" });

    y += 30;

    // Ligne séparatrice or
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.5);
    doc.line(mL, y, W - mR, y);
    y += 4;

    // Bandeau activités centré
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...noir);
    doc.text("CHOK'BÉTON – Sciage & Découpe de Béton", W / 2, y, { align: "center" });
    y += 4;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gris);
    doc.text("Démolition au robot  ·  Renforcement de structure – métallique et carbone", W / 2, y, { align: "center" });
    y += 7;

    // Bloc Client / Chantier
    const colW = (W - mL - mR - 4) / 2;
    doc.setFillColor(...grisClair);
    doc.rect(mL, y, colW, 16, "F");
    doc.setFillColor(232, 168, 56);
    doc.rect(mL, y, 1.5, 16, "F");
    doc.rect(mL + colW + 4, y, colW, 16, "F");
    doc.setFillColor(...grisClair);
    doc.rect(mL + colW + 4, y, colW, 16, "F");

    doc.setFontSize(7);
    doc.setTextColor(...gris);
    doc.text("CLIENT", mL + 3, y + 4);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...noir);
    doc.text(devis.client || "—", mL + 3, y + 9);
    if (devis.contact) { doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...gris); doc.text(devis.contact, mL + 3, y + 13); }

    doc.setFontSize(7);
    doc.setTextColor(...gris);
    doc.setFont("helvetica", "normal");
    doc.text("CHANTIER", mL + colW + 6, y + 4);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...noir);
    const chLines = doc.splitTextToSize(devis.chantier || "—", colW - 4);
    doc.text(chLines, mL + colW + 6, y + 9);
    y += 20;

    // Objet
    if (devis.objet) {
      doc.setFillColor(255, 251, 242);
      doc.setDrawColor(240, 216, 136);
      doc.rect(mL, y, W - mL - mR, 8, "FD");
      doc.setFillColor(...gold);
      doc.rect(mL, y, 1.5, 8, "F");
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(184, 134, 26);
      doc.text("Objet : ", mL + 3, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 51, 51);
      doc.text(devis.objet, mL + 16, y + 5);
      y += 11;
    }

    // Tableau prestations
    const tableRows = devis.lignes.map(l => {
      const m = parseFloat(l.quantite || 0) * parseFloat(l.pu || 0);
      return [
        l.designation || "—",
        l.unite || "—",
        l.quantite || "—",
        l.pu ? parseFloat(l.pu).toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "—",
        m > 0 ? m.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "—",
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [["Désignation", "Unité", "Quantité", "PU HT (€)", "Total HT (€)"]],
      body: tableRows,
      margin: { left: mL, right: mR },
      styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: [238, 238, 238], lineWidth: 0.2 },
      headStyles: { fillColor: noir, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8, halign: "left" },
      columnStyles: {
        0: { cellWidth: "auto", halign: "left" },
        1: { cellWidth: 18, halign: "center" },
        2: { cellWidth: 22, halign: "right" },
        3: { cellWidth: 28, halign: "right" },
        4: { cellWidth: 28, halign: "right", fontStyle: "bold" },
      },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      theme: "grid",
    });

    y = (doc.lastAutoTable?.finalY || y) + 5;

    // À votre charge
    if (devis.a_votre_charge) {
      doc.setFillColor(255, 251, 242);
      doc.setDrawColor(240, 216, 136);
      const avcLines = doc.splitTextToSize(devis.a_votre_charge, W - mL - mR - 8);
      const avcH = avcLines.length * 4 + 8;
      doc.rect(mL, y, W - mL - mR, avcH, "FD");
      doc.setFillColor(...gold);
      doc.rect(mL, y, 1.5, avcH, "F");
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(184, 134, 26);
      doc.text("À VOTRE CHARGE", mL + 3, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(85, 85, 85);
      doc.setFontSize(8);
      doc.text(avcLines, mL + 3, y + 8);
      y += avcH + 4;
    }

    // Totaux
    const totW = 70;
    const totX = W - mR - totW;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(232, 232, 232);
    doc.setLineWidth(0.2);

    doc.line(totX, y, W - mR, y);
    doc.setTextColor(...gris);
    doc.text("Total HT", totX + 2, y + 4);
    doc.setTextColor(...noir);
    doc.text(`${totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`, W - mR - 2, y + 4, { align: "right" });
    y += 6;

    if (!devis.sans_tva) {
      doc.line(totX, y, W - mR, y);
      doc.setTextColor(...gris);
      doc.text(`TVA ${devis.tva}%`, totX + 2, y + 4);
      doc.setTextColor(...noir);
      doc.text(`${totalTVA.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`, W - mR - 2, y + 4, { align: "right" });
      y += 6;
    }

    doc.setFillColor(...noir);
    doc.rect(totX, y, totW, 8, "F");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...gold);
    doc.text(devis.sans_tva ? "TOTAL HT" : "TOTAL TTC", totX + 3, y + 5.5);
    doc.text(`${(devis.sans_tva ? totalHT : totalTTC).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`, W - mR - 2, y + 5.5, { align: "right" });
    y += 12;

    // Conditions
    if (devis.notes_bas) {
      doc.setFillColor(...grisClair);
      const condLines = doc.splitTextToSize(devis.notes_bas, W - mL - mR - 6);
      const condH = condLines.length * 4 + 8;
      doc.rect(mL, y, W - mL - mR, condH, "F");
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(68, 68, 68);
      doc.text("CONDITIONS", mL + 3, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...gris);
      doc.text(condLines, mL + 3, y + 8);
      y += condH + 5;
    }

    // Signatures
    const sigW = (W - mL - mR - 8) / 2;
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.rect(mL, y, sigW, 22);
    doc.rect(mL + sigW + 8, y, sigW, 22);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text("BON POUR ACCORD — SIGNATURE CLIENT", mL + 2, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gris);
    doc.text("Date :", mL + 2, y + 8);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text("CHOK'BÉTON — Christopher Dupré", mL + sigW + 10, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gris);
    doc.text("christopher@chok-beton.fr  ·  06 24 26 21 05", mL + sigW + 10, y + 8);
    y += 28;

    // Pied de page
    const pageH = doc.internal.pageSize.height;
    doc.setDrawColor(238, 238, 238);
    doc.setLineWidth(0.2);
    doc.line(mL, pageH - 12, W - mR, pageH - 12);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(180, 180, 180);
    doc.text(`${SOCIETE.nom} · ${SOCIETE.forme} · ${SOCIETE.rcs}`, mL, pageH - 8);
    doc.text(`SIRET ${SOCIETE.siret} · TVA ${SOCIETE.tva_intra}`, W - mR, pageH - 8, { align: "right" });

    // Bande jaune basse
    doc.setFillColor(...gold);
    doc.rect(0, pageH - 3, W, 3, "F");

    doc.save(`${nomFichierBase()}.pdf`);
  };


  // ── RENDU ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#F4F4F4", color: "#1A1A1A", fontFamily: "'Barlow', 'Helvetica Neue', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@500;700;800&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{ background: "#FFFFFF", borderBottom: "1px solid #E0E0E0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => setStep("liste")}>
          <img src={LOGO_SRC} alt="CHOK'BÉTON" style={{ height: 40, width: "auto", objectFit: "contain" }} />
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 17, color: "#E8A838" }}>CHOK'BÉTON</div>
            <div style={{ fontSize: 10, color: "#999", letterSpacing: "0.1em", textTransform: "uppercase" }}>Générateur de devis</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {step !== "liste" && <button onClick={() => setStep("liste")} style={{ ...btn("#999", true), padding: "6px 12px", fontSize: 11 }}>📋 Mes devis</button>}
          {(step === "formulaire" || step === "apercu") && <button onClick={sauvegarder} style={{ ...btn("#27AE60"), padding: "6px 12px", fontSize: 11 }}>💾 Sauvegarder</button>}
          {step === "formulaire" && <button onClick={() => setStep("apercu")} style={{ ...btn("#E8A838"), padding: "6px 12px", fontSize: 11 }}>👁 Aperçu</button>}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

        {/* ── LISTE DES DEVIS ── */}
        {step === "liste" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 800, color: "#1A1A1A", margin: 0 }}>Mes devis</h1>
              <button onClick={creerNouveau} style={btn("#E8A838")}>+ Nouveau devis</button>
            </div>

            {liste.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 20px", color: "#AAA", border: "1px dashed #DDD", borderRadius: 12 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
                <div style={{ fontSize: 16, marginBottom: 24 }}>Aucun devis enregistré</div>
                <button onClick={creerNouveau} style={btn("#E8A838")}>Créer mon premier devis</button>
              </div>
            ) : (
              <div>
                {liste.map(d => {
                  const ht = d.lignes.reduce((s, l) => s + (parseFloat(l.quantite || 0) * parseFloat(l.pu || 0)), 0);
                  const ttc = ht * (1 + (d.tva || 20) / 100);
                  return (
                    <div key={d.id} style={{ background: "#FFFFFF", border: "1px solid #E8E8E8", borderLeft: "4px solid #E8A838", borderRadius: 10, padding: "16px 20px", marginBottom: 10, display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 800, color: "#E8A838" }}>{d.numero}</span>
                          <span style={{ fontSize: 11, color: "#999" }}>{new Date(d.date).toLocaleDateString("fr-FR")}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A", marginBottom: 2 }}>{d.client || "— Client non renseigné —"}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{d.chantier || ""}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A" }}>{ttc.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</div>
                        <div style={{ fontSize: 10, color: "#AAA" }}>TTC</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => ouvrirDevis(d)} style={{ ...btn("#E8A838"), padding: "6px 12px", fontSize: 11 }}>Modifier</button>
                        <button onClick={() => dupliquerDevis(d)} style={{ ...btn("#999", true), padding: "6px 12px", fontSize: 11 }}>Dupliquer</button>
                        <button onClick={() => setConfirmSuppr(d.id)} style={{ ...btn("#E74C3C", true), padding: "6px 10px", fontSize: 11 }}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Modal confirmation suppression */}
            {confirmSuppr && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
                <div style={{ background: "#FFF", borderRadius: 12, padding: "32px", maxWidth: 380, width: "90%", textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🗑️</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Supprimer ce devis ?</div>
                  <div style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Cette action est irréversible.</div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button onClick={() => setConfirmSuppr(null)} style={{ ...btn("#999", true), padding: "8px 20px" }}>Annuler</button>
                    <button onClick={() => supprimer(confirmSuppr)} style={{ ...btn("#E74C3C"), padding: "8px 20px" }}>Supprimer</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── NOTE IA ── */}
        {step === "note" && devis && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 800, color: "#E8A838" }}>{devis.numero}</div>
              <div style={{ fontSize: 13, color: "#999" }}>Nouvelle note de chantier</div>
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
              <div onClick={() => setStep("formulaire")} style={{ ...card, flex: 1, cursor: "pointer", borderColor: "#D0D0D0", padding: "20px", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📝</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 700, color: "#555" }}>SAISIE DIRECTE</div>
                <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>Formulaire ligne par ligne</div>
              </div>
              <div style={{ ...card, flex: 2, borderColor: "#E8A838", padding: "20px" }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, fontWeight: 700, color: "#E8A838", marginBottom: 10 }}>🤖 INTERPRÉTATION IA</div>
                <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={`Ex :\n• 10 carottages Ø150 au RDC\n• Sciage refend 20cm, 3×4m\n• Renforcement carbone S1512 - 12ml`} spellCheck={true} lang="fr" style={{ ...inp, minHeight: 140, resize: "vertical", lineHeight: 1.7 }} />
                {erreur && <div style={{ background: "#FFF0F0", border: "1px solid #E07070", borderRadius: 6, padding: "8px 12px", margin: "10px 0", color: "#C0392B", fontSize: 12 }}>⚠️ {erreur}</div>}
                <button onClick={lancerIA} disabled={loading || !note.trim()} style={{ ...btn("#E8A838"), marginTop: 10 }}>
                  {loading ? "⏳ Analyse..." : "🤖 Interpréter avec l'IA"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── FORMULAIRE ── */}
        {step === "formulaire" && devis && (
          <div>
            {infoIA && <div style={{ background: "#F0FAF0", border: "1px solid #A8D5A8", borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#2E7D2E" }}>✅ IA — {devis.lignes.length} ligne(s) extraite(s)</div>}

            {/* En-tête */}
            <div style={{ ...card, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <div><label style={lbl}>N° Devis</label><input value={devis.numero} onChange={e => setDevis(d => ({ ...d, numero: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Date</label><input type="date" value={devis.date} onChange={e => setDevis(d => ({ ...d, date: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Validité (jours)</label><input type="number" value={devis.validite} onChange={e => setDevis(d => ({ ...d, validite: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Client</label><input value={devis.client} onChange={e => setDevis(d => ({ ...d, client: e.target.value }))} style={inp} placeholder="Nom client / entreprise" /></div>
              <div><label style={lbl}>Chantier / Adresse</label><input value={devis.chantier} onChange={e => setDevis(d => ({ ...d, chantier: e.target.value }))} style={inp} placeholder="Adresse du chantier" /></div>
              <div><label style={lbl}>Contact</label><input value={devis.contact} onChange={e => setDevis(d => ({ ...d, contact: e.target.value }))} style={inp} placeholder="Nom contact" /></div>
              <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Objet des travaux</label><input value={devis.objet} onChange={e => setDevis(d => ({ ...d, objet: e.target.value }))} style={inp} placeholder="Description globale" spellCheck={true} lang="fr" /></div>
            </div>

            {/* En-têtes colonnes */}
            <div style={{ display: "grid", gridTemplateColumns: "3fr 100px 90px 90px 110px 32px", gap: 8, padding: "0 12px", marginBottom: 6, fontSize: 10, color: "#666", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
              <span>Désignation</span><span>Unité</span><span style={{ textAlign: "right" }}>Quantité</span><span style={{ textAlign: "right" }}>PU HT €</span><span style={{ textAlign: "right" }}>Total HT €</span><span />
            </div>

            {devis.lignes.map((ligne, i) => <LigneDevis key={ligne.id} ligne={ligne} index={i} onUpdate={updateLigne} onDelete={deleteLigne} />)}
            {devis.lignes.length === 0 && <div style={{ textAlign: "center", padding: "32px", color: "#BBB", border: "1px dashed #DDD", borderRadius: 10, marginBottom: 12 }}>Aucune ligne — ajoute une prestation</div>}
            <button onClick={addLigne} style={{ ...btn("#999", true), width: "100%", marginBottom: 16 }}>+ Ajouter une ligne</button>

            {/* À votre charge */}
            <div style={{ background: "#FFFBF2", border: "1px solid #F0D080", borderLeft: "3px solid #E8A838", borderRadius: 8, padding: "14px 16px", marginBottom: 20 }}>
              <label style={{ ...lbl, color: "#B8861A" }}>À votre charge</label>
              <textarea value={devis.a_votre_charge} onChange={e => setDevis(d => ({ ...d, a_votre_charge: e.target.value }))} placeholder="Ex : Accès chantier, évacuation des déchets, alimentation électrique..." spellCheck={true} lang="fr" style={{ ...inp, minHeight: 80, resize: "vertical", lineHeight: 1.6 }} />
            </div>

            {/* Totaux */}
            <div style={card}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <TotalRow label="Total HT" value={totalHT} />
                {/* Toggle TVA */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#555" }}>
                    <input type="checkbox" checked={devis.sans_tva} onChange={e => setDevis(d => ({ ...d, sans_tva: e.target.checked }))} style={{ width: 16, height: 16, accentColor: "#E8A838", cursor: "pointer" }} />
                    Sans TVA
                  </label>
                  {!devis.sans_tva && (
                    <>
                      <span style={{ color: "#666", fontSize: 13 }}>TVA</span>
                      <input type="number" value={devis.tva} onChange={e => setDevis(d => ({ ...d, tva: parseFloat(e.target.value) || 0 }))} style={{ ...inp, width: 60, textAlign: "center" }} />
                      <span style={{ color: "#666", fontSize: 13 }}>%</span>
                      <span style={{ color: "#555", fontSize: 14, minWidth: 120, textAlign: "right" }}>{totalTVA.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</span>
                    </>
                  )}
                </div>
                <div style={{ borderTop: "1px solid #EEE", paddingTop: 8, marginTop: 4, width: "100%" }}>
                  <TotalRow label={devis.sans_tva ? "TOTAL HT" : "TOTAL TTC"} value={devis.sans_tva ? totalHT : totalTTC} highlight />
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={lbl}>Notes / Conditions</label>
                <textarea value={devis.notes_bas} onChange={e => setDevis(d => ({ ...d, notes_bas: e.target.value }))} spellCheck={true} lang="fr" style={{ ...inp, minHeight: 70, resize: "vertical" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={sauvegarder} style={btn("#27AE60")}>💾 Sauvegarder</button>
              <button onClick={exporterXLSX} style={btn("#2980B9")}>📊 Export XLSX</button>
              <button onClick={() => setStep("apercu")} style={btn("#E8A838")}>👁 Aperçu PDF →</button>
              <button onClick={() => setStep("note")} style={btn("#999", true)}>← Note IA</button>
            </div>
          </div>
        )}

        {/* ── APERÇU PDF ── */}
        {step === "apercu" && devis && (
          <div>
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 700, color: "#E8A838", margin: 0 }}>Aperçu A4 — {devis.numero}</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStep("formulaire")} style={btn("#999", true)}>← Modifier</button>
                <button onClick={sauvegarder} style={btn("#27AE60")}>💾 Sauvegarder</button>
                <button onClick={exporterXLSX} style={btn("#2980B9")}>📊 XLSX</button>
                <button onClick={exporterPDF} style={btn("#E8A838")}>📄 PDF</button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", background: "#2A2A2A", padding: "32px 0 48px", borderRadius: 12 }}>
              <div id="devis-print" style={{ width: 794, minHeight: 1123, background: "#FFFFFF", fontFamily: "'Barlow', Arial, sans-serif", fontSize: 11, color: "#1A1A1A", lineHeight: 1.5, boxShadow: "0 8px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column" }}>
                <div style={{ background: "#E8A838", height: 6, flexShrink: 0 }} />
                <div style={{ padding: "32px 48px 0", flex: 1, display: "flex", flexDirection: "column" }}>

                  {/* En-tête */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                      <img src={LOGO_SRC} alt="CHOK'BÉTON" style={{ height: 72, width: "auto", objectFit: "contain", flexShrink: 0 }} />
                      <div style={{ paddingTop: 6, borderLeft: "2px solid #F0F0F0", paddingLeft: 16 }}>
                        <div style={{ fontSize: 9, color: "#999", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Contact</div>
                        <div style={{ fontSize: 10, color: "#444", lineHeight: 1.8 }}>{SOCIETE.adresse}, {SOCIETE.cp_ville}<br />Tél. {SOCIETE.tel}<br />{SOCIETE.web}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 36, fontWeight: 800, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.06em", lineHeight: 1 }}>DEVIS</div>
                      <div style={{ fontSize: 16, color: "#E8A838", fontWeight: 700, marginTop: 4, fontFamily: "'Barlow Condensed', sans-serif" }}>{devis.numero}</div>
                      <div style={{ fontSize: 10, color: "#666", marginTop: 8, lineHeight: 1.8 }}>Émis le {new Date(devis.date).toLocaleDateString("fr-FR")}<br />Validité : {devis.validite} jours</div>
                    </div>
                  </div>

                  <div style={{ height: 1, background: "linear-gradient(to right, #E8A838, #F0F0F0)", marginBottom: 12 }} />

                  {/* Bandeau activités */}
                  <div style={{ textAlign: "center", marginBottom: 16, padding: "8px 0" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.06em", textTransform: "uppercase" }}>CHOK'BÉTON – Sciage &amp; Découpe de Béton</div>
                    <div style={{ fontSize: 10.5, color: "#555", marginTop: 3 }}>Démolition au robot &nbsp;·&nbsp; Renforcement de structure – métallique et carbone</div>
                  </div>

                  {/* Client / Chantier */}
                  <div style={{ display: "flex", marginBottom: 16 }}>
                    <div style={{ flex: 1, background: "#F8F8F8", borderRadius: "6px 0 0 6px", padding: "10px 14px", borderLeft: "3px solid #E8A838" }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "#999", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 3 }}>Client</div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{devis.client || "—"}</div>
                      {devis.contact && <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{devis.contact}</div>}
                    </div>
                    <div style={{ width: 1, background: "#E8E8E8" }} />
                    <div style={{ flex: 1, background: "#F8F8F8", borderRadius: "0 6px 6px 0", padding: "10px 14px" }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "#999", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 3 }}>Chantier</div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{devis.chantier || "—"}</div>
                    </div>
                  </div>

                  {devis.objet && <div style={{ background: "#FFFBF2", border: "1px solid #F0D888", borderLeft: "3px solid #E8A838", borderRadius: 4, padding: "7px 12px", marginBottom: 14, fontSize: 10.5 }}><span style={{ fontWeight: 700, color: "#B8861A", marginRight: 6 }}>Objet :</span>{devis.objet}</div>}

                  {/* Tableau */}
                  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, tableLayout: "fixed" }}>
                    <colgroup><col style={{ width: "45%" }} /><col style={{ width: "10%" }} /><col style={{ width: "12%" }} /><col style={{ width: "16%" }} /><col style={{ width: "17%" }} /></colgroup>
                    <thead>
                      <tr style={{ background: "#1A1A1A" }}>
                        {[["Désignation","left"],["Unité","center"],["Quantité","right"],["PU HT (€)","right"],["Total HT (€)","right"]].map(([l,a]) => (
                          <th key={l} style={{ padding: "8px 10px", textAlign: a, fontSize: 9, fontWeight: 700, color: "#FFF", letterSpacing: "0.08em", textTransform: "uppercase" }}>{l}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {devis.lignes.map((l, i) => {
                        const m = parseFloat(l.quantite || 0) * parseFloat(l.pu || 0);
                        return (
                          <tr key={l.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F7F7F7" }}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEE", fontSize: 10.5, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{l.designation || "—"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEE", textAlign: "center", fontSize: 10, fontWeight: 600 }}>{l.unite || "—"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEE", textAlign: "right", fontSize: 10.5 }}>{l.quantite || "—"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEE", textAlign: "right", fontSize: 10.5 }}>{l.pu ? parseFloat(l.pu).toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "—"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEE", textAlign: "right", fontSize: 10.5, fontWeight: 600, color: m > 0 ? "#1A1A1A" : "#BBB" }}>{m > 0 ? m.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "—"}</td>
                          </tr>
                        );
                      })}
                      {devis.lignes.length < 5 && Array.from({ length: Math.max(0, 3 - devis.lignes.length) }).map((_, i) => (
                        <tr key={`e${i}`} style={{ background: (devis.lignes.length + i) % 2 === 0 ? "#FFF" : "#F7F7F7" }}>
                          {[...Array(5)].map((_, j) => <td key={j} style={{ padding: "8px 10px", borderBottom: "1px solid #EEE", height: 28 }}>&nbsp;</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* À votre charge */}
                  {devis.a_votre_charge && (
                    <div style={{ marginBottom: 12, border: "1px solid #F0D888", borderLeft: "3px solid #E8A838", borderRadius: 4, padding: "8px 12px", background: "#FFFBF2" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#B8861A", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>À votre charge</div>
                      <div style={{ fontSize: 10, color: "#555", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{devis.a_votre_charge}</div>
                    </div>
                  )}

                  {/* Totaux */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                    <div style={{ width: 260 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", borderTop: "1px solid #E8E8E8" }}><span style={{ fontSize: 10, color: "#666" }}>Total HT</span><span style={{ fontSize: 10, fontWeight: 600 }}>{totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</span></div>
                      {!devis.sans_tva && (
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", borderTop: "1px solid #E8E8E8" }}><span style={{ fontSize: 10, color: "#666" }}>TVA {devis.tva}%</span><span style={{ fontSize: 10, fontWeight: 600 }}>{totalTVA.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</span></div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "#1A1A1A", borderRadius: 4, marginTop: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#E8A838" }}>{devis.sans_tva ? "TOTAL HT" : "TOTAL TTC"}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#E8A838" }}>{(devis.sans_tva ? totalHT : totalTTC).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</span>
                      </div>
                    </div>
                  </div>

                  {/* Conditions */}
                  {devis.notes_bas && <div style={{ background: "#F8F8F8", borderRadius: 4, padding: "8px 12px", marginBottom: 12, fontSize: 9.5, color: "#666", lineHeight: 1.6 }}><span style={{ fontWeight: 700, color: "#444", display: "block", marginBottom: 3, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>Conditions</span>{devis.notes_bas}</div>}

                  {/* Signatures */}
                  <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
                    {[["Bon pour accord — Signature client", "Date :"], ["CHOK'BÉTON — Christopher Dupré", "christopher@chok-beton.fr  ·  06 24 26 21 05"]].map(([t, s]) => (
                      <div key={t} style={{ flex: 1, border: "1px solid #E0E0E0", borderRadius: 4, padding: "10px 14px" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{t}</div>
                        <div style={{ fontSize: 9, color: "#AAA", marginBottom: 6 }}>{s}</div>
                        <div style={{ height: 40 }} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pied */}
                <div style={{ borderTop: "1px solid #EEE", margin: "0 48px", padding: "8px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 8, color: "#AAA" }}>{SOCIETE.nom} · {SOCIETE.forme} · {SOCIETE.rcs}</span>
                  <span style={{ fontSize: 8, color: "#AAA" }}>SIRET {SOCIETE.siret} · TVA {SOCIETE.tva_intra}</span>
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
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body > * { display: none !important; }
          .no-print { display: none !important; }
          #devis-print { display: flex !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 210mm !important; min-height: 297mm !important; box-shadow: none !important; font-size: 10pt !important; }
          #devis-print table { page-break-inside: auto; }
          #devis-print tr { page-break-inside: avoid; }
        }
        button:hover { opacity: 0.85; }
        input:focus, textarea:focus, select:focus { border-color: #E8A838 !important; outline: none; }
        select option { background: #fff; color: #1A1A1A; }
      `}</style>
    </div>
  );
}

import { useState, useCallback } from "react";

// ─── CONSTANTES MÉTIER CHOK BÉTON ───────────────────────────────────────────
const PRESTATIONS = {
  carottage: {
    label: "Carottage",
    unite: "cml",
    diametres: [52, 80, 102, 112, 132, 152, 162, 202, 252, 302, 400, 500, 600],
    couleur: "#E8A838",
  },
  sciage: {
    label: "Sciage",
    unite: "m²",
    epaisseurs: [10, 15, 20, 25, 30, 35, 40, 50],
    couleur: "#C0392B",
  },
  sciage_cable: {
    label: "Sciage au câble diamant",
    unite: "m²",
    epaisseurs: [],
    couleur: "#8E44AD",
  },
  carbone: {
    label: "Renforcement fibre de carbone",
    unite: "ml",
    refs: ["S1512", "S1214"],
    couleur: "#2C3E50",
  },
  demolition: {
    label: "Démolition / Recépage",
    unite: "ml",
    couleur: "#7F8C8D",
  },
  chevalement: {
    label: "Mise en place de chevalement",
    unite: "U",
    couleur: "#27AE60",
  },
  coring: {
    label: "Forage / Coring",
    unite: "cml",
    diametres: [52, 80, 102, 132, 152],
    couleur: "#2980B9",
  },
};

const EMPTY_LIGNE = {
  id: Date.now(),
  designation: "",
  unite: "",
  quantite: "",
  pu: "",
  commentaire: "",
};

// ─── INFOS SOCIÉTÉ ──────────────────────────────────────────────────────────
const SOCIETE = {
  nom: "CHOK'BÉTON",
  adresse: "1 Rue Hector Berlioz",
  cp_ville: "95210 Saint-Gratien",
  siret: "410 442 875 00036",
  rcs: "RCS Pontoise",
  tva_intra: "FR64410442875",
  tel: "01 34 50 93 56",
  mobile: "06 24 26 21 05",
  fax: "01 34 50 19 15",
  web: "www.chok-beton.fr",
  activite: "Sciage diamant · Carottage · Renforcement structurel",
  forme: "SA au capital de 645 027 €",
};

// ─── LOGO CHOK BÉTON ────────────────────────────────────────────────────────
const LOGO_SRC = "/chok-beton-devis/logo.jpg";

const LogoChokBeton = ({ size = 48 }) => (
  <img src={LOGO_SRC} alt="CHOK'BÉTON" style={{ height: size, width: "auto", objectFit: "contain" }} />
);

// ─── INTERPRÉTEUR IA ─────────────────────────────────────────────────────────
async function interpreterNoteIA(note) {
  const systemPrompt = `Tu es un assistant expert en travaux de béton spécialisé dans le sciage diamant et le carottage. 
Tu travailles pour CHOK'BÉTON, entreprise de découpe béton en Île-de-France.

Extrais les lignes de devis depuis la note de chantier fournie.
Réponds UNIQUEMENT en JSON valide, sans aucun texte avant ou après, sans backticks.

Format JSON attendu:
{
  "lignes": [
    {
      "designation": "Description complète et professionnelle de la prestation (type de travaux, diamètre/épaisseur si pertinent, localisation, matériau...)",
      "unite": "cml|ml|m²|U|Forfait|Ens",
      "quantite": 10,
      "commentaire": "info complémentaire si besoin"
    }
  ],
  "client_detecte": "nom client si mentionné",
  "chantier_detecte": "adresse ou nom chantier si mentionné",
  "notes_globales": "autres informations pertinentes"
}

Règles métier pour la désignation (texte libre professionnel):
- Carottage: "Carottage Ø150 dans voile béton armé 20cm" → unite="cml"
- Sciage: "Sciage de dalle béton armé ép. 20cm" → unite="m²"
- Sciage câble: "Sciage au câble diamant – démolition refend béton" → unite="m²"
- Carbone: "Renforcement structurel par lamelles carbone S1512" → unite="ml"
- Recépage/démolition: "Recépage de pieux béton" → unite="ml"
- Forfait: prestation globale non quantifiable → unite="Forfait"
- Ens: ensemble de prestations → unite="Ens"
- Si diamètre approximatif (ex: "150mm"), l'intégrer dans la désignation: "Ø152"
- Si quantité incertaine (ex: "une dizaine"), mettre la valeur numérique (10)
- La désignation doit être claire et professionnelle, comme sur un vrai devis BTP`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Note de chantier:\n${note}` }],
    }),
  });

  const data = await response.json();
  const text = data.content?.map((b) => b.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

const UNITES = ["cml", "ml", "m²", "U", "Forfait", "Ens"];

// ─── COMPOSANT LIGNE DEVIS ───────────────────────────────────────────────────
function LigneDevis({ ligne, index, onUpdate, onDelete }) {
  const montant =
    ligne.quantite && ligne.pu
      ? (parseFloat(ligne.quantite) * parseFloat(ligne.pu)).toFixed(2)
      : "";

  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid #E8E8E8",
      borderLeft: "3px solid #E8A838",
      borderRadius: 8,
      padding: "10px 12px",
      marginBottom: 6,
      display: "grid",
      gridTemplateColumns: "3fr 100px 90px 90px 110px 32px",
      gap: 8,
      alignItems: "start",
    }}>
      {/* Désignation — texte libre multilignes */}
      <textarea
        placeholder="Ex : Carottages Ø150 – RDC voile béton armé 20cm..."
        value={ligne.designation}
        onChange={(e) => onUpdate(index, { designation: e.target.value })}
        rows={2}
        style={{ ...inputStyle, resize: "vertical", minHeight: 56, lineHeight: 1.5 }}
      />

      {/* Unité */}
      <select
        value={ligne.unite}
        onChange={(e) => onUpdate(index, { unite: e.target.value })}
        style={selectStyle}
      >
        <option value="">Unité</option>
        {UNITES.map((u) => (
          <option key={u} value={u}>{u}</option>
        ))}
      </select>

      {/* Quantité */}
      <input
        type="number"
        placeholder="Qté"
        value={ligne.quantite}
        onChange={(e) => onUpdate(index, { quantite: e.target.value })}
        style={{ ...inputStyle, textAlign: "right" }}
      />

      {/* PU HT */}
      <input
        type="number"
        placeholder="PU HT"
        value={ligne.pu}
        onChange={(e) => onUpdate(index, { pu: e.target.value })}
        style={{ ...inputStyle, textAlign: "right" }}
      />

      {/* Total HT */}
      <div style={{
        color: montant ? "#E8A838" : "#333",
        fontSize: 13,
        fontWeight: 700,
        textAlign: "right",
        letterSpacing: "0.02em",
      }}>
        {montant ? `${parseFloat(montant).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €` : "—"}
      </div>

      {/* Supprimer */}
      <button
        onClick={() => onDelete(index)}
        style={{
          background: "transparent",
          border: "1px solid #2A2A2A",
          color: "#555",
          borderRadius: 4,
          width: 28,
          height: 28,
          cursor: "pointer",
          fontSize: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const inputStyle = {
  background: "#FFFFFF",
  border: "1px solid #D0D0D0",
  borderRadius: 6,
  color: "#1A1A1A",
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
  outline: "none",
  fontFamily: "'Barlow', sans-serif",
};

const selectStyle = {
  ...inputStyle,
  cursor: "pointer",
};

const btnStyle = (color = "#E8A838", outline = false) => ({
  background: outline ? "transparent" : color,
  border: `1.5px solid ${color}`,
  color: outline ? color : "#000",
  borderRadius: 7,
  padding: "9px 18px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'Barlow Condensed', sans-serif",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  transition: "all 0.15s",
});

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState("accueil"); // accueil | note | formulaire | apercu
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState("");
  const [infoIA, setInfoIA] = useState(null);
  const [exportLoading, setExportLoading] = useState(false);

  const [devis, setDevis] = useState({
    numero: `DV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`,
    date: new Date().toISOString().split("T")[0],
    validite: 30,
    client: "",
    chantier: "",
    contact: "",
    objet: "",
    lignes: [],
    a_votre_charge: "",
    tva: 20,
    notes_bas: "Devis valable 30 jours. Paiement à 45 jours fin de mois.",
  });

  const totalHT = devis.lignes.reduce((s, l) => {
    const m = parseFloat(l.quantite || 0) * parseFloat(l.pu || 0);
    return s + (isNaN(m) ? 0 : m);
  }, 0);
  const totalTVA = totalHT * (devis.tva / 100);
  const totalTTC = totalHT + totalTVA;

  const updateLigne = useCallback((index, patch) => {
    setDevis((d) => {
      const lignes = [...d.lignes];
      lignes[index] = { ...lignes[index], ...patch };
      return { ...d, lignes };
    });
  }, []);

  const deleteLigne = useCallback((index) => {
    setDevis((d) => ({ ...d, lignes: d.lignes.filter((_, i) => i !== index) }));
  }, []);

  const addLigne = () => {
    setDevis((d) => ({
      ...d,
      lignes: [...d.lignes, { ...EMPTY_LIGNE, id: Date.now() }],
    }));
  };

  const lancerIA = async () => {
    if (!note.trim()) return;
    setLoading(true);
    setErreur("");
    try {
      const result = await interpreterNoteIA(note);
      setInfoIA(result);
      const lignesIA = (result.lignes || []).map((l, i) => ({
        id: Date.now() + i,
        designation: l.designation || "",
        unite: l.unite || "",
        quantite: l.quantite ? String(l.quantite) : "",
        pu: "",
        commentaire: l.commentaire || "",
      }));
      setDevis((d) => ({
        ...d,
        lignes: lignesIA,
        client: result.client_detecte || d.client,
        chantier: result.chantier_detecte || d.chantier,
        objet: result.notes_globales ? d.objet || result.notes_globales.substring(0, 80) : d.objet,
      }));
      setStep("formulaire");
    } catch (e) {
      setErreur("Erreur d'interprétation. Vérifie ta note et réessaie. (" + e.message + ")");
    }
    setLoading(false);
  };

  const exporterCSV = () => {
    const headers = ["Désignation", "Unité", "Quantité", "PU HT (€)", "Total HT (€)"];
    const rows = devis.lignes.map((l) => {
      const montant = (parseFloat(l.quantite || 0) * parseFloat(l.pu || 0)).toFixed(2);
      return [l.designation, l.unite, l.quantite, l.pu, montant];
    });
    rows.push(["", "", "", "Total HT", totalHT.toFixed(2)]);
    rows.push(["", "", "", `TVA ${devis.tva}%`, totalTVA.toFixed(2)]);
    rows.push(["", "", "", "Total TTC", totalTTC.toFixed(2)]);

    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${devis.numero}_CHOK_BETON.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── RENDU ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "#F4F4F4",
      color: "#1A1A1A",
      fontFamily: "'Barlow', 'Helvetica Neue', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@500;700;800&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{
        background: "#FFFFFF",
        borderBottom: "1px solid #E0E0E0",
        padding: "14px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoChokBeton size={44} />
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: "0.08em", color: "#E8A838" }}>
              CHOK'BÉTON
            </div>
            <div style={{ fontSize: 11, color: "#666", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Générateur de devis
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["accueil", "note", "formulaire"].map((s) => (
            <button
              key={s}
              onClick={() => step !== "accueil" && setStep(s)}
              style={{
                ...btnStyle(step === s ? "#E8A838" : "#999", step !== s),
                padding: "6px 14px",
                fontSize: 11,
                opacity: s === "formulaire" && devis.lignes.length === 0 ? 0.4 : 1,
              }}
            >
              {s === "accueil" ? "Accueil" : s === "note" ? "📋 Note" : "✏️ Formulaire"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px" }}>

        {/* ── ACCUEIL ── */}
        {step === "accueil" && (
          <div style={{ textAlign: "center", paddingTop: 60 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏗️</div>
            <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 42, fontWeight: 800, color: "#E8A838", margin: 0 }}>
              GÉNÉRATEUR DE DEVIS
            </h1>
            <p style={{ color: "#888", fontSize: 16, marginBottom: 48 }}>
              Transformez une note de chantier en devis structuré CHOK BÉTON
            </p>
            <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
              <div
                onClick={() => setStep("note")}
                style={{
                  background: "#FFFFFF",
                  border: "2px solid #E8A838",
                  borderRadius: 12,
                  padding: "32px 40px",
                  cursor: "pointer",
                  maxWidth: 300,
                  transition: "transform 0.15s",
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 700, color: "#E8A838", marginBottom: 8 }}>
                  INTERPRÉTATION IA
                </div>
                <div style={{ color: "#888", fontSize: 14, lineHeight: 1.5 }}>
                  Colle ta note brute — l'IA extrait automatiquement les lignes de devis
                </div>
              </div>
              <div
                onClick={() => { setStep("formulaire"); }}
                style={{
                  background: "#FFFFFF",
                  border: "2px solid #D0D0D0",
                  borderRadius: 12,
                  padding: "32px 40px",
                  cursor: "pointer",
                  maxWidth: 300,
                  transition: "transform 0.15s",
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>📝</div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 700, color: "#CCC", marginBottom: 8 }}>
                  SAISIE DIRECTE
                </div>
                <div style={{ color: "#888", fontSize: 14, lineHeight: 1.5 }}>
                  Saisis les lignes manuellement avec le formulaire guidé
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── NOTE IA ── */}
        {step === "note" && (
          <div>
            <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 700, color: "#E8A838", marginBottom: 6 }}>
              📋 Note de chantier
            </h2>
            <p style={{ color: "#555", fontSize: 14, marginBottom: 20 }}>
              Colle ta note Mac / texte libre — l'IA identifie les prestations, diamètres, quantités
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`Exemples:\n• 10 carottages Ø150 au RDC\n• Sciage refend 20cm épaisseur, 3 passes de 4m\n• Renforcement carbone S1512 - environ 12ml\n• Recépage mur béton 57ml`}
              style={{
                ...inputStyle,
                width: "100%",
                minHeight: 220,
                resize: "vertical",
                lineHeight: 1.7,
                fontSize: 14,
              }}
            />
            {erreur && (
              <div style={{ background: "#FFF0F0", border: "1px solid #E07070", borderRadius: 6, padding: "10px 14px", margin: "12px 0", color: "#C0392B", fontSize: 13 }}>
                ⚠️ {erreur}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={lancerIA} disabled={loading || !note.trim()} style={btnStyle("#E8A838")}>
                {loading ? "⏳ Analyse en cours..." : "🤖 Interpréter avec l'IA"}
              </button>
              <button onClick={() => setStep("formulaire")} style={btnStyle("#555", true)}>
                Passer au formulaire →
              </button>
            </div>
          </div>
        )}

        {/* ── FORMULAIRE ── */}
        {step === "formulaire" && (
          <div>
            {/* Info IA si présente */}
            {infoIA && (
              <div style={{
                background: "#F0FAF0",
                border: "1px solid #A8D5A8",
                borderRadius: 8,
                padding: "10px 16px",
                marginBottom: 20,
                fontSize: 13,
                color: "#2E7D2E",
              }}>
                ✅ IA — {devis.lignes.length} ligne(s) extraite(s)
                {infoIA.notes_globales && <span style={{ color: "#888", marginLeft: 8 }}>· {infoIA.notes_globales}</span>}
              </div>
            )}

            {/* En-tête devis */}
            <div style={{
              background: "#FFFFFF",
              border: "1px solid #E0E0E0",
              borderRadius: 10,
              padding: "20px 24px",
              marginBottom: 24,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
            }}>
              <div>
                <label style={labelStyle}>N° Devis</label>
                <input value={devis.numero} onChange={(e) => setDevis((d) => ({ ...d, numero: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Date</label>
                <input type="date" value={devis.date} onChange={(e) => setDevis((d) => ({ ...d, date: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Validité (jours)</label>
                <input type="number" value={devis.validite} onChange={(e) => setDevis((d) => ({ ...d, validite: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Client</label>
                <input value={devis.client} onChange={(e) => setDevis((d) => ({ ...d, client: e.target.value }))} style={inputStyle} placeholder="Nom client / entreprise" />
              </div>
              <div>
                <label style={labelStyle}>Chantier / Adresse</label>
                <input value={devis.chantier} onChange={(e) => setDevis((d) => ({ ...d, chantier: e.target.value }))} style={inputStyle} placeholder="Adresse du chantier" />
              </div>
              <div>
                <label style={labelStyle}>Contact</label>
                <input value={devis.contact} onChange={(e) => setDevis((d) => ({ ...d, contact: e.target.value }))} style={inputStyle} placeholder="Nom contact" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Objet des travaux</label>
                <input value={devis.objet} onChange={(e) => setDevis((d) => ({ ...d, objet: e.target.value }))} style={inputStyle} placeholder="Description globale de la prestation" />
              </div>
            </div>

            {/* En-têtes colonnes */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "3fr 100px 90px 90px 110px 32px",
              gap: 8,
              padding: "0 12px",
              marginBottom: 6,
              fontSize: 10,
              color: "#444",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}>
              <span>Désignation</span>
              <span>Unité</span>
              <span style={{ textAlign: "right" }}>Quantité</span>
              <span style={{ textAlign: "right" }}>PU HT €</span>
              <span style={{ textAlign: "right" }}>Total HT €</span>
              <span />
            </div>

            {/* Lignes */}
            {devis.lignes.map((ligne, i) => (
              <LigneDevis key={ligne.id} ligne={ligne} index={i} onUpdate={updateLigne} onDelete={deleteLigne} />
            ))}

            {devis.lignes.length === 0 && (
              <div style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "#AAA",
                border: "1px dashed #CCC",
                borderRadius: 10,
                marginBottom: 16,
              }}>
                Aucune ligne — ajoute une prestation ci-dessous
              </div>
            )}

            <button onClick={addLigne} style={{ ...btnStyle("#999", true), width: "100%", marginBottom: 16 }}>
              + Ajouter une ligne
            </button>

            {/* À VOTRE CHARGE */}
            <div style={{
              background: "#FFFBF2",
              border: "1px solid #F0D080",
              borderLeft: "3px solid #E8A838",
              borderRadius: 8,
              padding: "14px 16px",
              marginBottom: 24,
            }}>
              <label style={{ ...labelStyle, color: "#E8A838" }}>À votre charge</label>
              <textarea
                value={devis.a_votre_charge}
                onChange={(e) => setDevis((d) => ({ ...d, a_votre_charge: e.target.value }))}
                placeholder="Ex : Accès chantier, évacuation des déchets, alimentation électrique, présence d'un responsable de chantier..."
                style={{ ...inputStyle, minHeight: 80, resize: "vertical", lineHeight: 1.6 }}
              />
            </div>

            {/* Totaux */}
            <div style={{
              background: "#FFFFFF",
              border: "1px solid #E0E0E0",
              borderRadius: 10,
              padding: "20px 24px",
              marginBottom: 20,
            }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <TotalRow label="Total HT" value={totalHT} />
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#666", fontSize: 13 }}>TVA</span>
                  <input
                    type="number"
                    value={devis.tva}
                    onChange={(e) => setDevis((d) => ({ ...d, tva: parseFloat(e.target.value) || 0 }))}
                    style={{ ...inputStyle, width: 60, textAlign: "center" }}
                  />
                  <span style={{ color: "#666", fontSize: 13 }}>%</span>
                  <span style={{ color: "#CCC", fontSize: 14, minWidth: 120, textAlign: "right" }}>
                    {totalTVA.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €
                  </span>
                </div>
                <div style={{ borderTop: "1px solid #333", paddingTop: 8, marginTop: 4, width: "100%" }}>
                  <TotalRow label="TOTAL TTC" value={totalTTC} highlight />
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={labelStyle}>Notes / Conditions particulières</label>
                <textarea
                  value={devis.notes_bas}
                  onChange={(e) => setDevis((d) => ({ ...d, notes_bas: e.target.value }))}
                  style={{ ...inputStyle, minHeight: 70, resize: "vertical" }}
                />
              </div>
            </div>

            {/* Actions export */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={exporterCSV} style={btnStyle("#27AE60")}>
                📊 Exporter CSV / Excel
              </button>
              <button onClick={() => setStep("apercu")} style={btnStyle("#E8A838")}>
                👁 Aperçu PDF →
              </button>
              <button onClick={() => setStep("note")} style={btnStyle("#555", true)}>
                ← Modifier la note
              </button>
            </div>
          </div>
        )}

        {/* ── APERÇU PDF ── */}
        {step === "apercu" && (
          <div>
            {/* Barre d'actions — masquée à l'impression */}
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700, color: "#E8A838", margin: 0 }}>
                Aperçu A4
              </h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStep("formulaire")} style={btnStyle("#555", true)}>← Modifier</button>
                <button onClick={exporterCSV} style={btnStyle("#27AE60")}>📊 CSV</button>
                <button onClick={() => window.print()} style={btnStyle("#E8A838")}>🖨️ Imprimer / PDF</button>
              </div>
            </div>

            {/* Feuille A4 — 210mm × 297mm = 794px × 1123px @96dpi */}
            <div style={{ display: "flex", justifyContent: "center", background: "#1A1A1A", padding: "32px 0 48px", borderRadius: 12 }}>
              <div id="devis-print" style={{
                width: 794,
                minHeight: 1123,
                background: "#FFFFFF",
                fontFamily: "'Barlow', Arial, sans-serif",
                fontSize: 11,
                color: "#1A1A1A",
                lineHeight: 1.5,
                position: "relative",
                boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                display: "flex",
                flexDirection: "column",
              }}>

                {/* ── BANDE JAUNE HAUTE ── */}
                <div style={{ background: "#E8A838", height: 6, width: "100%", flexShrink: 0 }} />

                {/* ── CORPS PRINCIPAL ── */}
                <div style={{ padding: "32px 48px 0", flex: 1, display: "flex", flexDirection: "column" }}>

                  {/* EN-TÊTE : Logo + coordonnées | DEVIS */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>

                    {/* Gauche : logo + coords */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                      <img src={LOGO_SRC} alt="CHOK'BÉTON" style={{ height: 72, width: "auto", objectFit: "contain", flexShrink: 0 }} />
                      <div style={{ paddingTop: 6, borderLeft: "2px solid #F0F0F0", paddingLeft: 16 }}>
                        <div style={{ fontSize: 9, color: "#999", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Contact</div>
                        <div style={{ fontSize: 10, color: "#444", lineHeight: 1.8 }}>
                          {SOCIETE.adresse}, {SOCIETE.cp_ville}<br />
                          Tél. {SOCIETE.tel} &nbsp;·&nbsp; M. {SOCIETE.mobile}<br />
                          {SOCIETE.web}
                        </div>
                      </div>
                    </div>

                    {/* Droite : DEVIS + numéro + dates */}
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 36, fontWeight: 800, color: "#1A1A1A", fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.06em", lineHeight: 1 }}>DEVIS</div>
                      <div style={{ fontSize: 16, color: "#E8A838", fontWeight: 700, marginTop: 4, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.04em" }}>{devis.numero}</div>
                      <div style={{ fontSize: 10, color: "#666", marginTop: 8, lineHeight: 1.8 }}>
                        Émis le {new Date(devis.date).toLocaleDateString("fr-FR")}<br />
                        Validité : {devis.validite} jours
                      </div>
                    </div>
                  </div>

                  {/* SÉPARATEUR */}
                  <div style={{ height: 1, background: "linear-gradient(to right, #E8A838, #F0F0F0)", marginBottom: 14 }} />

                  {/* BANDEAU ACTIVITÉS CENTRÉ */}
                  <div style={{ textAlign: "center", marginBottom: 18, padding: "10px 0" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#1A1A1A", fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      CHOK'BÉTON – Sciage &amp; Découpe de Béton
                    </div>
                    <div style={{ fontSize: 10.5, color: "#555", marginTop: 3, letterSpacing: "0.03em" }}>
                      Démolition au robot &nbsp;·&nbsp; Renforcement de structure – métallique et carbone
                    </div>
                  </div>

                  {/* BLOC CLIENT / CHANTIER */}
                  <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
                    <div style={{ flex: 1, background: "#F8F8F8", borderRadius: "6px 0 0 6px", padding: "12px 16px", borderLeft: "3px solid #E8A838" }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "#999", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Client</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1A1A" }}>{devis.client || "—"}</div>
                      {devis.contact && <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{devis.contact}</div>}
                    </div>
                    <div style={{ width: 1, background: "#E8E8E8" }} />
                    <div style={{ flex: 1, background: "#F8F8F8", borderRadius: "0 6px 6px 0", padding: "12px 16px" }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "#999", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Chantier</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1A1A" }}>{devis.chantier || "—"}</div>
                    </div>
                  </div>

                  {/* OBJET */}
                  {devis.objet && (
                    <div style={{ background: "#FFFBF2", border: "1px solid #F0D888", borderLeft: "3px solid #E8A838", borderRadius: 4, padding: "8px 12px", marginBottom: 20, fontSize: 10.5 }}>
                      <span style={{ fontWeight: 700, color: "#B8861A", marginRight: 6 }}>Objet :</span>
                      <span style={{ color: "#333" }}>{devis.objet}</span>
                    </div>
                  )}

                  {/* TABLEAU PRESTATIONS */}
                  <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "45%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "17%" }} />
                    </colgroup>
                    <thead>
                      <tr style={{ background: "#1A1A1A" }}>
                        {[
                          { label: "Désignation", align: "left" },
                          { label: "Unité", align: "center" },
                          { label: "Quantité", align: "right" },
                          { label: "PU HT (€)", align: "right" },
                          { label: "Total HT (€)", align: "right" },
                        ].map(({ label, align }) => (
                          <th key={label} style={{
                            padding: "8px 10px",
                            textAlign: align,
                            fontSize: 9,
                            fontWeight: 700,
                            color: "#FFFFFF",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {devis.lignes.map((l, i) => {
                        const montant = parseFloat(l.quantite || 0) * parseFloat(l.pu || 0);
                        const isEven = i % 2 === 0;
                        return (
                          <tr key={l.id} style={{ background: isEven ? "#FFFFFF" : "#F7F7F7" }}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEEEEE", fontSize: 10.5, color: "#1A1A1A", lineHeight: 1.4, fontWeight: 400, whiteSpace: "pre-wrap" }}>{l.designation || "—"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEEEEE", textAlign: "center", fontSize: 10, color: "#444", fontWeight: 600 }}>{l.unite || "—"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEEEEE", textAlign: "right", fontSize: 10.5 }}>{l.quantite || "—"}</td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEEEEE", textAlign: "right", fontSize: 10.5, color: "#333" }}>
                              {l.pu ? parseFloat(l.pu).toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #EEEEEE", textAlign: "right", fontSize: 10.5, fontWeight: 600, color: montant > 0 ? "#1A1A1A" : "#BBBBBB" }}>
                              {montant > 0 ? montant.toLocaleString("fr-FR", { minimumFractionDigits: 2 }) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Lignes vides pour remplir visuellement si peu de lignes */}
                      {devis.lignes.length < 6 && Array.from({ length: Math.max(0, 4 - devis.lignes.length) }).map((_, i) => (
                        <tr key={`empty-${i}`} style={{ background: (devis.lignes.length + i) % 2 === 0 ? "#FFFFFF" : "#F7F7F7" }}>
                          {[...Array(5)].map((_, j) => (
                            <td key={j} style={{ padding: "8px 10px", borderBottom: "1px solid #EEEEEE", height: 32 }}>&nbsp;</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* À VOTRE CHARGE */}
                  {devis.a_votre_charge && (
                    <div style={{ marginBottom: 16, border: "1px solid #F0D888", borderLeft: "3px solid #E8A838", borderRadius: 4, padding: "10px 14px", background: "#FFFBF2" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#B8861A", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>À votre charge</div>
                      <div style={{ fontSize: 10, color: "#555", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{devis.a_votre_charge}</div>
                    </div>
                  )}

                  {/* TOTAUX */}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
                    <div style={{ width: 260 }}>
                      {/* Total HT */}
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", borderTop: "1px solid #E8E8E8" }}>
                        <span style={{ fontSize: 10, color: "#666" }}>Total HT</span>
                        <span style={{ fontSize: 10, fontWeight: 600 }}>{totalHT.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</span>
                      </div>
                      {/* TVA */}
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", borderTop: "1px solid #E8E8E8" }}>
                        <span style={{ fontSize: 10, color: "#666" }}>TVA {devis.tva}%</span>
                        <span style={{ fontSize: 10, fontWeight: 600 }}>{totalTVA.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</span>
                      </div>
                      {/* TTC */}
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "#1A1A1A", borderRadius: 4, marginTop: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#E8A838", letterSpacing: "0.04em" }}>TOTAL TTC</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#E8A838" }}>{totalTTC.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</span>
                      </div>
                    </div>
                  </div>

                  {/* CONDITIONS */}
                  {devis.notes_bas && (
                    <div style={{ background: "#F8F8F8", borderRadius: 4, padding: "10px 14px", marginBottom: 16, fontSize: 9.5, color: "#666", lineHeight: 1.6 }}>
                      <span style={{ fontWeight: 700, color: "#444", display: "block", marginBottom: 3, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>Conditions</span>
                      {devis.notes_bas}
                    </div>
                  )}

                  {/* SIGNATURES */}
                  <div style={{ display: "flex", gap: 24, marginBottom: 20 }}>
                    <div style={{ flex: 1, border: "1px solid #E0E0E0", borderRadius: 4, padding: "10px 14px" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Bon pour accord — Signature client</div>
                      <div style={{ fontSize: 9, color: "#AAA", marginBottom: 8 }}>Date :</div>
                      <div style={{ height: 44 }} />
                    </div>
                    <div style={{ flex: 1, border: "1px solid #E0E0E0", borderRadius: 4, padding: "10px 14px" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>CHOK'BÉTON — Christopher Dupré</div>
                      <div style={{ fontSize: 9, color: "#AAA", marginBottom: 8 }}>Directeur</div>
                      <div style={{ height: 44 }} />
                    </div>
                  </div>

                </div>{/* fin corps */}

                {/* ── PIED DE PAGE ── */}
                <div style={{ borderTop: "1px solid #EEEEEE", margin: "0 48px", padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 8, color: "#AAAAAA" }}>
                    {SOCIETE.nom} · {SOCIETE.forme} · {SOCIETE.rcs}
                  </span>
                  <span style={{ fontSize: 8, color: "#AAAAAA" }}>
                    SIRET {SOCIETE.siret} · TVA {SOCIETE.tva_intra}
                  </span>
                </div>

                {/* ── BANDE JAUNE BASSE ── */}
                <div style={{ background: "#E8A838", height: 4, width: "100%", flexShrink: 0 }} />

              </div>{/* fin feuille A4 */}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          body > * { display: none !important; }
          .no-print { display: none !important; }
          #devis-print {
            display: flex !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 210mm !important;
            min-height: 297mm !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            font-size: 10pt !important;
          }
          #devis-print table { page-break-inside: auto; }
          #devis-print tr { page-break-inside: avoid; }
        }
        button:hover { opacity: 0.85; }
        input:focus, textarea:focus, select:focus { border-color: #E8A838 !important; }
        select option { background: #fff; color: #1A1A1A; }
      `}</style>
    </div>
  );
}

function TotalRow({ label, value, highlight }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minWidth: 300, padding: "4px 0" }}>
      <span style={{ color: highlight ? "#B8861A" : "#555", fontSize: highlight ? 15 : 13, fontWeight: highlight ? 700 : 400 }}>{label}</span>
      <span style={{ color: highlight ? "#B8861A" : "#333", fontSize: highlight ? 18 : 14, fontWeight: highlight ? 800 : 500 }}>
        {value.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €
      </span>
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: 11,
  color: "#777",
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  marginBottom: 5,
};

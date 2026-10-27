/** Libellés et mises en forme de l'interface (aucune formule : uniquement de l'affichage). */

import { type EntreeJournal, Severite, Statut } from "@/moteur/controles";

export const LIBELLES_SCENARIOS: Readonly<Record<string, string>> = {
  hausse_parallele: "Hausse parallèle",
  baisse_parallele: "Baisse parallèle",
  pentification: "Pentification",
  aplatissement: "Aplatissement",
  hausse_taux_courts: "Hausse des taux courts",
  baisse_taux_courts: "Baisse des taux courts",
};

export function libelleScenario(s: string): string {
  return LIBELLES_SCENARIOS[s] ?? s;
}

/** Libellés du PDF de cadrage (p. 3 à 8). */
export const LIBELLES_CONTROLES: Readonly<Record<string, string>> = {
  C01: "Complétude, qualité et doublons des données source",
  C02: "Périmètre : toute position source est calculée",
  C03: "Reproductibilité (empreinte des entrées)",
  C04: "Rapprochement des encours avec les sources",
  C05: "Conservation des flux",
  C06: "Hypothèses comportementales en vigueur",
  C07: "Variation par rapport à l'arrêté précédent",
  C08: "Signes et cohérence des agrégats",
  C09: "Approbation à quatre yeux",
};

const ORDRE_SEVERITE: readonly Severite[] = [
  Severite.BLOQUANTE,
  Severite.MAJEURE,
  Severite.AVERTISSEMENT,
  Severite.INFORMATION,
];

export type Ton = "ok" | "ko" | "attention" | "info";

export interface StatutControle {
  readonly code: string;
  readonly libelle: string;
  readonly statut: string;
  readonly ton: Ton;
}

function pluriel(n: number, singulier: string, plurielForme: string): string {
  return `${n} ${n > 1 ? plurielForme : singulier}`;
}

/** Statut de C01 à C09 déduit du journal ; `trace` est l'empreinte C03 des entrées. */
export function statutControles(journal: readonly EntreeJournal[], trace: string): StatutControle[] {
  const parCode = new Map<string, EntreeJournal[]>();
  for (const e of journal) {
    const code = e.idRegle.slice(0, 3);
    parCode.set(code, [...(parCode.get(code) ?? []), e]);
  }
  return Object.entries(LIBELLES_CONTROLES).map(([code, libelle]) => {
    const entrees = parCode.get(code) ?? [];
    const anomalies = entrees.filter((e) => e.severite !== Severite.INFORMATION);
    if (code === "C03") {
      return trace === ""
        ? { code, libelle, statut: "Non calculée (calcul bloqué)", ton: "info" }
        : { code, libelle, statut: `Empreinte ${trace.slice(0, 16)}`, ton: "info" };
    }
    if (code === "C09") {
      const acceptees = journal.filter((e) => e.statut === Statut.ACCEPTEE);
      const enAttente = journal.filter((e) => e.statut === Statut.OUVERTE && e.severite === Severite.MAJEURE).length;
      if (enAttente > 0) {
        return {
          code,
          libelle,
          statut: `${pluriel(enAttente, "anomalie majeure", "anomalies majeures")} en attente d'approbation`,
          ton: "ko",
        };
      }
      if (acceptees.length === 0) return { code, libelle, statut: "Aucune anomalie à approuver", ton: "ok" };
      const qui = [...new Set(acceptees.map((e) => e.approbateur))].sort().join(", ");
      // Même ton que l'anomalie acceptée elle-même (C07…) : traitée, mais à garder en vue.
      return {
        code,
        libelle,
        statut: `${pluriel(acceptees.length, "anomalie acceptée", "anomalies acceptées")} (approbateur : ${qui})`,
        ton: "attention",
      };
    }
    if (entrees.length === 0) return { code, libelle, statut: "Non exécuté dans cette démonstration", ton: "info" };
    if (anomalies.length === 0) return { code, libelle, statut: "Conforme", ton: "ok" };
    const pire = [...anomalies].sort(
      (a, b) => ORDRE_SEVERITE.indexOf(a.severite) - ORDRE_SEVERITE.indexOf(b.severite),
    )[0]!;
    const ouvertes = anomalies.filter((e) => e.statut === Statut.OUVERTE).length;
    const etat = ouvertes > 0 ? pluriel(ouvertes, "ouverte", "ouvertes") : "acceptée par un tiers";
    return {
      code,
      libelle,
      statut: `${pire.severite} : ${pluriel(anomalies.length, "anomalie", "anomalies")}, ${etat}`,
      // Rouge seulement pour ce qui bloque la remise (cf. `bloquants`) : bloquante, ou majeure ouverte.
      ton:
        pire.severite === Severite.BLOQUANTE || (pire.severite === Severite.MAJEURE && ouvertes > 0)
          ? "ko"
          : "attention",
    };
  });
}

const FORMAT_MONTANT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Nombre à une décimale, format français (espace fine insécable, virgule). */
export function nombre(x: number): string {
  return FORMAT_MONTANT.format(x);
}

export function pourcentage(x: number, decimales = 1): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(x);
}

/** Seuil saisi : autant de décimales que nécessaire (12,5 % reste 12,5 %, 15 % reste 15 %). */
export function pourcentageSeuil(x: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 }).format(x);
}

/** Montant signé avec un vrai signe moins typographique. */
export function montantSigne(x: number): string {
  const arrondi = Math.abs(x) < 0.05 ? 0 : x;
  if (arrondi === 0) return nombre(0);
  return `${arrondi > 0 ? "+" : "−"}${nombre(Math.abs(arrondi))}`;
}

export function tonSeverite(s: Severite): Ton {
  if (s === Severite.BLOQUANTE) return "ko";
  if (s === Severite.INFORMATION) return "info";
  return "attention";
}

const NOMBRE_BRUT = /^-?\d+(\.\d+)?(e-?\d+)?$/;

/**
 * Valeur du journal lisible : les nombres bruts du moteur (« -168.98741566469107 ») passent au format
 * français, les comparateurs « <= » et « >= » en « ≤ » et « ≥ ». Le texte reste sinon inchangé.
 */
export function valeurJournal(texte: string): string {
  if (NOMBRE_BRUT.test(texte)) {
    const x = Number(texte);
    if (Math.abs(x) >= 1 || x === 0) return montantSigneJournal(x);
    return new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 4 }).format(x).replace("-", "−");
  }
  return texte
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/-?\d+\.\d+(e-?\d+)?/g, (n) => valeurJournal(n));
}

function montantSigneJournal(x: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(x).replace("-", "−");
}

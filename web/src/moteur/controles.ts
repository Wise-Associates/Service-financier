/**
 * Contrôles C01 à C09 et journal des anomalies (PDF p. 3, 4, 7 et 8). C10 (archivage) : voir limites.
 *
 * Chaque contrôle produit au moins une entrée de journal : une anomalie avec sa sévérité, ou une
 * entrée « Information » quand il est passé (preuve pour la piste d'audit). L'horodatage est
 * injecté par l'appelant (`Contexte.maintenant`) pour garder des contrôles reproductibles.
 *
 * Sévérités (PDF p. 7) :
 * - Bloquante : bloque le calcul ou la remise jusqu'à correction, ne s'approuve pas ;
 * - Majeure : justification documentée et approbation d'un tiers ;
 * - Avertissement : commentaire, propriétaire, échéance ;
 * - Information : journalisée.
 */

import { createHash } from "node:crypto";

import { propre } from "./cles";
import { DepotNonEcheance, PretRemboursementAnticipe } from "./comportemental";
import type { Marches } from "./mesures";
import { CapFloor } from "./options";
import { Instrument, type Position } from "./positions";
import { somme } from "./tableau";

export const Severite = {
  BLOQUANTE: "Bloquante",
  MAJEURE: "Majeure",
  AVERTISSEMENT: "Avertissement",
  INFORMATION: "Information",
} as const;
export type Severite = (typeof Severite)[keyof typeof Severite];

export const Statut = {
  OUVERTE: "Ouverte",
  ACCEPTEE: "Acceptée",
  JOURNALISEE: "Journalisée",
} as const;
export type Statut = (typeof Statut)[keyof typeof Statut];

export interface Contexte {
  readonly periode: string;
  /** Horodatage ISO 8601 injecté par l'appelant. */
  readonly maintenant: string;
  readonly responsable: string;
}

/** Journal minimum du PDF p. 7. */
export interface EntreeJournal {
  readonly idRegle: string;
  readonly objet: string;
  readonly periode: string;
  readonly valeurAttendue: string;
  readonly valeurObservee: string;
  readonly severite: Severite;
  readonly statut: Statut;
  readonly horodatage: string;
  readonly responsable: string;
  readonly justification: string;
  readonly approbateur: string;
}

export type Journal = readonly EntreeJournal[];

/** Représentation texte d'une valeur dans le journal (`null` et `undefined` deviennent « None » comme en Python). */
function texte(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "string" ? `'${x}'` : texte(x))).join(", ")}]`;
  return String(v);
}

function entree(
  ctx: Contexte,
  regle: string,
  objet: string,
  attendu: unknown,
  observe: unknown,
  severite: Severite,
  justification = "",
): EntreeJournal {
  return Object.freeze({
    idRegle: regle,
    objet,
    periode: ctx.periode,
    valeurAttendue: texte(attendu),
    valeurObservee: texte(observe),
    severite,
    statut: severite === Severite.INFORMATION ? Statut.JOURNALISEE : Statut.OUVERTE,
    horodatage: ctx.maintenant,
    responsable: ctx.responsable,
    justification,
    approbateur: "",
  });
}

function conforme(ctx: Contexte, regle: string, objet: string, detail: string): EntreeJournal[] {
  return [entree(ctx, regle, objet, detail, detail, Severite.INFORMATION, "contrôle passé")];
}

function vide(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "") || Number.isNaN(v);
}

export type Enregistrement = Readonly<Record<string, unknown>>;

function identifiantLigne(e: Enregistrement, i: number): string {
  return e["identifiant"] === undefined ? `ligne ${i + 1}` : String(e["identifiant"]);
}

/** C01 : champs minimaux présents selon la catégorie d'instrument (PDF p. 4). */
export function controleCompletude(
  enregistrements: readonly Enregistrement[],
  champsParCategorie: Readonly<Record<string, readonly string[]>>,
  ctx: Contexte,
): EntreeJournal[] {
  const res: EntreeJournal[] = [];
  enregistrements.forEach((e, i) => {
    const ident = identifiantLigne(e, i);
    const cat = e["categorie"];
    const champs = typeof cat === "string" ? propre(champsParCategorie, cat) : undefined;
    if (champs === undefined) {
      res.push(entree(ctx, "C01-CATEGORIE", ident, "catégorie connue", cat, Severite.BLOQUANTE));
      return;
    }
    const manquants = champs.filter((c) => vide(e[c]));
    if (manquants.length > 0) {
      res.push(
        entree(ctx, "C01-COMPLETUDE", ident, "champs renseignés", `manquants : ${manquants.join(", ")}`, Severite.BLOQUANTE),
      );
    }
  });
  return res.length > 0
    ? res
    : conforme(ctx, "C01-COMPLETUDE", "portefeuille", `${enregistrements.length} lignes complètes`);
}

function nombreFini(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** C01 : formats, devises, encours, maturités et taux aberrants. */
export function controleQualite(
  enregistrements: readonly Enregistrement[],
  devisesAutorisees: readonly string[],
  ctx: Contexte,
  bornesTaux: readonly [number, number] = [-0.05, 0.3],
): EntreeJournal[] {
  const res: EntreeJournal[] = [];
  enregistrements.forEach((e, i) => {
    const ident = identifiantLigne(e, i);
    const devise = e["devise"];
    if (typeof devise !== "string" || !devisesAutorisees.includes(devise)) {
      res.push(entree(ctx, "C01-DEVISE", ident, devisesAutorisees, devise, Severite.BLOQUANTE));
    }
    for (const champ of ["encours", "maturite"]) {
      const v = e[champ];
      if (!nombreFini(v) || v <= 0) {
        res.push(entree(ctx, `C01-${champ.toUpperCase()}`, ident, "> 0", v, Severite.BLOQUANTE));
      }
    }
    const taux = e["taux"];
    if (taux !== null && taux !== undefined) {
      if (!nombreFini(taux)) {
        res.push(entree(ctx, "C01-TAUX", ident, "nombre", taux, Severite.BLOQUANTE));
      } else if (!(bornesTaux[0] <= taux && taux <= bornesTaux[1])) {
        res.push(
          entree(ctx, "C01-TAUX-ABERRANT", ident, `dans (${bornesTaux[0]}, ${bornesTaux[1]})`, taux, Severite.MAJEURE),
        );
      }
    }
  });
  return res.length > 0 ? res : conforme(ctx, "C01-QUALITE", "portefeuille", "formats et valeurs conformes");
}

/** C01 : un identifiant présent deux fois serait compté deux fois. */
export function controleDoublons(identifiants: readonly string[], ctx: Contexte): EntreeJournal[] {
  const vus = new Map<string, number>();
  for (const id of identifiants) vus.set(id, (vus.get(id) ?? 0) + 1);
  const res = [...vus].filter(([, n]) => n > 1).map(([k, n]) => entree(ctx, "C01-DOUBLON", k, 1, n, Severite.BLOQUANTE));
  return res.length > 0 ? res : conforme(ctx, "C01-DOUBLON", "portefeuille", "aucun doublon");
}

/** C02 : toute position source est calculée, et rien d'autre. */
export function controlePerimetre(
  idsSource: readonly string[],
  idsCalcul: readonly string[],
  ctx: Contexte,
): EntreeJournal[] {
  const src = new Set(idsSource);
  const calc = new Set(idsCalcul);
  const res = [
    ...[...src]
      .filter((i) => !calc.has(i))
      .sort()
      .map((i) => entree(ctx, "C02-ABSENT", i, "présent dans le calcul", "absent", Severite.BLOQUANTE)),
    ...[...calc]
      .filter((i) => !src.has(i))
      .sort()
      .map((i) => entree(ctx, "C02-HORS-SOURCE", i, "présent dans la source", "absent", Severite.BLOQUANTE)),
  ];
  return res.length > 0 ? res : conforme(ctx, "C02-PERIMETRE", "portefeuille", `${src.size} positions`);
}

/** JSON canonique : clés triées, sans espaces, pour que l'empreinte ne dépende pas de l'ordre de saisie. */
function jsonCanonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonique).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonCanonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * C03 : empreinte SHA-256 d'un objet JSON canonique (données, paramètres, version de règles).
 * Les nombres sont écrits à la manière de JavaScript (1200 et non 1200.0) : l'empreinte n'est
 * donc pas comparable à celle du moteur Python, seulement d'un calcul TypeScript à l'autre.
 */
export function empreinte(objet: unknown): string {
  return createHash("sha256").update(jsonCanonique(objet), "utf8").digest("hex");
}

/** C03 : le calcul rejoué à partir de l'arrêté et des versions donne la même empreinte. */
export function controleReproductibilite(
  objet: string,
  attendue: string,
  recalculee: string,
  ctx: Contexte,
): EntreeJournal[] {
  if (attendue !== recalculee) {
    return [entree(ctx, "C03-REPRODUCTIBILITE", objet, attendue, recalculee, Severite.BLOQUANTE)];
  }
  return conforme(ctx, "C03-REPRODUCTIBILITE", objet, attendue.slice(0, 12));
}

/** C04 : encours du calcul rapprochés des systèmes sources (par devise, produit…). */
export function controleRapprochement(
  totauxSource: Readonly<Record<string, number>>,
  totauxCalcul: Readonly<Record<string, number>>,
  ctx: Contexte,
  toleranceAbs: number,
  toleranceRel = 0,
): EntreeJournal[] {
  const res: EntreeJournal[] = [];
  const cles = [...new Set([...Object.keys(totauxSource), ...Object.keys(totauxCalcul)])].sort();
  for (const cle of cles) {
    const s = propre(totauxSource, cle);
    const c = propre(totauxCalcul, cle);
    if (s === undefined || c === undefined) {
      res.push(entree(ctx, "C04-RAPPROCHEMENT", cle, s, c, Severite.BLOQUANTE));
      continue;
    }
    const ecart = Math.abs(c - s);
    const tol = Math.max(toleranceAbs, toleranceRel * Math.abs(s));
    if (ecart > tol) {
      res.push(entree(ctx, "C04-RAPPROCHEMENT", cle, s, c, Severite.BLOQUANTE));
    } else if (ecart > 1e-9) {
      res.push(
        entree(
          ctx,
          "C04-RAPPROCHEMENT",
          cle,
          s,
          c,
          Severite.AVERTISSEMENT,
          `écart ${ecart.toFixed(2)} dans la tolérance ${tol.toFixed(2)}`,
        ),
      );
    }
  }
  return res.length > 0 ? res : conforme(ctx, "C04-RAPPROCHEMENT", "totaux", "écart nul");
}

/** Encours attendu (signé) d'une position ; null si la notion ne s'applique pas (option). */
export function encoursSigne(p: Position): number | null {
  if (p instanceof Instrument) return p.sens * p.nominal;
  if (p instanceof DepotNonEcheance) return -p.encours;
  if (p instanceof PretRemboursementAnticipe) return p.encours;
  if (p instanceof CapFloor) return null;
  throw new Error(`type de position non pris en charge : ${p.identifiant}`);
}

/** C05 : la somme du principal projeté égale l'encours (ni perte ni double comptage). */
export function controleConservationFlux(
  positions: readonly Position[],
  marches: Marches,
  ctx: Contexte,
  toleranceRel = 1e-9,
): EntreeJournal[] {
  const res: EntreeJournal[] = [];
  for (const p of positions) {
    const attendu = encoursSigne(p);
    if (attendu === null) continue;
    const m = propre(marches, p.devise);
    if (m === undefined) throw new Error(`${p.identifiant} : aucune courbe pour la devise ${p.devise}`);
    const observe = somme(p.flux(m, m, true).principal);
    if (Math.abs(observe - attendu) > toleranceRel * Math.abs(attendu)) {
      res.push(entree(ctx, "C05-CONSERVATION", p.identifiant, attendu, observe, Severite.BLOQUANTE));
    }
  }
  return res.length > 0 ? res : conforme(ctx, "C05-CONSERVATION", "flux", "principal = encours");
}

export interface Hypothese {
  readonly nom: string;
  readonly version: string;
  /** Date ISO AAAA-MM-JJ. */
  readonly valideJusquAu: string;
  readonly approbateur: string;
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** C06 : hypothèses comportementales datées, versionnées, approuvées et en vigueur. */
export function controleHypotheses(
  hypotheses: readonly Hypothese[],
  dateArrete: string,
  ctx: Contexte,
): EntreeJournal[] {
  if (!DATE_ISO.test(dateArrete)) throw new Error("dateArrete au format AAAA-MM-JJ");
  const res: EntreeJournal[] = [];
  for (const h of hypotheses) {
    if (!DATE_ISO.test(h.valideJusquAu)) throw new Error(`${h.nom} : date de validité au format AAAA-MM-JJ`);
    const objet = `${h.nom} v${h.version}`;
    if (h.approbateur.trim() === "") {
      res.push(entree(ctx, "C06-APPROBATION", objet, "approbateur renseigné", "aucun", Severite.MAJEURE));
    }
    // Les dates ISO se comparent dans l'ordre lexicographique.
    if (h.valideJusquAu < dateArrete) {
      res.push(entree(ctx, "C06-VALIDITE", objet, `>= ${dateArrete}`, h.valideJusquAu, Severite.MAJEURE));
    }
  }
  return res.length > 0 ? res : conforme(ctx, "C06-HYPOTHESES", "modèles", `${hypotheses.length} hypothèses en vigueur`);
}

function signe(x: number): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
}

/** C07 : variation par rapport à l'arrêté précédent ; significative et non expliquée = Majeure. */
export function controleVariation(
  indicateur: string,
  valeur: number,
  valeurPrecedente: number,
  ctx: Contexte,
  seuilRelatif: number,
  seuilAbsolu: number,
  explication = "",
): EntreeJournal[] {
  const ecart = valeur - valeurPrecedente;
  const significatif = Math.abs(ecart) > seuilAbsolu && Math.abs(ecart) > seuilRelatif * Math.abs(valeurPrecedente);
  if (!significatif) return conforme(ctx, "C07-VARIATION", indicateur, `variation ${signe(ecart)}`);
  if (explication.trim() !== "") {
    return [entree(ctx, "C07-VARIATION", indicateur, valeurPrecedente, valeur, Severite.INFORMATION, explication)];
  }
  return [entree(ctx, "C07-VARIATION", indicateur, valeurPrecedente, valeur, Severite.MAJEURE)];
}

export type ConventionSigne = "positif" | "negatif" | "libre";

/** C08 : règle de signe de la rubrique ; un négatif n'est une erreur que si la rubrique l'interdit. */
export function controleSigne(
  rubrique: string,
  valeur: number,
  convention: ConventionSigne,
  ctx: Contexte,
): EntreeJournal[] {
  const viole = (convention === "positif" && valeur < 0) || (convention === "negatif" && valeur > 0);
  if (viole) return [entree(ctx, "C08-SIGNE", rubrique, convention, valeur, Severite.BLOQUANTE)];
  return conforme(ctx, "C08-SIGNE", rubrique, convention);
}

/** C08 : cohérence entre agrégats ou entre états (total = somme des devises, etc.). */
export function controleCoherence(
  nom: string,
  valeurA: number,
  valeurB: number,
  ctx: Contexte,
  tolerance: number,
): EntreeJournal[] {
  if (Math.abs(valeurA - valeurB) > tolerance) {
    return [entree(ctx, "C08-COHERENCE", nom, valeurA, valeurB, Severite.BLOQUANTE)];
  }
  return conforme(ctx, "C08-COHERENCE", nom, `écart <= ${tolerance}`);
}

/** C09 : accepte une anomalie non bloquante, par une personne autre que le responsable. */
export function approuver(e: EntreeJournal, approbateur: string, justification: string, maintenant: string): EntreeJournal {
  if (e.severite === Severite.BLOQUANTE) throw new Error("une anomalie bloquante se corrige, elle ne s'approuve pas");
  if (justification.trim() === "") throw new Error("justification documentée obligatoire");
  if (approbateur.trim() === "" || approbateur === e.responsable) {
    throw new Error("l'approbateur doit être renseigné et distinct du responsable (quatre yeux)");
  }
  return Object.freeze({ ...e, statut: Statut.ACCEPTEE, approbateur, justification, horodatage: maintenant });
}

/** Anomalies qui empêchent la remise : bloquantes, ou majeures non acceptées. */
export function bloquants(journal: Journal): EntreeJournal[] {
  return journal.filter(
    (e) => e.statut === Statut.OUVERTE && (e.severite === Severite.BLOQUANTE || e.severite === Severite.MAJEURE),
  );
}

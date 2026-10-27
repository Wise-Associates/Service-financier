/**
 * Lecture et validation des paramètres saisis dans le formulaire (paramètres d'URL).
 *
 * Une saisie invalide est refusée et le calcul n'est pas lancé : on ne corrige jamais une valeur en
 * silence. Les pourcentages sont saisis en % et convertis en décimal pour le moteur.
 */

import { z } from "zod";

import { PARAMETRES_DEFAUT, type Parametres } from "./banqueFictive";

export type ParametresUrl = Readonly<Record<string, string | string[] | undefined>>;

export interface Champ {
  readonly nom: "fondsPropresT1" | "seuilSotEve" | "seuilSotNii" | "poidsGains";
  readonly libelle: string;
  readonly aide: string;
  readonly minimum: number;
  readonly maximum: number;
  /** Valeur du paramètre = saisie × échelle (0,01 pour un pourcentage). */
  readonly echelle: number;
}

export const CHAMPS: readonly Champ[] = [
  {
    nom: "fondsPropresT1",
    libelle: "Fonds propres Tier 1 (M€)",
    aide: "Montant fictif de la démonstration.",
    minimum: 1,
    maximum: 1e9,
    echelle: 1,
  },
  {
    nom: "seuilSotEve",
    libelle: "Seuil SOT ΔEVE (% du Tier 1)",
    aide: "15 % selon le RTS UE 2024/856, à confirmer.",
    minimum: 0.1,
    maximum: 100,
    echelle: 0.01,
  },
  {
    nom: "seuilSotNii",
    libelle: "Seuil SOT ΔNII (% du Tier 1)",
    aide: "5 % selon le RTS UE 2024/856, à confirmer.",
    minimum: 0.1,
    maximum: 100,
    echelle: 0.01,
  },
  {
    nom: "poidsGains",
    libelle: "Pondération des gains entre devises (%)",
    aide: "50 % selon BCBS d368, à confirmer.",
    minimum: 0,
    maximum: 100,
    echelle: 0.01,
  },
];

/** Longueur maximale d'une saisie : au-delà, ce n'est pas un nombre raisonnable. */
const LONGUEUR_MAX = 32;

export const NOM_MARGE = "inclureMarge";
export const NOM_SOUMIS = "calculer";

function borne(x: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(x);
}

function schemaChamp(c: Champ): z.ZodType<number> {
  return z
    .string()
    .max(LONGUEUR_MAX, `${c.libelle} : saisie trop longue.`)
    .transform((brut) => brut.replace(/[\s  ]/g, "").replace(",", "."))
    .pipe(
      z
        .string()
        .regex(/^[+-]?(\d+\.?\d*|\.\d+)$/, `${c.libelle} : ce n'est pas un nombre.`)
        .transform(Number)
        .pipe(
          z
            .number()
            .min(c.minimum, `${c.libelle} : saisissez une valeur entre ${borne(c.minimum)} et ${borne(c.maximum)}.`)
            .max(c.maximum, `${c.libelle} : saisissez une valeur entre ${borne(c.minimum)} et ${borne(c.maximum)}.`),
        ),
    );
}

/** Première valeur d'un paramètre d'URL répété (`?a=1&a=2` donne « 1 »). */
export function premiereValeur(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export interface Saisie {
  readonly parametres: Parametres;
  readonly erreurs: readonly string[];
  /** Texte à réafficher dans chaque champ (la saisie brute, même refusée, pour la corriger). */
  readonly affichage: Readonly<Record<Champ["nom"], string>>;
  readonly inclureMarge: boolean;
}

function texteDefaut(c: Champ): string {
  const v = PARAMETRES_DEFAUT[c.nom] / c.echelle;
  // Arrondi pour effacer les résidus binaires (0,15 / 0,01 = 14,999…).
  return String(Number(v.toPrecision(12))).replace(".", ",");
}

export function lireSaisie(url: ParametresUrl): Saisie {
  const erreurs: string[] = [];
  const valeurs: Partial<Record<Champ["nom"], number>> = {};
  const affichage = {} as Record<Champ["nom"], string>;
  for (const c of CHAMPS) {
    const brut = premiereValeur(url[c.nom]);
    if (brut === undefined || brut.trim() === "") {
      valeurs[c.nom] = PARAMETRES_DEFAUT[c.nom];
      affichage[c.nom] = texteDefaut(c);
      continue;
    }
    affichage[c.nom] = brut.slice(0, LONGUEUR_MAX);
    const res = schemaChamp(c).safeParse(brut);
    if (res.success) valeurs[c.nom] = res.data * c.echelle;
    else erreurs.push(res.error.issues[0]?.message ?? `${c.libelle} : saisie invalide.`);
  }
  // Une case décochée n'est pas envoyée par le navigateur : seul « calculer » distingue un
  // formulaire soumis d'une première visite.
  const soumis = premiereValeur(url[NOM_SOUMIS]) !== undefined;
  const inclureMarge = soumis ? premiereValeur(url[NOM_MARGE]) === "oui" : PARAMETRES_DEFAUT.inclureMarge;
  const parametres: Parametres =
    erreurs.length > 0
      ? PARAMETRES_DEFAUT
      : {
          fondsPropresT1: valeurs.fondsPropresT1!,
          seuilSotEve: valeurs.seuilSotEve!,
          seuilSotNii: valeurs.seuilSotNii!,
          poidsGains: valeurs.poidsGains!,
          inclureMarge,
        };
  return { parametres, erreurs, affichage, inclureMarge };
}

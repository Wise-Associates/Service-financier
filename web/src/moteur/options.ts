/**
 * Options automatiques : caps et floors (PDF p. 14).
 *
 * Black (log-normal) et Bachelier (normal) pour les options simples ; les options dépendantes
 * du chemin demandent un arbre ou un Monte Carlo calibré et sont hors du périmètre de ce module.
 *
 * Pour entrer dans ΔEVE = Σ D·CF, chaque caplet est représenté par son flux équivalent certain
 * (prix du caplet / D(t_paiement)) à sa date de paiement : la somme actualisée redonne le prix.
 */

import { type Flux, type Position, datesRegulieres } from "./positions";
import type { MarcheDevise } from "./scenarios";
import { densiteNormale, indiceInsertion, repartitionNormale, somme } from "./tableau";

export type Modele = "black" | "bachelier";

function verifierCp(cp: number): void {
  if (cp !== 1 && cp !== -1) throw new Error("cp = 1 (call) ou −1 (put)");
}

/** Prix Black d'un call (cp=1) ou put (cp=−1) sur forward F, non actualisé si df=1. */
export function black76(F: number, K: number, T: number, vol: number, df = 1, cp = 1): number {
  verifierCp(cp);
  if (F <= 0 || K <= 0) throw new Error("Black : forward et strike strictement positifs (utiliser Bachelier sinon)");
  if (T <= 0 || vol <= 0) return df * Math.max(cp * (F - K), 0);
  const s = vol * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * s * s) / s;
  const d2 = d1 - s;
  return df * cp * (F * repartitionNormale(cp * d1) - K * repartitionNormale(cp * d2));
}

/** Prix Bachelier (vol normale, en unités de taux) : valable pour des taux négatifs. */
export function bachelier(F: number, K: number, T: number, volNormale: number, df = 1, cp = 1): number {
  verifierCp(cp);
  if (T <= 0 || volNormale <= 0) return df * Math.max(cp * (F - K), 0);
  const s = volNormale * Math.sqrt(T);
  const d = (F - K) / s;
  return df * (cp * (F - K) * repartitionNormale(cp * d) + s * densiteNormale(d));
}

export interface CaracteristiquesCapFloor {
  identifiant: string;
  devise: string;
  sens: 1 | -1;
  notionnel: number;
  strike: number;
  maturite: number;
  frequence: number;
  vol: number;
  modele?: Modele;
  cp?: 1 | -1;
  index?: string | null;
  categorie?: string;
}

/**
 * Cap (cp=1) ou floor (cp=−1) sur un index, caplets sur [tₖ₋₁ ; tₖ], fixés en tₖ₋₁.
 * sens = +1 option achetée, −1 option vendue. Le premier caplet, déjà fixé à l'arrêté, est exclu.
 * Volatilité constante par simplicité : une surface se branche en remplaçant `vol`.
 */
export class CapFloor implements Position {
  readonly identifiant: string;
  readonly devise: string;
  readonly sens: 1 | -1;
  readonly notionnel: number;
  readonly strike: number;
  readonly maturite: number;
  readonly frequence: number;
  readonly vol: number;
  readonly modele: Modele;
  readonly cp: 1 | -1;
  readonly index: string | null;
  readonly categorie: string;

  constructor(c: CaracteristiquesCapFloor) {
    this.identifiant = c.identifiant;
    this.devise = c.devise;
    this.sens = c.sens;
    this.notionnel = c.notionnel;
    this.strike = c.strike;
    this.maturite = c.maturite;
    this.frequence = c.frequence;
    this.vol = c.vol;
    this.modele = c.modele ?? "bachelier";
    this.cp = c.cp ?? 1;
    this.index = c.index ?? null;
    this.categorie = c.categorie ?? "option_automatique";
    Object.freeze(this);
  }

  dates(): number[] {
    return datesRegulieres(this.maturite, this.frequence);
  }

  /** Dates de paiement et prix (actualisés, non signés) des caplets non encore fixés. */
  prixCaplets(marche: MarcheDevise): { fins: number[]; prix: number[] } {
    const dates = this.dates();
    const fins = dates.slice(1);
    const proj = marche.courbeIndex(this.index);
    const prix = fins.map((b, k) => {
      const a = dates[k]!;
      const F = proj.forward(a, b);
      const p =
        this.modele === "black"
          ? black76(F, this.strike, a, this.vol, 1, this.cp)
          : bachelier(F, this.strike, a, this.vol, 1, this.cp);
      return this.notionnel * (b - a) * marche.actualisation.facteurActualisation(b) * p;
    });
    return { fins, prix };
  }

  prix(marche: MarcheDevise): number {
    return this.sens * somme(this.prixCaplets(marche).prix);
  }

  flux(marche: MarcheDevise): Flux {
    const { fins, prix } = this.prixCaplets(marche);
    return {
      dates: fins,
      interets: prix.map((p, k) => this.sens * (p / marche.actualisation.facteurActualisation(fins[k]!))),
      principal: fins.map(() => 0),
    };
  }

  /** Paiements attendus (équivalents certains) des caplets payés dans chaque période de la grille. */
  interets(marche: MarcheDevise, _marcheBase: MarcheDevise | undefined, grille: readonly number[]): number[] {
    const f = this.flux(marche);
    const res = new Array<number>(grille.length - 1).fill(0);
    f.dates.forEach((d, k) => {
      const j = indiceInsertion(grille, d, "gauche") - 1;
      if (j >= 0 && j < res.length) res[j] = res[j]! + f.interets[k]!;
    });
    return res;
  }

  /** Une option n'a pas de nominal qui reprice : elle n'entre pas dans les gaps. */
  echeancierRepricing(): { dates: number[]; montants: number[] } {
    return { dates: [], montants: [] };
  }
}

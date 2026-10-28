/**
 * Démonstration de bout en bout sur un bilan FICTIF (montants en millions d'euros/dollars).
 *
 * Import et contrôles C01–C02, calcul (courbes, chocs, ΔEVE, ΔNII, comportemental, options),
 * contrôles de calcul (C04 à C08), approche standardisée et SOT, sensibilités. Aucune I/O : la page appelle `executer` à chaque requête.
 */

import { DepotNonEcheance, PretRemboursementAnticipe } from "@/moteur/comportemental";
import {
  type Contexte,
  type EntreeJournal,
  type Enregistrement,
  type Hypothese,
  Severite,
  approuver,
  bloquants,
  controleCoherence,
  controleCompletude,
  controleConservationFlux,
  controleDoublons,
  controleHypotheses,
  controlePerimetre,
  controleQualite,
  controleRapprochement,
  controleSigne,
  controleVariation,
  empreinte,
  encoursSigne,
} from "@/moteur/controles";
import { CourbeZero, bootstrapSwaps } from "@/moteur/courbes";
import { type Marches, type ResultatMesure, calculerDeltaEve, calculerDeltaNii } from "@/moteur/mesures";
import { CapFloor } from "@/moteur/options";
import { Instrument, type Position } from "@/moteur/positions";
import { CHOCS_BALE, MarcheDevise } from "@/moteur/scenarios";
import { type Gaps, type Krd, deltaPvRisqueBase, gapsRepricing, krd, pv01 } from "@/moteur/sensibilites";
import {
  type ResultatSot,
  type ResultatStandardise,
  calculerDeltaEveStandardise,
  controleValeursAberrantes,
} from "@/moteur/standardise";
import { VERSION_MOTEUR } from "@/moteur/version";

export const DATE_ARRETE = "2026-09-30";

/**
 * Paramètres que l'utilisateur peut faire varier.
 *
 * Fonds propres fictifs. Seuils SOT (15 % du Tier 1 pour ΔEVE, 5 % pour ΔNII) et pondération des
 * gains à 50 % : RTS UE 2024/856 et BCBS d368, à confirmer (PDF p. 15). Le PDF impose de choisir
 * explicitement le traitement des marges commerciales (p. 11).
 */
export interface Parametres {
  readonly fondsPropresT1: number;
  readonly inclureMarge: boolean;
  readonly seuilSotEve: number;
  readonly seuilSotNii: number;
  readonly poidsGains: number;
}

export const PARAMETRES_DEFAUT: Parametres = Object.freeze({
  fondsPropresT1: 1_200,
  inclureMarge: false,
  seuilSotEve: 0.15,
  seuilSotNii: 0.05,
  poidsGains: 0.5,
});

export function marches(): Marches {
  const n = Array.from({ length: 30 }, (_, k) => k + 1);
  const eurOis = bootstrapSwaps(
    n,
    n.map((k) => 0.0215 + 0.0011 * Math.min(k, 10) - 0.00002 * k * k),
  );
  const eur3m = new CourbeZero([0.25, 1, 5, 10, 30], [0.023, 0.0236, 0.0262, 0.0291, 0.03]);
  const usd = new CourbeZero([0.25, 1, 2, 5, 10, 30], [0.041, 0.0395, 0.0378, 0.0372, 0.0389, 0.0405]);
  return {
    EUR: new MarcheDevise("EUR", eurOis, { EURIBOR3M: eur3m }),
    USD: new MarcheDevise("USD", usd, { SOFR: usd }),
  };
}

export function portefeuille(): Position[] {
  return [
    new PretRemboursementAnticipe({
      identifiant: "IMMO-01",
      devise: "EUR",
      encours: 4_000,
      taux: 0.0325,
      maturite: 18,
      marge: 0.009,
      cprMin: 0.03,
      cprMax: 0.22,
      pente: 350,
    }),
    new Instrument({
      identifiant: "PRO-VAR-01",
      categorie: "pret_entreprise",
      devise: "EUR",
      sens: 1,
      encours: 1_800,
      taux: 0.0335,
      maturite: 5,
      frequence: 4,
      amortissement: "lineaire",
      index: "EURIBOR3M",
      marge: 0.011,
    }),
    new Instrument({
      identifiant: "PRO-FIX-01",
      categorie: "pret_entreprise",
      devise: "EUR",
      sens: 1,
      encours: 900,
      taux: 0.039,
      maturite: 7,
      frequence: 12,
      amortissement: "annuite",
      marge: 0.012,
      dureeRenouvellement: 7,
    }),
    new Instrument({
      identifiant: "TIT-OAT-01",
      categorie: "titre",
      devise: "EUR",
      sens: 1,
      encours: 1_500,
      taux: 0.0275,
      maturite: 9,
    }),
    new Instrument({
      identifiant: "TIT-UST-01",
      categorie: "titre",
      devise: "USD",
      sens: 1,
      encours: 600,
      taux: 0.04,
      maturite: 4,
      frequence: 2,
    }),
    new Instrument({
      identifiant: "DAT-01",
      categorie: "depot_terme",
      devise: "EUR",
      sens: -1,
      encours: 1_400,
      taux: 0.024,
      maturite: 1.5,
      frequence: 1,
      marge: -0.002,
      dureeRenouvellement: 1,
    }),
    new DepotNonEcheance({
      identifiant: "DAV-PART",
      devise: "EUR",
      encours: 3_500,
      partStable: 0.75,
      tauxServi: 0.0025,
      beta: 0.35,
      dureeVieStable: 4.5,
    }),
    new DepotNonEcheance({
      identifiant: "DAV-USD",
      devise: "USD",
      encours: 450,
      partStable: 0.6,
      tauxServi: 0.015,
      beta: 0.5,
      dureeVieStable: 3,
      index: "SOFR",
    }),
    new Instrument({
      identifiant: "EMTN-01",
      categorie: "emission",
      devise: "EUR",
      sens: -1,
      encours: 2_200,
      taux: 0.03,
      maturite: 6,
    }),
    // Swap emprunteur de taux fixe : jambe fixe payée, jambe variable reçue.
    new Instrument({
      identifiant: "SWP-01-FIXE",
      categorie: "derive",
      devise: "EUR",
      sens: -1,
      encours: 2_500,
      taux: 0.027,
      maturite: 8,
    }),
    new Instrument({
      identifiant: "SWP-01-VAR",
      categorie: "derive",
      devise: "EUR",
      sens: 1,
      encours: 2_500,
      taux: 0.0231,
      maturite: 8,
      frequence: 4,
      amortissement: "in_fine",
      index: "EURIBOR3M",
    }),
    new CapFloor({
      identifiant: "CAP-VENDU-01",
      devise: "EUR",
      sens: -1,
      notionnel: 500,
      strike: 0.035,
      maturite: 5,
      frequence: 4,
      vol: 0.008,
      modele: "bachelier",
      cp: 1,
      index: "EURIBOR3M",
    }),
    new Instrument({
      identifiant: "HB-ENG-01",
      categorie: "hors_bilan",
      devise: "EUR",
      sens: 1,
      encours: 600,
      taux: 0.036,
      maturite: 3,
      frequence: 4,
      facteurConversion: 0.4,
    }),
  ];
}

/** Extraction source fictive telle qu'elle arriverait des systèmes ALM et comptables. */
export function importSource(): Enregistrement[] {
  return portefeuille().map((p) => {
    if (p instanceof CapFloor) {
      return {
        identifiant: p.identifiant,
        categorie: p.categorie,
        devise: p.devise,
        encours: p.notionnel,
        maturite: p.maturite,
        taux: p.strike,
      };
    }
    if (p instanceof DepotNonEcheance) {
      return {
        identifiant: p.identifiant,
        categorie: p.categorie,
        devise: p.devise,
        encours: p.encours,
        maturite: p.maturiteMax,
        taux: p.tauxServi,
      };
    }
    if (p instanceof Instrument || p instanceof PretRemboursementAnticipe) {
      return {
        identifiant: p.identifiant,
        categorie: p.categorie,
        devise: p.devise,
        encours: p.encours,
        maturite: p.maturite,
        taux: p.taux,
      };
    }
    throw new Error(`type de position non pris en charge : ${p.identifiant}`);
  });
}

export interface Sensibilites {
  readonly pv01Eur: number;
  readonly pv01Usd: number;
  readonly krdEur: readonly Krd[];
  readonly baseEuribor: number;
}

export interface Resultats {
  readonly statut: "calcule";
  readonly eve: ResultatMesure;
  readonly nii: ResultatMesure;
  readonly std: ResultatStandardise;
  readonly sotEve: ResultatSot;
  readonly sotNii: ResultatSot;
  readonly sens: Sensibilites;
  readonly gaps: Gaps;
  readonly journal: readonly EntreeJournal[];
  readonly versions: Readonly<Record<string, string | boolean>>;
  readonly trace: string;
}

/** Une anomalie bloquante à l'import a arrêté la chaîne avant le calcul (PDF p. 7). */
export interface CalculBloque {
  readonly statut: "bloque";
  readonly journal: readonly EntreeJournal[];
}

/** Enchaîne import, contrôles, calculs et sensibilités sur le bilan fictif, sans I/O. */
export function executer(params: Parametres, maintenant: string): Resultats | CalculBloque {
  const ctx: Contexte = { periode: DATE_ARRETE, maintenant, responsable: "equipe.production" };
  let journal: EntreeJournal[] = [];
  const m = marches();
  const pos = portefeuille();
  const source = importSource();
  const categories = [...new Set(source.map((e) => String(e["categorie"])))];

  // 1. Import : C01 complétude, qualité, doublons ; C02 périmètre
  const champs = Object.fromEntries(categories.map((c) => [c, ["devise", "encours", "maturite", "taux"]]));
  const ids = source.map((e) => String(e["identifiant"]));
  journal.push(...controleCompletude(source, champs, ctx));
  journal.push(...controleQualite(source, Object.keys(m), ctx));
  journal.push(...controleDoublons(ids, ctx));
  journal.push(
    ...controlePerimetre(
      ids,
      pos.map((p) => p.identifiant),
      ctx,
    ),
  );
  if (bloquants(journal).length > 0) return { statut: "bloque", journal };

  // 2. Calcul
  const eve = calculerDeltaEve(pos, m, CHOCS_BALE, { inclureMarge: params.inclureMarge });
  const nii = calculerDeltaNii(pos, m, CHOCS_BALE);
  const std = calculerDeltaEveStandardise(pos, m, CHOCS_BALE, {
    inclureMarge: params.inclureMarge,
    poidsGains: params.poidsGains,
  });
  const sotEve = controleValeursAberrantes(
    Object.fromEntries(Object.keys(std.deltaParScenarioDevise).map((s) => [s, std.deltaAgrege(s)])),
    params.fondsPropresT1,
    params.seuilSotEve,
    "ΔEVE standardisé",
  );
  const sotNii = controleValeursAberrantes(
    Object.fromEntries(nii.listeScenarios.map((s) => [s, nii.delta(s)])),
    params.fondsPropresT1,
    params.seuilSotNii,
    "ΔNII",
  );

  // 3. Contrôles de calcul : C04 rapprochement, C05 conservation, C06 hypothèses, C07 variation, C08 signes
  const totauxSource: Record<string, number> = {};
  const totauxCalcul: Record<string, number> = {};
  for (const p of pos) {
    const attendu = encoursSigne(p);
    if (attendu === null) continue;
    const brut = source.find((e) => e["identifiant"] === p.identifiant)?.["encours"];
    if (typeof brut !== "number") throw new Error(`${p.identifiant} : encours source absent malgré C01`);
    const signe = attendu > 0 ? 1 : -1;
    const facteur = p instanceof Instrument ? p.facteurConversion : 1;
    totauxSource[p.devise] = (totauxSource[p.devise] ?? 0) + signe * brut * facteur;
    totauxCalcul[p.devise] = (totauxCalcul[p.devise] ?? 0) + attendu;
  }
  journal.push(...controleRapprochement(totauxSource, totauxCalcul, ctx, 0.5));
  journal.push(...controleConservationFlux(pos, m, ctx));
  const hypotheses: Hypothese[] = [
    { nom: "Écoulement et bêta des dépôts à vue", version: "2026.2", valideJusquAu: "2026-12-31", approbateur: "comite.alm" },
    { nom: "Courbe de CPR des prêts immobiliers", version: "2026.1", valideJusquAu: "2026-12-31", approbateur: "comite.alm" },
  ];
  journal.push(...controleHypotheses(hypotheses, DATE_ARRETE, ctx));
  const { perte } = eve.perteMaximale();
  const precedent = -perte * 0.8; // arrêté précédent fictif
  journal.push(...controleVariation("ΔEVE perte maximale", -perte, precedent, ctx, 0.1, 5));
  for (const s of eve.listeScenarios) {
    journal.push(...controleSigne(`ΔEVE ${s}`, eve.delta(s), "libre", ctx));
    const totalDevises = [...eve.decomposition(s, "devise").values()].reduce((a, b) => a + b, 0);
    journal.push(...controleCoherence(`ΔEVE ${s} = Σ devises`, eve.delta(s), totalDevises, ctx, 1e-6));
  }

  // Revue de second niveau : la variation majeure est expliquée et acceptée par un tiers.
  journal = journal.map((e) =>
    e.idRegle === "C07-VARIATION" && e.severite === Severite.MAJEURE
      ? approuver(
          e,
          "controle.second.niveau",
          "Variation expliquée : arrêté précédent fictif de démonstration",
          ctx.maintenant,
        )
      : e,
  );

  // 4. Sensibilités et explication
  const eur = m["EUR"]!;
  const sens: Sensibilites = {
    pv01Eur: pv01(pos, eur, { inclureMarge: params.inclureMarge }),
    pv01Usd: pv01(pos, m["USD"]!, { inclureMarge: params.inclureMarge }),
    krdEur: krd(pos, eur, [0.25, 1, 2, 5, 10, 20], { inclureMarge: params.inclureMarge }),
    baseEuribor: deltaPvRisqueBase(pos, eur, "EURIBOR3M", 0.001, { inclureMarge: params.inclureMarge }),
  };
  const gaps = gapsRepricing(pos, eur);

  const versions = {
    moteur: VERSION_MOTEUR,
    inclure_marge: params.inclureMarge,
    chocs: "BCBS d368 (paramètres)",
    plancher: "RTS UE 2024/856 (paramètres)",
    arrete: DATE_ARRETE,
  };
  const trace = empreinte({ source, versions, parametres: params });
  return { statut: "calcule", eve, nii, std, sotEve, sotNii, sens, gaps, journal, versions, trace };
}

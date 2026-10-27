import { describe, expect, it } from "vitest";

import {
  type Contexte,
  type EntreeJournal,
  Severite,
  Statut,
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
  controleReproductibilite,
  controleSigne,
  controleVariation,
  empreinte,
} from "./controles";
import { marchePlat } from "./fixtures-tests";
import { Instrument } from "./positions";

const CTX: Contexte = { periode: "2026-09-30", maintenant: "2026-10-27T09:00:00", responsable: "equipe.production" };
const CHAMPS = { pret: ["encours", "devise", "taux", "maturite"] };
const severites = (j: readonly EntreeJournal[]): string[] => j.map((e) => e.severite);

describe("contrôles", () => {
  it("complétude : champ manquant et catégorie inconnue", () => {
    const j = controleCompletude(
      [
        { identifiant: "P1", categorie: "pret", encours: 10, devise: "EUR", taux: null, maturite: 2 },
        { identifiant: "X1", categorie: "inconnue" },
      ],
      CHAMPS,
      CTX,
    );
    expect(j.map((e) => e.idRegle)).toEqual(["C01-COMPLETUDE", "C01-CATEGORIE"]);
    expect(j[0]!.valeurObservee).toContain("taux");
    expect(severites(j)).toEqual([Severite.BLOQUANTE, Severite.BLOQUANTE]);
  });

  it("un contrôle passé laisse une trace Information", () => {
    const j = controleCompletude(
      [{ identifiant: "P1", categorie: "pret", encours: 1, devise: "EUR", taux: 0.01, maturite: 1 }],
      CHAMPS,
      CTX,
    );
    expect(severites(j)).toEqual([Severite.INFORMATION]);
    expect(j[0]!.statut).toBe(Statut.JOURNALISEE);
    expect(j[0]!.horodatage).toBe(CTX.maintenant);
  });

  it("qualité : devise, encours et taux aberrant", () => {
    const j = controleQualite([{ identifiant: "P1", devise: "XXX", encours: -5, maturite: 1, taux: 0.45 }], ["EUR"], CTX);
    expect(Object.fromEntries(j.map((e) => [e.idRegle, e.severite]))).toEqual({
      "C01-DEVISE": Severite.BLOQUANTE,
      "C01-ENCOURS": Severite.BLOQUANTE,
      "C01-TAUX-ABERRANT": Severite.MAJEURE,
    });
  });

  it("doublons et périmètre", () => {
    expect(severites(controleDoublons(["A", "B", "A"], CTX))).toEqual([Severite.BLOQUANTE]);
    const j = controlePerimetre(["A", "B"], ["B", "C"], CTX);
    expect(j.map((e) => [e.idRegle, e.objet])).toEqual([
      ["C02-ABSENT", "A"],
      ["C02-HORS-SOURCE", "C"],
    ]);
  });

  it("rapprochement : trois niveaux", () => {
    const j = controleRapprochement({ EUR: 1000, USD: 500, GBP: 10 }, { EUR: 1000, USD: 500.4, GBP: 12 }, CTX, 1);
    expect(Object.fromEntries(j.map((e) => [e.objet, e.severite]))).toEqual({
      USD: Severite.AVERTISSEMENT,
      GBP: Severite.BLOQUANTE,
    });
  });

  it("conservation des flux", () => {
    const p = new Instrument({
      identifiant: "P1",
      categorie: "pret",
      devise: "EUR",
      sens: 1,
      encours: 100,
      taux: 0.03,
      maturite: 10,
      frequence: 12,
      amortissement: "annuite",
    });
    expect(severites(controleConservationFlux([p], { EUR: marchePlat() }, CTX))).toEqual([Severite.INFORMATION]);
  });

  it("empreinte stable et reproductibilité", () => {
    const a = empreinte({ b: 1, a: [1.5, "x"] });
    expect(a).toBe(empreinte({ a: [1.5, "x"], b: 1 }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(severites(controleReproductibilite("ΔEVE", a, empreinte({ a: 1 }), CTX))).toEqual([Severite.BLOQUANTE]);
  });

  it("hypothèses non approuvées ou périmées", () => {
    const j = controleHypotheses([{ nom: "bêta DAV", version: "3", valideJusquAu: "2026-06-30", approbateur: "" }], "2026-09-30", CTX);
    expect(j.map((e) => e.idRegle)).toEqual(["C06-APPROBATION", "C06-VALIDITE"]);
  });

  it("variation non expliquée = Majeure, expliquée = journalisée", () => {
    expect(severites(controleVariation("ΔEVE", -30, -10, CTX, 0.1, 1))).toEqual([Severite.MAJEURE]);
    const j = controleVariation("ΔEVE", -30, -10, CTX, 0.1, 1, "couverture échue");
    expect(severites(j)).toEqual([Severite.INFORMATION]);
    expect(j[0]!.justification).toBe("couverture échue");
  });

  it("le signe suit la convention de la rubrique", () => {
    expect(severites(controleSigne("ΔEVE", -5, "libre", CTX))).toEqual([Severite.INFORMATION]);
    expect(severites(controleSigne("Encours", -5, "positif", CTX))).toEqual([Severite.BLOQUANTE]);
    expect(severites(controleCoherence("total", 10, 10.5, CTX, 0.1))).toEqual([Severite.BLOQUANTE]);
  });

  it("approbation à quatre yeux ; une bloquante ne s'approuve pas", () => {
    const majeure = controleVariation("ΔNII", -30, -10, CTX, 0.1, 1)[0]!;
    expect(() => approuver(majeure, CTX.responsable, "ok", CTX.maintenant)).toThrow();
    expect(() => approuver(majeure, "controle.n2", "  ", CTX.maintenant)).toThrow();
    const acceptee = approuver(majeure, "controle.n2", "hausse des dépôts expliquée", CTX.maintenant);
    expect(acceptee.statut).toBe(Statut.ACCEPTEE);
    expect(bloquants([acceptee])).toEqual([]);
    const bloquante = controleDoublons(["A", "A"], CTX)[0]!;
    expect(() => approuver(bloquante, "controle.n2", "urgent", CTX.maintenant)).toThrow();
    expect(bloquants([bloquante])).toEqual([bloquante]);
    expect(Object.keys(bloquante).sort()).toEqual(
      [
        "idRegle",
        "objet",
        "periode",
        "valeurAttendue",
        "valeurObservee",
        "severite",
        "justification",
        "responsable",
        "horodatage",
        "approbateur",
        "statut",
      ].sort(),
    );
  });
});

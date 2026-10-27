import { describe, expect, it } from "vitest";

import { type Contexte, approuver, controleDoublons, controleRapprochement, controleVariation } from "@/moteur/controles";

import { montantSigne, pourcentageSeuil, statutControles, valeurJournal } from "./presentation";

const CTX: Contexte = { periode: "2026-09-30", maintenant: "2026-10-27T09:00:00", responsable: "equipe.production" };

describe("présentation", () => {
  it("montants signés au format français", () => {
    expect(montantSigne(-1234.56)).toBe("−1 234,6");
    expect(montantSigne(12.04)).toBe("+12,0");
    expect(montantSigne(-0.04)).toBe("0,0");
  });

  it("statut des contrôles : bloquante ouverte, majeure acceptée, non exécuté", () => {
    const majeure = controleVariation("ΔEVE", -30, -10, CTX, 0.1, 1)[0]!;
    const journal = [...controleDoublons(["A", "A"], CTX), approuver(majeure, "controle.n2", "expliqué", CTX.maintenant)];
    const parCode = Object.fromEntries(statutControles(journal, "abc").map((s) => [s.code, s]));
    expect(parCode["C01"]).toMatchObject({ statut: "Bloquante : 1 anomalie, 1 ouverte", ton: "ko" });
    expect(parCode["C07"]).toMatchObject({ statut: "Majeure : 1 anomalie, acceptée par un tiers", ton: "attention" });
    expect(parCode["C01"]!.ton).toBe("ko");
    expect(parCode["C09"]).toMatchObject({ statut: "1 anomalie acceptée (approbateur : controle.n2)", ton: "attention" });
    expect(parCode["C04"]!.ton).toBe("info");
  });

  it("valeurs du journal au format français", () => {
    expect(valeurJournal("-168.98741566469107")).toBe("−168,99");
    expect(valeurJournal("1200")).toBe("1\u202f200");
    expect(valeurJournal("écart <= 0.000001")).toBe("écart ≤ 0,000001");
    expect(valeurJournal(">= 2026-09-30")).toBe("≥ 2026-09-30");
    expect(valeurJournal("C01-DOUBLON")).toBe("C01-DOUBLON");
  });

  it("C09 signale une majeure ouverte ; un avertissement ouvert n'est pas rouge", () => {
    const majeure = controleVariation("ΔEVE", -30, -10, CTX, 0.1, 1);
    const avertissement = controleRapprochement({ EUR: 100 }, { EUR: 100.4 }, CTX, 1);
    const parCode = Object.fromEntries(statutControles([...majeure, ...avertissement], "abc").map((s) => [s.code, s]));
    expect(parCode["C09"]).toMatchObject({ statut: "1 anomalie majeure en attente d'approbation", ton: "ko" });
    expect(parCode["C04"]!.ton).toBe("attention");
  });

  it("seuils affichés avec leurs décimales", () => {
    expect(pourcentageSeuil(0.125)).toBe("12,5\u00a0%");
    expect(pourcentageSeuil(0.15)).toBe("15\u00a0%");
  });
});

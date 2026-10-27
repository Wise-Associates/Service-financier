import { describe, expect, it } from "vitest";

import { type Contexte, approuver, controleDoublons, controleVariation } from "@/moteur/controles";

import { montantSigne, statutControles } from "./presentation";

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
    expect(parCode["C09"]).toMatchObject({ statut: "1 anomalie acceptée par controle.n2", ton: "ok" });
    expect(parCode["C04"]!.ton).toBe("info");
  });
});

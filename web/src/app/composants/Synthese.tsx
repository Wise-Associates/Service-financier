import type { Resultats } from "@/demo/banqueFictive";
import { libelleScenario, nombre, pourcentage, pourcentageSeuil, type Ton } from "@/demo/presentation";
import { bloquants } from "@/moteur/controles";

interface Carte {
  readonly titre: string;
  readonly valeur: string;
  readonly detail: string;
  readonly ton: Ton | "";
}

export function Synthese({ r }: { r: Resultats }) {
  const pire = r.eve.perteMaximale();
  const nbBloquants = bloquants(r.journal).length;
  const cartes: Carte[] = [
    { titre: "Perte ΔEVE maximale", valeur: `${nombre(pire.perte)} M`, detail: libelleScenario(pire.scenario), ton: "" },
    ...[r.sotEve, r.sotNii].map(
      (sot): Carte => ({
        titre: `SOT ${sot.indicateur}`,
        valeur: pourcentage(sot.ratio),
        detail: `${sot.depassement ? "Dépassement du seuil" : "Sous le seuil"} de ${pourcentageSeuil(sot.seuil)} · ${libelleScenario(sot.scenario)}`,
        ton: sot.depassement ? "ko" : "ok",
      }),
    ),
    {
      titre: "Anomalies bloquantes",
      valeur: String(nbBloquants),
      detail: nbBloquants === 0 ? "La remise peut être préparée" : "La remise est bloquée",
      ton: nbBloquants === 0 ? "ok" : "ko",
    },
  ];
  return (
    <section className="synthese" aria-label="Synthèse">
      <div className="cartes">
        {cartes.map((c) => (
          <div className={`carte ${c.ton}`} key={c.titre}>
            <p className="carte-titre">{c.titre}</p>
            <p className="carte-valeur">{c.valeur}</p>
            <p className="carte-detail">{c.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

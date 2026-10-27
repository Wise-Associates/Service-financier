import { type CalculBloque, type Resultats, executer } from "@/demo/banqueFictive";
import { nombre } from "@/demo/presentation";
import { type ParametresUrl, lireSaisie } from "@/demo/saisie";
import type { ResultatMesure } from "@/moteur/mesures";

import { Controles } from "./composants/Controles";
import { Formulaire } from "./composants/Formulaire";
import { Synthese } from "./composants/Synthese";
import { type LigneMesure, TableauMesure } from "./composants/TableauMesure";

function lignes(m: ResultatMesure): LigneMesure[] {
  return m.listeScenarios.map((s) => ({ scenario: s, parDevise: m.decomposition(s, "devise"), total: m.delta(s) }));
}

function Alerte({ titre, messages }: { titre: string; messages: readonly string[] }) {
  return (
    <div className="alerte" role="alert">
      <p>
        <strong>{titre}</strong>
        {messages.length > 0 ? " Vérifiez les points suivants :" : null}
      </p>
      {messages.length > 0 ? (
        <ul>
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Resultat({ r }: { r: Resultats }) {
  const devises = [...new Set(r.eve.listeScenarios.flatMap((s) => [...r.eve.decomposition(s).keys()]))].sort();
  const std: LigneMesure[] = Object.entries(r.std.deltaParScenarioDevise).map(([s, d]) => ({
    scenario: s,
    parDevise: new Map(Object.entries(d)),
    total: r.std.deltaAgrege(s),
  }));
  const marges = r.versions["inclure_marge"] ? "incluses" : "exclues";
  return (
    <>
      <Synthese r={r} />
      <TableauMesure
        id="titre-eve"
        titre="ΔEVE par choc"
        intro={`Revalorisation complète, marges commerciales ${marges}. Δ = scénario − base : un Δ négatif est une perte. EVE de base : ${nombre(r.eve.total())} M.`}
        lignes={lignes(r.eve)}
        devises={devises}
      />
      <TableauMesure
        id="titre-nii"
        titre="ΔNII à 12 mois, bilan constant"
        intro={`NII de base : ${nombre(r.nii.total())} M.`}
        lignes={lignes(r.nii)}
        devises={devises}
      />
      <TableauMesure
        id="titre-standardise"
        titre="ΔEVE standardisé (test des valeurs aberrantes)"
        intro="Le total agrège les devises en pondérant les gains selon le paramètre ci-dessus."
        lignes={std}
        devises={devises}
      />
      <Controles journal={r.journal} trace={r.trace} />
    </>
  );
}

function calculer(params: Parameters<typeof executer>[0]): Resultats | CalculBloque | Error {
  try {
    return executer(params, new Date().toISOString());
  } catch (e) {
    // Le moteur refuse certaines combinaisons (paramètres hors domaine) : on l'affiche, et la pile
    // complète reste dans les journaux du serveur pour le diagnostic.
    console.error("Calcul IRRBB refusé par le moteur", e);
    return e instanceof Error ? e : new Error(String(e));
  }
}

export default async function Page({ searchParams }: { searchParams: Promise<ParametresUrl> }) {
  const saisie = lireSaisie(await searchParams);
  const resultat = saisie.erreurs.length > 0 ? null : calculer(saisie.parametres);
  return (
    <>
      <header className="bandeau">
        <div className="conteneur">
          <p className="badge">Données fictives</p>
          <h1>Simulation IRRBB : banque fictive</h1>
          {resultat !== null && !(resultat instanceof Error) && resultat.statut === "calcule" ? (
            <p className="meta">
              Arrêté {String(resultat.versions["arrete"])} · moteur {String(resultat.versions["moteur"])} · montants en
              millions de la devise
            </p>
          ) : null}
        </div>
      </header>
      <main className="conteneur">
        {/* L'alerte précède le formulaire pour être visible sans défiler sur mobile. */}
        {saisie.erreurs.length > 0 ? <Alerte titre="Le calcul n'a pas été lancé." messages={saisie.erreurs} /> : null}
        <Formulaire saisie={saisie} />
        {resultat instanceof Error ? (
          <Alerte titre="Le moteur a refusé le calcul." messages={[resultat.message]} />
        ) : resultat?.statut === "bloque" ? (
          <>
            <Alerte titre="Le calcul est bloqué par une anomalie d'import. Consultez le journal ci-dessous." messages={[]} />
            <Controles journal={resultat.journal} trace="" />
          </>
        ) : resultat?.statut === "calcule" ? (
          <Resultat r={resultat} />
        ) : null}
      </main>
      <footer className="conteneur pied">
        <p>
          Outil de démonstration. Les paramètres réglementaires sont à confirmer sur les textes en vigueur ; les limites
          connues du moteur sont listées dans <code>docs/limites.md</code>. Ne pas utiliser pour une remise
          réglementaire.
        </p>
      </footer>
    </>
  );
}

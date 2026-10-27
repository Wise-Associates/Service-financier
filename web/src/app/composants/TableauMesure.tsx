import { libelleScenario, montantSigne } from "@/demo/presentation";

export interface LigneMesure {
  readonly scenario: string;
  readonly parDevise: ReadonlyMap<string, number>;
  readonly total: number;
}

function Montant({ valeur, total = false }: { valeur: number; total?: boolean }) {
  const ton = Math.abs(valeur) < 0.05 ? "" : valeur < 0 ? "perte" : "gain";
  return <span className={[ton, total ? "total" : ""].filter(Boolean).join(" ")}>{montantSigne(valeur)}</span>;
}

/** Barre divergente autour de zéro : à gauche une perte, à droite un gain. */
function Barre({ valeur, echelle }: { valeur: number; echelle: number }) {
  if (echelle <= 0) return null;
  const largeur = 50 * Math.min(Math.abs(valeur) / echelle, 1);
  const debut = valeur < 0 ? 50 - largeur : 50;
  return (
    <svg className="barre" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <rect className={valeur < 0 ? "barre-perte" : "barre-gain"} x={debut} y={1} width={largeur} height={8} />
      <line className="axe" x1={50} y1={0} x2={50} y2={10} />
    </svg>
  );
}

export function TableauMesure({
  id,
  titre,
  intro,
  lignes,
  devises,
}: {
  /** Identifiant HTML du titre, explicite pour rester stable et unique. */
  id: string;
  titre: string;
  intro: string;
  lignes: readonly LigneMesure[];
  devises: readonly string[];
}) {
  const echelle = Math.max(0, ...lignes.map((l) => Math.abs(l.total)));
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{titre}</h2>
      <p className="intro">{intro}</p>
      <div className="defilement" role="region" aria-labelledby={id} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Scénario</th>
              {devises.map((d) => (
                <th scope="col" className="num" key={d}>
                  {d}
                </th>
              ))}
              <th scope="col" className="num">
                Total
              </th>
              <th scope="col" className="col-barre">
                <span className="sr">Graphique du total</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.scenario}>
                <th scope="row">{libelleScenario(l.scenario)}</th>
                {devises.map((d) => (
                  <td className="num" key={d}>
                    <Montant valeur={l.parDevise.get(d) ?? 0} />
                  </td>
                ))}
                <td className="num">
                  <Montant valeur={l.total} total />
                </td>
                <td className="col-barre">
                  <Barre valeur={l.total} echelle={echelle} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

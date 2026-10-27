import { statutControles } from "@/demo/presentation";
import type { EntreeJournal } from "@/moteur/controles";

export function Controles({ journal, trace }: { journal: readonly EntreeJournal[]; trace: string }) {
  return (
    <section aria-labelledby="titre-controles">
      <h2 id="titre-controles">Contrôles</h2>
      <div className="defilement">
        <table>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Contrôle</th>
              <th scope="col">Statut</th>
            </tr>
          </thead>
          <tbody>
            {statutControles(journal, trace).map((s) => (
              <tr key={s.code}>
                <th scope="row">{s.code}</th>
                <td>{s.libelle}</td>
                <td>
                  <span className={`pastille ${s.ton}`}>{s.statut}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Voir le journal complet ({journal.length} entrées)</summary>
        <div className="defilement">
          <table className="journal">
            <thead>
              <tr>
                {["Règle", "Objet", "Attendu", "Observé", "Sévérité", "Statut", "Justification"].map((t) => (
                  <th scope="col" key={t}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {journal.map((e, i) => (
                <tr key={`${e.idRegle}-${e.objet}-${i}`}>
                  <td>{e.idRegle}</td>
                  <td>{e.objet}</td>
                  <td>{e.valeurAttendue}</td>
                  <td>{e.valeurObservee}</td>
                  <td>{e.severite}</td>
                  <td>{e.statut}</td>
                  <td>{e.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

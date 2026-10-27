import { statutControles, tonSeverite, valeurJournal } from "@/demo/presentation";
import { type EntreeJournal, Severite } from "@/moteur/controles";

export function Controles({ journal, trace }: { journal: readonly EntreeJournal[]; trace: string }) {
  return (
    <section aria-labelledby="titre-controles">
      <h2 id="titre-controles">Contrôles</h2>
      <div className="defilement" role="region" aria-labelledby="titre-controles" tabIndex={0}>
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
        <div className="defilement" role="region" aria-label="Journal complet des contrôles" tabIndex={0}>
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
                  <td>{valeurJournal(e.valeurAttendue)}</td>
                  <td>{valeurJournal(e.valeurObservee)}</td>
                  <td>
                    {e.severite === Severite.INFORMATION ? (
                      e.severite
                    ) : (
                      <span className={`pastille ${tonSeverite(e.severite)}`}>{e.severite}</span>
                    )}
                  </td>
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

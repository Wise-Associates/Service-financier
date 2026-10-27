import Link from "next/link";

import { CHAMPS, NOM_MARGE, NOM_SOUMIS, type Saisie } from "@/demo/saisie";

/** Formulaire en GET : le calcul ne modifie rien et l'URL résume les paramètres utilisés. */
export function Formulaire({ saisie }: { saisie: Saisie }) {
  return (
    <section aria-labelledby="titre-parametres">
      <h2 id="titre-parametres">Paramètres</h2>
      {/* Champs non contrôlés : la clé recrée le formulaire quand la navigation côté client change les
          paramètres (lien « valeurs par défaut »), sinon les anciennes saisies resteraient affichées. */}
      <form method="get" action="/" className="formulaire" key={JSON.stringify(saisie)}>
        <div className="champs">
          {CHAMPS.map((c) => (
            <div className="champ" key={c.nom}>
              <label htmlFor={c.nom}>{c.libelle}</label>
              <input
                id={c.nom}
                name={c.nom}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={saisie.affichage[c.nom]}
                aria-describedby={`${c.nom}-aide`}
                required
              />
              <p className="aide" id={`${c.nom}-aide`}>
                {c.aide}
              </p>
            </div>
          ))}
        </div>
        <div className="case">
          <input id={NOM_MARGE} name={NOM_MARGE} type="checkbox" value="oui" defaultChecked={saisie.inclureMarge} />
          <label htmlFor={NOM_MARGE}>Inclure les marges commerciales dans ΔEVE</label>
        </div>
        <div className="actions">
          <button type="submit" name={NOM_SOUMIS} value="1">
            Recalculer
          </button>
          <Link href="/">Revenir aux valeurs par défaut</Link>
        </div>
      </form>
    </section>
  );
}

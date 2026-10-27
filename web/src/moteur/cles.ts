/**
 * Accès sûrs aux objets indexés par des clés fournies par l'appelant (devise, index, catégorie).
 *
 * Un objet JavaScript hérite de `Object.prototype` : `r["constructor"]` ou `"toString" in r`
 * répondent alors à tort. Le moteur Python, avec ses dict, n'a pas ce piège.
 */

/** Valeur propre de `r` pour la clé `k`, sans remonter la chaîne de prototypes. */
export function propre<T>(r: Readonly<Record<string, T>>, k: string): T | undefined {
  return Object.hasOwn(r, k) ? r[k] : undefined;
}

/** Objet sans prototype, pour accumuler des valeurs sous des clés quelconques (même « __proto__ »). */
export function dictionnaire<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Outils numériques élémentaires, alignés sur le comportement de numpy utilisé par le moteur
 * Python de référence (`src/irrbb`) pour que les deux moteurs donnent les mêmes chiffres.
 */

/** Interpolation linéaire avec extrapolation plate, comme `numpy.interp`. */
export function interp(x: number, xp: readonly number[], fp: readonly number[]): number {
  const n = xp.length;
  if (n === 0 || n !== fp.length) throw new Error("interp : abscisses et ordonnées de même longueur, non vides");
  if (Number.isNaN(x)) return Number.NaN;
  if (x <= xp[0]!) return fp[0]!;
  if (x >= xp[n - 1]!) return fp[n - 1]!;
  // Recherche du segment [xp[j] ; xp[j+1][ contenant x.
  let bas = 0;
  let haut = n - 1;
  while (haut - bas > 1) {
    const milieu = (bas + haut) >> 1;
    if (xp[milieu]! <= x) bas = milieu;
    else haut = milieu;
  }
  const pente = (fp[bas + 1]! - fp[bas]!) / (xp[bas + 1]! - xp[bas]!);
  return pente * (x - xp[bas]!) + fp[bas]!;
}

/** Indice d'insertion dans un tableau trié, comme `numpy.searchsorted`. */
export function indiceInsertion(a: readonly number[], v: number, cote: "gauche" | "droite"): number {
  let bas = 0;
  let haut = a.length;
  while (bas < haut) {
    const milieu = (bas + haut) >> 1;
    const avant = cote === "gauche" ? a[milieu]! < v : a[milieu]! <= v;
    if (avant) bas = milieu + 1;
    else haut = milieu;
  }
  return bas;
}

export function somme(a: readonly number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

export function sommesCumulees(a: readonly number[]): number[] {
  const res: number[] = [];
  let s = 0;
  for (const v of a) {
    s += v;
    res.push(s);
  }
  return res;
}

/** `n` points régulièrement espacés de `debut` à `fin` inclus, comme `numpy.linspace`. */
export function espaceLineaire(debut: number, fin: number, n: number): number[] {
  if (n < 2) throw new Error("espaceLineaire : au moins deux points");
  const pas = (fin - debut) / (n - 1);
  const res = Array.from({ length: n }, (_, i) => debut + i * pas);
  res[n - 1] = fin;
  return res;
}

/** Arrondi à l'entier pair le plus proche en cas d'égalité, comme `round` en Python. */
export function arrondiBancaire(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function produitScalaire(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error("produitScalaire : tableaux de même longueur");
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function estCroissantStrict(a: readonly number[]): boolean {
  for (let i = 1; i < a.length; i++) if (!(a[i]! > a[i - 1]!)) return false;
  return true;
}

/** Fonction de répartition de la loi normale centrée réduite. */
export function repartitionNormale(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function densiteNormale(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Fonction d'erreur. JavaScript n'en fournit pas : développement en série près de 0 et fraction
 * continue de la fonction complémentaire au-delà ; écart mesuré à `math.erf` de Python : au plus
 * quelques ulp (≈ 1,4e-15 en relatif, maximum vers x = 2,3).
 */
export function erf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const a = Math.abs(x);
  if (a < 2.5) {
    // erf(x) = 2/√π · Σ (−1)ⁿ x^(2n+1) / (n! (2n+1))
    let terme = a;
    let s = a;
    for (let n = 1; n < 200; n++) {
      terme *= (-a * a) / n;
      const contribution = terme / (2 * n + 1);
      s += contribution;
      if (Math.abs(contribution) < 1e-17 * Math.abs(s)) break;
    }
    const v = (2 / Math.sqrt(Math.PI)) * s;
    return x < 0 ? -v : v;
  }
  return x < 0 ? -(1 - erfcGrand(a)) : 1 - erfcGrand(a);
}

/** erfc(x) pour x ≥ 2,5 par fraction continue de Lentz. */
function erfcGrand(x: number): number {
  const minuscule = 1e-300;
  let f = x;
  let c = x;
  let d = 0;
  for (let n = 1; n < 500; n++) {
    const an = n / 2;
    d = x + an * d;
    d = d === 0 ? minuscule : d;
    c = x + an / c;
    c = c === 0 ? minuscule : c;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (f * Math.sqrt(Math.PI));
}

/**
 * Moindres carrés min ‖X·b − y‖ par décomposition QR de Householder (X de rang plein en colonnes).
 * Équivalent de `numpy.linalg.lstsq` pour les régressions du module comportemental.
 */
export function moindresCarres(X: readonly (readonly number[])[], y: readonly number[]): number[] {
  const m = X.length;
  const n = X[0]?.length ?? 0;
  if (m !== y.length || m < n || n === 0) throw new Error("moindresCarres : dimensions incohérentes");
  const A = X.map((ligne) => [...ligne]);
  const b = [...y];
  // Seuil de rang relatif, comme le `rcond` par défaut de numpy (ε · max(m, n) · plus grande norme
  // de colonne) : une colonne colinéaire aux autres à l'arrondi près n'est pas identifiable.
  let normeMax = 0;
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += A[i]![j]! ** 2;
    normeMax = Math.max(normeMax, Math.sqrt(s));
  }
  const seuilRang = Number.EPSILON * Math.max(m, n) * normeMax;
  for (let k = 0; k < n; k++) {
    let norme = 0;
    for (let i = k; i < m; i++) norme += A[i]![k]! ** 2;
    norme = Math.sqrt(norme);
    if (norme <= seuilRang) throw new Error("régresseurs colinéaires : coefficients non identifiables");
    const alpha = A[k]![k]! > 0 ? -norme : norme;
    const v = new Array<number>(m).fill(0);
    for (let i = k; i < m; i++) v[i] = A[i]![k]!;
    v[k] = v[k]! - alpha;
    let vv = 0;
    for (let i = k; i < m; i++) vv += v[i]! ** 2;
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += v[i]! * A[i]![j]!;
      const facteur = (2 * s) / vv;
      for (let i = k; i < m; i++) A[i]![j] = A[i]![j]! - facteur * v[i]!;
    }
    let s = 0;
    for (let i = k; i < m; i++) s += v[i]! * b[i]!;
    const facteur = (2 * s) / vv;
    for (let i = k; i < m; i++) b[i] = b[i]! - facteur * v[i]!;
  }
  const coef = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let s = b[k]!;
    for (let j = k + 1; j < n; j++) s -= A[k]![j]! * coef[j]!;
    coef[k] = s / A[k]![k]!;
  }
  return coef;
}

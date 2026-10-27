import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Simulation IRRBB",
  description: "Démonstration du moteur IRRBB sur une banque fictive : ΔEVE, ΔNII, test des valeurs aberrantes et contrôles.",
  robots: { index: false, follow: false },
};

export default function RacineLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}

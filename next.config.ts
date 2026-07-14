import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Καρφώνουμε τη ρίζα του project στον φάκελο της εφαρμογής.
  // Αλλιώς το Turbopack βρίσκει το package-lock.json στο C:\Users\bestl,
  // νομίζει ότι ρίζα είναι όλο το home directory, και «κρεμάει» σκανάροντάς το.
  turbopack: {
    root: path.resolve(),
  },
};

export default nextConfig;

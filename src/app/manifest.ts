import type { MetadataRoute } from "next";

/** Maakt Atlas installeerbaar als app op telefoon en computer ("Zet op beginscherm"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Atlas – Steps & Stairs",
    short_name: "Atlas",
    description: "Klant- en projectbeheer Steps & Stairs",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f4",
    theme_color: "#1c1917",
    lang: "nl",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Klantenbord", url: "/bord" },
      { name: "Taken", url: "/taken" },
    ],
  };
}

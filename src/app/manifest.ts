import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas – Steps & Stairs",
    short_name: "Atlas",
    start_url: "/bord",
    display: "standalone",
    background_color: "#f5f5f4",
    theme_color: "#1c1917",
    lang: "nl",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}

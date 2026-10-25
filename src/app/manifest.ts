import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Neuron",
    short_name: "Neuron",
    description: "Neuron — AI study platform for university students",
    start_url: "/",
    display: "standalone",
    background_color: "#24097A",
    theme_color: "#6D3BF5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

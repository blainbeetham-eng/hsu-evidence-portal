import type { MetadataRoute } from "next";

// Lets the field team add the portal to their phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HSU field team",
    short_name: "HSU field",
    start_url: "/field",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1B5E20",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}

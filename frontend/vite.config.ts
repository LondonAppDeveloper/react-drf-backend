import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // --- ESTA ES LA PARTE QUE SOLUCIONA EL ERROR ---
    allowedHosts: [
      "meets-production-398c.up.railway.app", // Tu host específico
      ".railway.app",                        // Permite cualquier subdominio de Railway
      ".alcorte.cl",                         // Dominio propio (alcorte.cl y www)
    ],
    // ----------------------------------------------
    watch: {
      usePolling: true,
    },
    hmr: {

      host: "localhost",
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
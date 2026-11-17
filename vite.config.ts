import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Identificador desta publicação. Vai embutido no aplicativo e no version.json do site; quando os
// dois deixam de bater, o aplicativo aberto avisa que saiu versão nova (src/app/update.ts).
const BUILD_ID = new Date().toISOString();

function versionFile(): Plugin {
  return {
    name: 'no-porto-versao',
    apply: 'build',
    generateBundle() {
      // Só nos arquivos do site, não no código do worker.
      if (this.environment.name !== 'client') return;
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
});

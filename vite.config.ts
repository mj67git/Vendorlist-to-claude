import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          /**
           * Keep the libraries apart from the application.
           *
           * Everything used to land in one file, so a one-line change to a view
           * invalidated React, the charts and the UI primitives along with it —
           * every user on the internal network re-downloaded the whole thing
           * after every deployment. These three move only when their versions
           * do, which is roughly never, so a normal release now re-fetches the
           * application chunk alone.
           *
           * Charts get their own chunk rather than joining `vendor` because
           * `recharts` is the biggest of the three and only the dashboard and
           * the source detail page draw with it.
           */
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return;
            /*
             * The class-name helpers go with the UI primitives that use them.
             *
             * Left to rollup, `clsx` and `tailwind-merge` landed in `charts`,
             * because `recharts` depends on them too. Every button in the
             * application calls `cn()`, so the entry chunk then had a static
             * import into the chart bundle, and the browser preloaded 114 KB of
             * charting library on every page — the exact cost splitting the
             * chunk was meant to avoid.
             */
            if (/[\\/]node_modules[\\/](clsx|tailwind-merge|class-variance-authority)[\\/]/.test(id)) return 'ui';
            if (/[\\/]node_modules[\\/](recharts|d3-|victory-)/.test(id)) return 'charts';
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (/[\\/]node_modules[\\/](@radix-ui|motion|framer-motion|lucide-react)/.test(id)) return 'ui';
          },
        },
      },
      // The remaining warning would be about the chunks above, which are
      // libraries and cannot be split further from here.
      chunkSizeWarningLimit: 900,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

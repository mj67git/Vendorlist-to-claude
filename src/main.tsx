import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {TooltipProvider} from './components/ui/tooltip.tsx';
import './index.css';

// The provider sits at the root rather than inside App because Radix's Tooltip
// throws without one, and App returns early for the login and change-password
// screens — a tooltip rendered on either of those paths would crash the page.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TooltipProvider delayDuration={200}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>,
);

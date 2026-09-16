import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {TooltipProvider} from './components/ui/tooltip.tsx';
import './index.css';

// The provider sits at the root rather than inside App because Radix's Tooltip
// throws without one, and App returns early for the login and change-password
// screens — a tooltip rendered on either of those paths would crash the page.
//
// `MotionConfig reducedMotion="user"` wraps it because the `prefers-reduced-motion`
// block in `index.css` cannot reach Motion: Motion drives its animations by
// writing inline styles frame by frame from `requestAnimationFrame`, so a media
// query that shortens `animation-duration` never applies to any of it. Every
// `motion.*` in the application — page transitions, the date picker popover, the
// comparison accordion — ran at full strength for a reader who had asked the
// system for less, with `FormModal` the only component that had remembered to
// check `useReducedMotion` itself. Setting it once here means a component added
// later is covered whether or not its author knows the rule; transform and
// layout animations are dropped while opacity and colour, which carry meaning
// rather than movement, are kept.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={200}>
          <App />
        </TooltipProvider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);

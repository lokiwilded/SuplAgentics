import React from 'react';
import { ProjectContextPanel } from '@/components/layout/RightSidebarTabs';

interface MobileContextSurfaceProps {
  // Called after a plan's feedback is successfully sent/approved — closes this whole surface so
  // the user lands back on chat directly, instead of staying on the Plans list they came from.
  onClose?: () => void;
}

// Mobile equivalent of the desktop right sidebar's Context tab (Notes / Todo / Plans) — reuses
// ProjectContextPanel directly rather than re-deriving project state, so the Plans list (and the
// Review & Annotate pencil icon ported from SuplAgentics) show up here too, not just on desktop.
// See plans/openchamber-fork-port.md — "Context"/"Plans" had no mobile surface at all before this.
export const MobileContextSurface: React.FC<MobileContextSurfaceProps> = ({ onClose }) => {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background">
      <ProjectContextPanel onPlanFeedbackSent={onClose} />
    </div>
  );
};

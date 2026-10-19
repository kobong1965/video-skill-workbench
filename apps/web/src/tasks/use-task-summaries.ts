import { useEffect, useRef } from 'react';
import type { TaskSummary } from '../../../../packages/contracts';
import { useLoad } from '../workspace';

/** One summary refresh per visible list; never one canvas request per card. */
export function useTaskSummaries(url: string) {
  const tasks = useLoad<TaskSummary[]>(url);
  const refreshing = useRef(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (refreshing.current || !active || document.hidden) return;
      refreshing.current = true;
      try { await tasks.refresh(); } finally { refreshing.current = false; }
    };
    const changed = () => { void refresh(); };
    const timer = setInterval(changed, 3000);
    window.addEventListener('workbench:tasks-changed', changed);
    window.addEventListener('focus', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      active = false; clearInterval(timer);
      window.removeEventListener('workbench:tasks-changed', changed);
      window.removeEventListener('focus', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, [tasks.refresh]);
  return tasks;
}

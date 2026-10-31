import { useEffect, useState } from 'react';
import { getChildren, onDataChanged } from './api';
import { useAuthedSession } from './SessionContext';

// Last answer per family, so screens opened later don't flash lesson items before the list loads.
const known = new Map<string, boolean>();

/**
 * Whether the family has any children. Lessons, teachers and subjects are hidden until a child is added.
 * `null` while it is not known yet (or the list can't be read); callers then keep showing everything.
 */
export function useHasChildren(): boolean | null {
  const { call, session } = useAuthedSession();
  const familyId = session.family.id;
  const [has, setHas] = useState<boolean | null>(() => known.get(familyId) ?? null);

  useEffect(() => {
    let active = true;
    const load = () =>
      call(getChildren)
        .then((list) => {
          known.set(familyId, list.length > 0);
          if (active) setHas(list.length > 0);
        })
        // Not allowed to read the children list: leave it unknown.
        .catch(() => undefined);
    void load();
    const stop = onDataChanged(() => void load());
    return () => {
      active = false;
      stop();
    };
  }, [call, familyId]);

  return has;
}

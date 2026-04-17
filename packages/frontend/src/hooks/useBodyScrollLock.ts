import { useEffect } from 'react';

let lockCount = 0;
let originalOverflow: string | null = null;

/**
 * Locks `document.body` scroll while `isLocked` is true. Ref-counted so a Modal
 * and Drawer mounted simultaneously don't race each other's cleanup.
 */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return;

    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = originalOverflow ?? '';
        originalOverflow = null;
      }
    };
  }, [isLocked]);
}

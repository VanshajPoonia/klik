"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { EMPTY_SNAPSHOT, uploadQueue, type AddedEvent, type QueueContext } from "@/lib/upload-queue/page-queue";
import type { NewUpload } from "@/lib/upload-queue/record";

const subscribe = (listener: () => void) => uploadQueue().subscribe(listener);
const getSnapshot = () => uploadQueue().getSnapshot();
const getServerSnapshot = () => EMPTY_SNAPSHOT;

/**
 * OPS-3: one event's slice of the page's upload queue. `onAdded` hears every
 * upload of this event that lands, whichever tab or worker on this device
 * sent it, so the gallery can show it at once.
 */
export function useUploadQueue(context: QueueContext, onAdded?: (event: AddedEvent) => void) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const contextRef = useRef(context);
  const addedRef = useRef(onAdded);
  useEffect(() => {
    contextRef.current = context;
    addedRef.current = onAdded;
  });

  const { eventId } = context;
  useEffect(() => {
    const queue = uploadQueue();
    void queue.start();
    return queue.onAdded((event) => {
      if (event.eventId === eventId) addedRef.current?.(event);
    });
  }, [eventId]);

  const items = useMemo(() => snapshot.items.filter((item) => item.eventId === eventId), [eventId, snapshot.items]);

  const enqueue = useCallback((uploads: NewUpload[]) => uploadQueue().enqueue(contextRef.current, uploads), []);
  const retry = useCallback((id: string) => uploadQueue().retry(id), []);
  const retryNow = useCallback(() => uploadQueue().retryNow(), []);
  const remove = useCallback((id: string) => uploadQueue().remove(id), []);
  const clear = useCallback(() => uploadQueue().clearEvent(eventId), [eventId]);

  return {
    items,
    online: snapshot.online,
    durable: snapshot.durable,
    enqueue,
    retry,
    retryNow,
    remove,
    clear,
  };
}

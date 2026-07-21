import { useEffect, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import {
  buildCurrentLocalLibrarySyncSource,
  clearLastSyncedCloudLibrarySnapshot,
  mergeCloudLibrarySnapshots,
  pullCloudLibrarySnapshot,
  restoreCloudLibrary,
  saveLastSyncedCloudLibrarySnapshot,
} from "../lib/cloud-library-sync";

export function CloudLibraryBridge() {
  const { user, isConfigured, isLoading } = useAuth();
  const restoredUserIdsRef = useRef<Set<string>>(new Set());
  const latestRestoreRequestRef = useRef(0);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const userId = user?.id?.trim() || null;
    if (!isConfigured) {
      return;
    }

    if (!userId) {
      restoredUserIdsRef.current.clear();
      void clearLastSyncedCloudLibrarySnapshot();
      return;
    }

    if (restoredUserIdsRef.current.has(userId)) {
      return;
    }

    let isCancelled = false;

    const restore = async (currentUserId: string) => {
      const restoreRequestId = ++latestRestoreRequestRef.current;

      try {
        const remoteSnapshot = await pullCloudLibrarySnapshot();
        if (
          isCancelled ||
          restoreRequestId !== latestRestoreRequestRef.current
        ) {
          return;
        }

        const localSource = await buildCurrentLocalLibrarySyncSource();
        if (
          isCancelled ||
          restoreRequestId !== latestRestoreRequestRef.current
        ) {
          return;
        }

        const hasLocalData =
          localSource.playlists.length > 0 || localSource.likedSongs.length > 0;
        const hasRemoteData =
          remoteSnapshot.playlists.length > 0 ||
          remoteSnapshot.likedSongs.length > 0;

        if (!hasRemoteData) {
          await saveLastSyncedCloudLibrarySnapshot(remoteSnapshot);
          if (
            isCancelled ||
            restoreRequestId !== latestRestoreRequestRef.current
          ) {
            return;
          }
          restoredUserIdsRef.current.add(currentUserId);
          return;
        }

        const nextSnapshot = hasLocalData
          ? mergeCloudLibrarySnapshots(localSource.snapshot, remoteSnapshot)
          : remoteSnapshot;

        await restoreCloudLibrary(nextSnapshot, {
          deferTrackMetadataRefresh: false,
        });
        if (
          isCancelled ||
          restoreRequestId !== latestRestoreRequestRef.current
        ) {
          return;
        }

        await saveLastSyncedCloudLibrarySnapshot(nextSnapshot);
        restoredUserIdsRef.current.add(currentUserId);
      } catch {}
    };

    void restore(userId);

    return () => {
      isCancelled = true;
    };
  }, [isConfigured, isLoading, user?.id]);

  return null;
}

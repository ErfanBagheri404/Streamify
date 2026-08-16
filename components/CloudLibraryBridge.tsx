import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { useSettings } from "../contexts/SettingsContext";
import {
  buildCurrentLocalLibrarySyncSource,
  clearLastSyncedCloudLibrarySnapshot,
  mergeCloudLibrarySnapshots,
  pullCloudLibrarySnapshot,
  pushFullCloudLibrarySnapshot,
  restoreCloudLibrary,
  saveLastSyncedCloudLibrarySnapshot,
  syncCloudLibrarySnapshot,
} from "../lib/cloud-library-sync";
import { subscribeToLibraryUpdates } from "../utils/storage";
import { debounce } from "../utils/formatters";

const AUTO_PUSH_DEBOUNCE_MS = 4000;

export function CloudLibraryBridge() {
  const { user, isConfigured, isLoading } = useAuth();
  const { settings } = useSettings();
  const autoSync = settings.autoSyncLibrary;
  const restoredUserIdsRef = useRef<Set<string>>(new Set());
  const latestRestoreRequestRef = useRef(0);
  const autoPushInFlightRef = useRef(false);

  // One-time restore on login.
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

  // Background auto-push on local library changes (debounced).
  useEffect(() => {
    if (!autoSync || !isConfigured || !user?.id) {
      return;
    }

    const debouncedPush = debounce(() => {
      if (autoPushInFlightRef.current) {
        return;
      }
      autoPushInFlightRef.current = true;
      void pushFullCloudLibrarySnapshot()
        .catch(() => {})
        .finally(() => {
          autoPushInFlightRef.current = false;
        });
    }, AUTO_PUSH_DEBOUNCE_MS);

    const unsubscribe = subscribeToLibraryUpdates(() => {
      debouncedPush();
    });

    return () => {
      unsubscribe();
    };
  }, [autoSync, isConfigured, user?.id]);

  // Full sync when the app returns to foreground.
  useEffect(() => {
    if (!autoSync || !isConfigured || !user?.id) {
      return;
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void syncCloudLibrarySnapshot().catch(() => {});
      }
    });

    return () => {
      subscription.remove();
    };
  }, [autoSync, isConfigured, user?.id]);

  return null;
}

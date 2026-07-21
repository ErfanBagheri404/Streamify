import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import appConfig from "../app.json";
import { StorageService } from "../utils/storage";

const GITHUB_RELEASES_API_URL =
  "https://api.github.com/repos/ErfanBagheri404/Streamify/releases/latest";
const STREAMIFY_REPO_URL = "https://github.com/ErfanBagheri404/Streamify";
const DISMISSED_UPDATE_VERSION_KEY = "streamify:dismissed-update-version";
const CACHED_UPDATE_INFO_KEY = "streamify:cached-update-info";

export const CURRENT_APP_VERSION = appConfig.expo.version || "0.0.0";

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  content_type?: string;
};

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
};

export type UpdateReleaseInfo = {
  version: string;
  title: string;
  changelog: string;
  downloadUrl: string;
  releaseUrl: string;
  publishedAt?: string;
};

type CheckForUpdatesOptions = {
  forceShowModal?: boolean;
  ignoreDismissed?: boolean;
};

export type UpdateCheckResult =
  | {
      status: "available";
      info: UpdateReleaseInfo;
      usedCached?: boolean;
    }
  | {
      status: "up_to_date";
    }
  | {
      status: "error";
      message: string;
    };

type AppUpdateContextType = {
  currentVersion: string;
  updateInfo: UpdateReleaseInfo | null;
  availableUpdateInfo: UpdateReleaseInfo | null;
  isCheckingForUpdates: boolean;
  checkForUpdates: (
    options?: CheckForUpdatesOptions,
  ) => Promise<UpdateCheckResult>;
  reopenUpdateModal: () => Promise<UpdateCheckResult>;
  dismissUpdate: () => Promise<void>;
  hideUpdateModal: () => void;
};

const AppUpdateContext = createContext<AppUpdateContextType | undefined>(
  undefined,
);

function normalizeVersion(value?: string | null): string {
  return String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0];
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left)
    .split(".")
    .map((part) => Number(part) || 0);
  const rightParts = normalizeVersion(right)
    .split(".")
    .map((part) => Number(part) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function resolveReleaseDownloadUrl(release: GitHubRelease): string {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const apkAsset =
    assets.find((asset) => asset.name?.toLowerCase().endsWith(".apk")) ||
    assets.find((asset) =>
      String(asset.content_type || "")
        .toLowerCase()
        .includes("android"),
    ) ||
    assets[0];

  return (
    apkAsset?.browser_download_url || release.html_url || STREAMIFY_REPO_URL
  );
}

function isUpdateNewerThanCurrent(version?: string | null): boolean {
  const normalizedVersion = normalizeVersion(version);
  return Boolean(
    normalizedVersion &&
    compareVersions(normalizedVersion, CURRENT_APP_VERSION) > 0,
  );
}

function parseCachedUpdateInfo(value: string | null): UpdateReleaseInfo | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<UpdateReleaseInfo>;
    if (!parsed.version || !parsed.downloadUrl || !parsed.releaseUrl) {
      return null;
    }

    return {
      version: normalizeVersion(parsed.version),
      title:
        String(parsed.title || "").trim() ||
        `Streamify ${normalizeVersion(parsed.version)}`,
      changelog:
        String(parsed.changelog || "").trim() ||
        "No changelog was provided for this release.",
      downloadUrl: String(parsed.downloadUrl),
      releaseUrl: String(parsed.releaseUrl),
      publishedAt:
        typeof parsed.publishedAt === "string" ? parsed.publishedAt : undefined,
    };
  } catch (error) {
    console.log("[AppUpdate] Failed to parse cached update info:", error);
    return null;
  }
}

function buildUpdateReleaseInfo(
  release: GitHubRelease,
): UpdateReleaseInfo | null {
  const latestVersion = normalizeVersion(
    release.tag_name || release.name || "",
  );
  if (!latestVersion) {
    return null;
  }

  return {
    version: latestVersion,
    title:
      release.name?.trim() || `Streamify ${release.tag_name || latestVersion}`,
    changelog:
      release.body?.trim() || "No changelog was provided for this release.",
    downloadUrl: resolveReleaseDownloadUrl(release),
    releaseUrl: release.html_url || STREAMIFY_REPO_URL,
    publishedAt: release.published_at,
  };
}

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const [updateInfo, setUpdateInfo] = useState<UpdateReleaseInfo | null>(null);
  const [latestKnownUpdate, setLatestKnownUpdate] =
    useState<UpdateReleaseInfo | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(true);
  const [hasHydrated, setHasHydrated] = useState(false);

  const persistCachedUpdateInfo = useCallback(
    async (info: UpdateReleaseInfo | null) => {
      if (!info) {
        await StorageService.removeItem(CACHED_UPDATE_INFO_KEY);
        return;
      }

      await StorageService.setItem(
        CACHED_UPDATE_INFO_KEY,
        JSON.stringify(info),
      );
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const [storedDismissedVersion, storedCachedUpdate] = await Promise.all([
          StorageService.getItem(DISMISSED_UPDATE_VERSION_KEY),
          StorageService.getItem(CACHED_UPDATE_INFO_KEY),
        ]);

        if (cancelled) {
          return;
        }

        const normalizedDismissedVersion = normalizeVersion(
          storedDismissedVersion,
        );
        setDismissedVersion(normalizedDismissedVersion || null);

        const cachedUpdateInfo = parseCachedUpdateInfo(storedCachedUpdate);
        if (
          cachedUpdateInfo &&
          isUpdateNewerThanCurrent(cachedUpdateInfo.version)
        ) {
          setLatestKnownUpdate(cachedUpdateInfo);
        } else if (storedCachedUpdate) {
          void StorageService.removeItem(CACHED_UPDATE_INFO_KEY);
        }
      } finally {
        if (!cancelled) {
          setHasHydrated(true);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  const checkForUpdates = useCallback(
    async (
      options: CheckForUpdatesOptions = {},
    ): Promise<UpdateCheckResult> => {
      const cachedAvailableUpdate =
        latestKnownUpdate && isUpdateNewerThanCurrent(latestKnownUpdate.version)
          ? latestKnownUpdate
          : null;

      if (options.forceShowModal && cachedAvailableUpdate) {
        setUpdateInfo(cachedAvailableUpdate);
      }

      setIsCheckingForUpdates(true);

      try {
        const response = await fetch(GITHUB_RELEASES_API_URL, {
          headers: {
            Accept: "application/vnd.github+json",
          },
        });

        if (!response.ok) {
          throw new Error(`Release check failed with ${response.status}`);
        }

        const release = (await response.json()) as GitHubRelease;
        const resolvedUpdate = buildUpdateReleaseInfo(release);

        if (
          !resolvedUpdate ||
          !isUpdateNewerThanCurrent(resolvedUpdate.version)
        ) {
          setLatestKnownUpdate(null);
          setUpdateInfo(null);
          await persistCachedUpdateInfo(null);

          return {
            status: "up_to_date",
          };
        }

        setLatestKnownUpdate(resolvedUpdate);
        await persistCachedUpdateInfo(resolvedUpdate);

        const isDismissed =
          normalizeVersion(dismissedVersion) === resolvedUpdate.version;
        const shouldShowModal =
          options.forceShowModal || options.ignoreDismissed || !isDismissed;

        if (shouldShowModal) {
          setUpdateInfo(resolvedUpdate);
        }

        return {
          status: "available",
          info: resolvedUpdate,
          usedCached: false,
        };
      } catch (error) {
        console.log("[AppUpdate] Update check skipped:", error);

        if (options.forceShowModal && cachedAvailableUpdate) {
          setUpdateInfo(cachedAvailableUpdate);
          return {
            status: "available",
            info: cachedAvailableUpdate,
            usedCached: true,
          };
        }

        return {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to check for updates.",
        };
      } finally {
        setIsCheckingForUpdates(false);
      }
    },
    [dismissedVersion, latestKnownUpdate, persistCachedUpdateInfo],
  );

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    void checkForUpdates();
  }, [checkForUpdates, hasHydrated]);

  const reopenUpdateModal =
    useCallback(async (): Promise<UpdateCheckResult> => {
      const cachedAvailableUpdate =
        latestKnownUpdate && isUpdateNewerThanCurrent(latestKnownUpdate.version)
          ? latestKnownUpdate
          : null;

      if (cachedAvailableUpdate) {
        setUpdateInfo(cachedAvailableUpdate);
        return {
          status: "available",
          info: cachedAvailableUpdate,
          usedCached: true,
        };
      }

      return checkForUpdates({
        forceShowModal: true,
        ignoreDismissed: true,
      });
    }, [checkForUpdates, latestKnownUpdate]);

  const dismissUpdate = useCallback(async () => {
    if (!updateInfo?.version) {
      setUpdateInfo(null);
      return;
    }

    const normalizedVersion = normalizeVersion(updateInfo.version);
    setDismissedVersion(normalizedVersion);
    setUpdateInfo(null);
    await StorageService.setItem(
      DISMISSED_UPDATE_VERSION_KEY,
      normalizedVersion,
    );
  }, [updateInfo]);

  const hideUpdateModal = useCallback(() => {
    setUpdateInfo(null);
  }, []);

  const availableUpdateInfo =
    latestKnownUpdate && isUpdateNewerThanCurrent(latestKnownUpdate.version)
      ? latestKnownUpdate
      : null;

  const value = useMemo<AppUpdateContextType>(
    () => ({
      currentVersion: CURRENT_APP_VERSION,
      updateInfo,
      availableUpdateInfo,
      isCheckingForUpdates,
      checkForUpdates,
      reopenUpdateModal,
      dismissUpdate,
      hideUpdateModal,
    }),
    [
      availableUpdateInfo,
      checkForUpdates,
      dismissUpdate,
      hideUpdateModal,
      isCheckingForUpdates,
      reopenUpdateModal,
      updateInfo,
    ],
  );

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext);
  if (!context) {
    throw new Error("useAppUpdate must be used within an AppUpdateProvider");
  }

  return context;
}

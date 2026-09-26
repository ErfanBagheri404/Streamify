import * as React from "react";
import {
  filterPrivatePlaylists,
  type LockablePlaylist,
} from "../modules/appLock";
import {
  isAppLockEnabled,
  hasAppLockPin,
  isVaultUnlockedThisLaunch,
  loadPrivatePlaylistIds,
  setPlaylistPrivate,
  subscribeToVault,
  unlockVaultForLaunch,
} from "../modules/appLockStore";

interface VaultContextValue {
  /** Every playlist with `isPrivate` resolved. Private entries stay in the
   * list while the vault is open so the UI can show its own lock badge. */
  decorate: <T extends { id: string }>(playlists: T[]) => (T & LockablePlaylist)[];
  /** What every browse/search/share surface must render. */
  visible: <T extends { id: string }>(playlists: T[]) => T[];
  isVaultUnlocked: boolean;
  hasVault: boolean;
  privateCount: number;
  setPlaylistPrivate: (playlistId: string, isPrivate: boolean) => Promise<void>;
  unlockVault: () => Promise<void>;
  /** Re-reads storage; call after a playlist is created or deleted. */
  refresh: () => Promise<void>;
}

/** Fail-open only when the provider is absent (feature not wired): there is no
 * `isPrivate` decoration to enforce in that case, so a passthrough cannot leak
 * anything — but it also never silently pretends the vault is closed. */
const PASSTHROUGH: VaultContextValue = {
  decorate: (playlists) =>
    playlists.map((playlist) => ({ ...playlist, isPrivate: false })),
  visible: (playlists) => playlists.slice(),
  isVaultUnlocked: true,
  hasVault: false,
  privateCount: 0,
  setPlaylistPrivate: async () => undefined,
  unlockVault: async () => undefined,
  refresh: async () => undefined,
};

const VaultContext = React.createContext<VaultContextValue>(PASSTHROUGH);

export const useVault = () => React.useContext(VaultContext) ?? PASSTHROUGH;

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [privateIds, setPrivateIds] = React.useState<string[]>([]);
  const [isVaultUnlocked, setIsVaultUnlocked] = React.useState(true);
  const [hasVault, setHasVault] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const [ids, unlocked, enabled, hasPin] = await Promise.all([
      loadPrivatePlaylistIds(),
      isVaultUnlockedThisLaunch(),
      isAppLockEnabled(),
      hasAppLockPin(),
    ]);
    setPrivateIds(ids);
    setIsVaultUnlocked(unlocked);
    setHasVault(enabled && hasPin && ids.length > 0);
  }, []);

  React.useEffect(() => {
    void refresh();
    const sub = subscribeToVault(() => {
      void refresh();
    });
    return () => {
      void sub.remove();
    };
  }, [refresh]);

  const decorate = React.useCallback(
    <T extends { id: string }>(playlists: T[]) =>
      playlists.map((playlist) => ({
        ...playlist,
        isPrivate: privateIds.includes(playlist.id),
      })),
    [privateIds],
  );

  const visible = React.useCallback(
    <T extends { id: string }>(playlists: T[]) =>
      filterPrivatePlaylists(decorate(playlists), isVaultUnlocked),
    [decorate, isVaultUnlocked],
  );

  const unlockVault = React.useCallback(async () => {
    await unlockVaultForLaunch();
    setIsVaultUnlocked(true);
  }, []);

  const value = React.useMemo<VaultContextValue>(
    () => ({
      decorate,
      visible,
      isVaultUnlocked,
      hasVault,
      privateCount: privateIds.length,
      setPlaylistPrivate,
      unlockVault,
      refresh,
    }),
    [decorate, visible, isVaultUnlocked, hasVault, privateIds.length, unlockVault, refresh],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  sanitizeAppSettings,
} from "../lib/app-settings";
import { StorageService } from "../utils/storage";

interface SettingsContextValue {
  settings: AppSettings;
  hasHydratedSettings: boolean;
  updateSettings: (updates: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [hasHydratedSettings, setHasHydratedSettings] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const hydrateSettings = async () => {
      const savedSettings = await StorageService.loadAppSettings();

      if (!isMounted) {
        return;
      }

      setSettings(savedSettings);
      setHasHydratedSettings(true);
    };

    void hydrateSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedSettings) {
      return;
    }

    void StorageService.saveAppSettings(settings);
  }, [hasHydratedSettings, settings]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((current) => sanitizeAppSettings({ ...current, ...updates }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      hasHydratedSettings,
      updateSettings,
      resetSettings,
    }),
    [hasHydratedSettings, resetSettings, settings, updateSettings],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);

  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }

  return context;
};

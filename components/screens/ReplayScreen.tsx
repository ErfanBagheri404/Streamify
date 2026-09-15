/**
 * ReplayScreen — listening stats dashboard.
 *
 * Shows what this device has listened to: total time, top tracks, top
 * artists, top albums, listening clock (ms per hour of day). Everything is
 * computed on-device from monthly buckets — nothing leaves the phone.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Share,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import styled from "styled-components/native";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import {
  loadReplaySummary,
  type ReplayPeriod,
  type ReplaySummary,
} from "../../utils/listeningStats";
import { playHaptic, Haptic } from "../../utils/haptics";
import { usePlayer } from "../../contexts/PlayerContext";

const Container = styled.View`
  flex: 1;
  background-color: ${(props: any) => props.theme.background};
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  padding-horizontal: 16px;
  padding-top: 8px;
  padding-bottom: 12px;
`;

const HeaderTitle = styled.Text`
  flex: 1;
  font-size: 22px;
  font-weight: 700;
  color: ${(props: any) => props.theme.foreground};
`;

const BackButton = styled.TouchableOpacity`
  padding: 8px;
  margin-right: 8px;
`;

const PeriodRow = styled.View`
  flex-direction: row;
  margin: 0 16px 12px;
  border-radius: 12px;
  overflow: hidden;
  border-width: 1px;
  border-color: ${(props: any) => props.theme.borderSubtle};
`;

const PeriodButton = styled.TouchableOpacity<{ active: boolean }>`
  flex: 1;
  padding-vertical: 8px;
  align-items: center;
  background-color: ${(props: any) =>
    props.active ? props.theme.accent : "transparent"};
`;

const PeriodText = styled.Text<{ active: boolean }>`
  font-size: 13px;
  font-weight: 600;
  color: ${(props: any) =>
    props.active ? "#ffffff" : props.theme.mutedForeground};
`;

const StatCard = styled.View`
  margin: 0 16px 12px;
  padding: 16px;
  border-radius: 16px;
  background-color: ${(props: any) => props.theme.surface};
  border-width: 1px;
  border-color: ${(props: any) => props.theme.borderSubtle};
`;

const StatBig = styled.Text`
  font-size: 26px;
  font-weight: 800;
  color: ${(props: any) => props.theme.foreground};
`;

const StatSub = styled.Text`
  font-size: 13px;
  color: ${(props: any) => props.theme.mutedForeground};
  margin-top: 2px;
`;

const SectionTitle = styled.Text`
  font-size: 17px;
  font-weight: 700;
  color: ${(props: any) => props.theme.foreground};
  margin: 16px 16px 8px;
`;

const ClockRow = styled.View`
  flex-direction: row;
  align-items: flex-end;
  height: 64px;
  margin: 8px 16px 16px;
`;

const ClockBar = styled.View<{ h: number; max: number }>`
  flex: 1;
  margin-horizontal: 1px;
  height: ${(props: any) => Math.max(2, (props.h / Math.max(props.max, 1)) * 56)}px;
  border-radius: 2px;
  background-color: ${(props: any) =>
    withOpacity(props.theme.accent, 0.35 + 0.65 * (props.h / Math.max(props.max, 1)))};
`;

const ClockLabels = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin: 0 16px 8px;
`;

const ClockLabel = styled.Text`
  font-size: 10px;
  color: ${(props: any) => props.theme.mutedForeground};
`;

const ArtistRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding-horizontal: 16px;
  padding-vertical: 8px;
`;

const RankText = styled.Text`
  width: 28px;
  font-size: 14px;
  font-weight: 700;
  color: ${(props: any) => props.theme.mutedForeground};
`;

function formatMs(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 24) {
    const days = Math.floor(h / 24);
    return `${days}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const PERIODS: Array<{ key: ReplayPeriod; labelKey: string }> = [
  { key: "month", labelKey: "replay.period_month" },
  { key: "year", labelKey: "replay.period_year" },
  { key: "alltime", labelKey: "replay.period_alltime" },
];

export const ReplayScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<ReplayPeriod>("month");
  const [summary, setSummary] = useState<ReplaySummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: ReplayPeriod) => {
    setLoading(true);
    try {
      const s = await loadReplaySummary(p);
      setSummary(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  const maxHourMs = useMemo(
    () => (summary ? Math.max(...summary.hours, 1) : 1),
    [summary],
  );

  const { playTrack } = usePlayer();

  // Wrapped-style share: builds a text card from the already-loaded summary.
  // No screenshot library — zero new native deps, mounts nothing extra.
  const handleShareSummary = useCallback(async () => {
    if (!summary) {
      return;
    }
    playHaptic(Haptic.Select);
    const lines: string[] = [];
    const periodLabel =
      PERIODS.find((p) => p.key === period)?.labelKey ?? "replay.title";
    lines.push(
      t("replay.shareHeader", { period: t(periodLabel) }),
    );
    lines.push("");
    lines.push(
      t("replay.shareSummary", {
        time: formatMs(summary.totalMs),
        plays: summary.totalPlays,
      }),
    );
    if (summary.topArtists[0]) {
      lines.push(t("replay.shareTopArtist", { artist: summary.topArtists[0].name }));
    }
    if (summary.topTracks.length > 0) {
      lines.push("");
      lines.push(t("replay.shareTopTracks"));
      summary.topTracks.slice(0, 5).forEach((track, i) => {
        const artist = track.artist ? ` — ${track.artist}` : "";
        lines.push(`${i + 1}. ${track.title}${artist}`);
      });
    }
    const hour = summary.hours.indexOf(Math.max(...summary.hours));
    if (hour >= 0 && summary.hours[hour] > 0) {
      lines.push("");
      lines.push(
        t("replay.sharePeak", { hour: `${String(hour).padStart(2, "0")}:00` }),
      );
    }
    try {
      await Share.share({ message: lines.join("\n") });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  }, [summary, period]);

  const handleTrackPlay = useCallback(
    async (track: any, index: number, list: any[]) => {
      playHaptic(Haptic.Select);
      // Queue = the visible top-tracks list, so next/prev walk the chart.
      const queue = list.map((entry: any) => ({
        id: entry.id,
        title: entry.title,
        artist: entry.artist,
        thumbnail: entry.thumbnail,
      }));
      await playTrack(track, queue, index);
    },
    [playTrack],
  );

  return (
    <Container theme={colors}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.background }}>
        <Header theme={colors}>
          <BackButton onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </BackButton>
          <HeaderTitle theme={colors}>{t("replay.title")}</HeaderTitle>
          <TouchableOpacity
            onPress={() => void handleShareSummary()}
            disabled={!summary || summary.totalPlays === 0}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ opacity: summary && summary.totalPlays > 0 ? 1 : 0.35 }}
          >
            <Ionicons name="share-social-outline" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </Header>
      </View>

      {loading && !summary ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={summary?.topTracks ?? []}
          keyExtractor={(item) => `track-${item.id}`}
          ListHeaderComponent={
            <>
              <PeriodRow theme={colors}>
                {PERIODS.map((p) => (
                  <PeriodButton
                    key={p.key}
                    theme={colors}
                    active={period === p.key}
                    onPress={() => {
                      playHaptic(Haptic.Tick);
                      setPeriod(p.key);
                    }}
                  >
                    <PeriodText theme={colors} active={period === p.key}>
                      {t(p.labelKey)}
                    </PeriodText>
                  </PeriodButton>
                ))}
              </PeriodRow>

              <StatCard theme={colors}>
                <StatBig theme={colors}>
                  {formatMs(summary?.totalMs ?? 0)}
                </StatBig>
                <StatSub theme={colors}>
                  {t("replay.listened")} · {summary?.totalPlays ?? 0} {t("replay.plays")}
                  {summary?.biggestDay
                    ? ` · ${t("replay.biggestDay")} ${summary.biggestDay.date}`
                    : ""}
                </StatSub>
              </StatCard>

              <SectionTitle theme={colors}>{t("replay.listeningClock")}</SectionTitle>
              <ClockRow theme={colors}>
                {(summary?.hours ?? new Array(24).fill(0)).map((ms: number, h: number) => (
                  <ClockBar key={h} theme={colors} h={ms} max={maxHourMs} />
                ))}
              </ClockRow>
              <ClockLabels theme={colors}>
                <ClockLabel theme={colors}>0</ClockLabel>
                <ClockLabel theme={colors}>6</ClockLabel>
                <ClockLabel theme={colors}>12</ClockLabel>
                <ClockLabel theme={colors}>18</ClockLabel>
                <ClockLabel theme={colors}>23</ClockLabel>
              </ClockLabels>

              <SectionTitle theme={colors}>{t("replay.topArtists")}</SectionTitle>
              {(summary?.topArtists ?? []).slice(0, 10).map((a, i) => (
                <ArtistRow key={`artist-${a.name}`} theme={colors}>
                  <RankText theme={colors}>{i + 1}</RankText>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600" }}>
                      {a.name}
                    </Text>
                    <StatSub theme={colors}>
                      {formatMs(a.ms)} · {a.plays} {t("replay.plays")}
                    </StatSub>
                  </View>
                </ArtistRow>
              ))}
              {(summary?.topArtists?.length ?? 0) === 0 && (
                <StatSub theme={colors} style={{ marginHorizontal: 16 }}>
                  {t("replay.empty")}
                </StatSub>
              )}

              <SectionTitle theme={colors}>{t("replay.topTracks")}</SectionTitle>
            </>
          }
          renderItem={({ item, index }) => (
            <TouchableOpacity
              onPress={() => void handleTrackPlay(item, index, summary?.topTracks ?? [])}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <RankText theme={colors}>{index + 1}</RankText>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600" }}>
                  {item.title}
                </Text>
                <StatSub theme={colors}>
                  {item.artist ?? ""} · {item.plays} plays
                </StatSub>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {formatMs(item.ms)}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <StatSub theme={colors} style={{ margin: 16, textAlign: "center" }}>
              No listening data yet.
            </StatSub>
          }
          contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
        />
      )}
    </Container>
  );
};

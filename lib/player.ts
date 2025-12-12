import { audio, favButton, favIcon, playButton, title } from "./dom";
import { convertSStoHHMMSS } from "./utils";
import { params, state, store } from "./store";
import { setMetaData } from "../modules/setMetadata";
import { getDB } from "./libraryUtils";
import getStreamData from "../modules/getStreamData";

const isWeb = typeof document !== "undefined";

export default async function player(id: string | null = "") {
  if (!id) return;

  if (state.watchMode && isWeb) {
    store.actionsMenu.id = id;
    const dialog = document.createElement("dialog");
    dialog.open = true;
    dialog.className = "watcher";
    document.body.appendChild(dialog);
    import("../components/WatchVideo").then((mod) => mod.default(dialog));
    return;
  }

  if (isWeb && playButton)
    playButton.classList.replace(playButton.className, "ri-loader-3-line");

  if (state.jiosaavn) {
    if (!store.player.useSaavn) store.player.useSaavn = true;
    else if (store.stream.author.endsWith("Topic"))
      return import("../modules/jioSaavn").then((mod) => mod.default());
  }

  if (isWeb && title) title.textContent = "Fetching Data...";

  const data = await getStreamData(id);

  if (data && "audioStreams" in data) store.player.data = data;
  else {
    if (isWeb && playButton)
      playButton.classList.replace(playButton.className, "ri-stop-circle-fill");
    if (isWeb && title)
      title.textContent = data.message || data.error || "Fetching Data Failed";
    return;
  }

  await setMetaData({
    id: id,
    title: data.title,
    author: data.uploader,
    duration: convertSStoHHMMSS(data.duration),
    channelUrl: data.uploaderUrl,
  });

  if (store.player.legacy) {
    if (isWeb && audio) {
      audio.src = data.hls as string;
      audio.load();
    }
  } else {
    const { hls } = store.player;
    if (state.HLS) {
      const hlsUrl = hls.manifests.shift();
      if (hlsUrl) hls.src(hlsUrl as string);
    } else
      import("../modules/setAudioStreams").then((mod) =>
        mod.default(
          data.audioStreams.sort(
            (a: { bitrate: string }, b: { bitrate: string }) =>
              parseInt(a.bitrate) - parseInt(b.bitrate)
          ),
          data.livestream
        )
      );
  }

  if (isWeb) params.set("s", id);

  if (isWeb && location.pathname === "/")
    history.replaceState(
      {},
      "",
      location.origin + "?s=" + (params.get("s") || id)
    );

  if (state.enqueueRelatedStreams)
    import("../modules/enqueueRelatedStreams").then((mod) =>
      mod.default(data.relatedStreams as StreamItem[])
    );

  // favbutton reset
  if (isWeb && favButton && favButton.checked) {
    favButton.checked = false;
    if (favIcon) favIcon.classList.remove("ri-heart-fill");
  }

  // favbutton set
  if (getDB().favorites?.hasOwnProperty(id)) {
    if (isWeb && favButton) {
      favButton.checked = true;
      if (favIcon) favIcon.classList.add("ri-heart-fill");
    }
  }

  // related streams imported into discovery after 1min 40seconds, short streams are naturally filtered out

  if (state.discover)
    import("../modules/setDiscoveries").then((mod) => {
      setTimeout(() => {
        mod.default(id, data.relatedStreams as StreamItem[]);
      }, 1e5);
    });
}

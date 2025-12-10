export const API = {
  piped: ["https://api.piped.private.coffee"],
  invidious: ["https://yewtu.be"],
  proxy: [],
  hls: ["https://api.piped.private.coffee"],
  hyperpipe: ["https://hyperpipeapi.onrender.com"],
  backend: "https://streamifyend.netlify.app",
} as const;

export async function fetchStreamFromPiped(id: string, api: string) {
  const res = await fetch(`${api}/streams/${id}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as Piped;
}

export async function fetchStreamFromInvidious(id: string, api: string) {
  const res = await fetch(`${api}/api/v1/videos/${id}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as unknown as Piped;
}

export async function getStreamData(id: string, prefer: 'piped' | 'invidious' = 'piped') {
  const src = prefer === 'piped' ? API.piped : API.invidious;
  const list = src.filter(Boolean);
  for (const base of list) {
    try {
      return prefer === 'piped'
        ? await fetchStreamFromPiped(id, base)
        : await fetchStreamFromInvidious(id, base);
    } catch (e) {
      // try next
    }
  }
  // fallback to other source
  const alt = prefer === 'piped' ? API.invidious : API.piped;
  for (const base of alt.filter(Boolean)) {
    try {
      return prefer === 'piped'
        ? await fetchStreamFromInvidious(id, base)
        : await fetchStreamFromPiped(id, base);
    } catch (e) {}
  }
  throw new Error('No sources available');
}

export function getBestAudioUrl(piped: Piped) {
  const list = (piped?.audioStreams || []).filter((s: any) => !!s?.url);
  if (!list.length) return undefined;
  const sorted = list.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
  const best = sorted[0];
  return { url: best.url as string, mimeType: best?.mimeType, bitrate: best?.bitrate };
}
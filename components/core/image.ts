export function generateImageUrl(id: string, res: 'mq' | 'hq' = 'mq', music: string = ''): string {
  // Remote thumbnail URL builder compatible with RN Image
  return 'https://wsrv.nl?url=https://' + (id.startsWith('/')
    ? `yt3.googleusercontent.com${id}=s720-c-k-c0x00ffffff-no-rj&output=webp&w=${res === 'mq' ? '180' : '360'}`
    : `i.ytimg.com/vi_webp/${id}/${res}default.webp${music}`);
}

export function getThumbIdFromLink(url: string): string {
  try {
    if (url.startsWith('/vi_webp')) return url.slice(9, 20);
    if (url.startsWith('/') || url.length === 11) return url;
    if (url.includes('wsrv.nl')) url = url.replace('https://wsrv.nl?url=', '');
    const l = new URL(url);
    const p = l.pathname;
    return l.search.includes('ytimg') ? p.split('/')[2] : p.split('=')[0];
  } catch {
    return url;
  }
}
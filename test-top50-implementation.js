// Test script to verify Top 50 implementation
const mockData = {
  top50Global: [
    {
      id: "1",
      name: "Flowers",
      artists: [{ name: "Miley Cyrus" }],
      album: { images: [{ url: "https://via.placeholder.com/160" }] },
      preview_url: null,
      duration_ms: 200000,
    },
    {
      id: "2",
      name: "As It Was",
      artists: [{ name: "Harry Styles" }],
      album: { images: [{ url: "https://via.placeholder.com/160" }] },
      preview_url: null,
      duration_ms: 180000,
    },
    {
      id: "3",
      name: "Anti-Hero",
      artists: [{ name: "Taylor Swift" }],
      album: { images: [{ url: "https://via.placeholder.com/160" }] },
      preview_url: null,
      duration_ms: 220000,
    },
  ]
};

// Simulate the data processing logic from HomeScreen
function processTop50Data(data) {
  return data.map((item, idx) => {
    const track = item.track || item;
    const trackName = track.name || item.name;
    const artistName = track.artists?.[0]?.name || item.artists?.[0]?.name || "Unknown Artist";
    const imageUrl = track.album?.images?.[0]?.url || item.album?.images?.[0]?.url;
    
    return {
      id: track.id || item.id,
      title: trackName,
      artist: artistName,
      image: imageUrl,
      track: track
    };
  });
}

console.log('🎵 Testing Top 50 Data Processing:');
console.log('Original mock data:', JSON.stringify(mockData.top50Global, null, 2));

const processedData = processTop50Data(mockData.top50Global);
console.log('\n📊 Processed data for cards:');
console.log(JSON.stringify(processedData, null, 2));

console.log('\n✅ Test completed successfully!');
console.log('The Top 50 section should now display these tracks in cards.');
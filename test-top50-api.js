// Use built-in fetch (Node.js 18+)

// Test the Spotify API directly for Top 50 playlist
async function testTop50API() {
  const clientId = "e4a9619a0ff44e208f8cb006e881ddad";
  const clientSecret = "213f0e8ea06f4f6ab625c844fd3e020f";

  try {
    // Step 1: Get access token
    console.log("Getting access token...");
    const tokenResponse = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      }
    );

    if (!tokenResponse.ok) {
      throw new Error(
        `Token request failed: ${tokenResponse.status} ${tokenResponse.statusText}`
      );
    }

    const tokenData = await tokenResponse.json();
    console.log("✅ Got access token");

    // Step 2: Get playlist data
    console.log("Getting Top 50 playlist data...");
    const playlistResponse = await fetch(
      "https://api.spotify.com/v1/playlists/37i9dQZEVXbMDoHDwVN2tF",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!playlistResponse.ok) {
      throw new Error(
        `Playlist request failed: ${playlistResponse.status} ${playlistResponse.statusText}`
      );
    }

    const playlistData = await playlistResponse.json();
    console.log("✅ Got playlist data");

    // Step 3: Extract tracks
    console.log("\n📊 Top 50 Global Tracks:");
    console.log(`Playlist: ${playlistData.name}`);
    console.log(`Description: ${playlistData.description}`);
    console.log(`Total tracks: ${playlistData.tracks.total}`);

    if (playlistData.tracks.items && playlistData.tracks.items.length > 0) {
      console.log("\n🎵 First 10 tracks:");
      playlistData.tracks.items.slice(0, 10).forEach((item, index) => {
        const track = item.track;
        if (track) {
          console.log(
            `${index + 1}. ${track.name} - ${track.artists.map((a) => a.name).join(", ")}`
          );
          console.log(
            `   Album: ${track.album.name} | Duration: ${Math.floor(track.duration_ms / 1000)}s`
          );
          if (track.album.images && track.album.images[0]) {
            console.log(`   Image: ${track.album.images[0].url}`);
          }
        }
      });

      // Show sample card data structure
      console.log("\n🃏 Sample Card Data Structure:");
      const sampleTrack = playlistData.tracks.items[0].track;
      if (sampleTrack) {
        console.log(
          JSON.stringify(
            {
              id: sampleTrack.id,
              name: sampleTrack.name,
              artists: sampleTrack.artists.map((a) => ({ name: a.name })),
              album: {
                name: sampleTrack.album.name,
                images: sampleTrack.album.images,
              },
              duration_ms: sampleTrack.duration_ms,
              preview_url: sampleTrack.preview_url,
            },
            null,
            2
          )
        );
      }
    }

    return playlistData;
  } catch (error) {
    console.error("❌ Error:", error.message);
    return null;
  }
}

// Run the test
testTop50API();

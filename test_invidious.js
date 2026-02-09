const { DYNAMIC_INVIDIOUS_INSTANCES } = require("./components/core/api.ts");

async function testInvidiousInstances() {
  console.log("Testing Invidious instances...");
  console.log("Available instances:", DYNAMIC_INVIDIOUS_INSTANCES);

  const testVideoId = "tfSS1e3kYeo"; // Travis Scott - HIGHEST IN THE ROOM

  for (const instance of DYNAMIC_INVIDIOUS_INSTANCES) {
    try {
      console.log(`Testing instance: ${instance}`);
      const response = await fetch(
        `${instance}/api/v1/videos/${testVideoId}?local=true`
      );

      if (!response.ok) {
        console.log(`  ❌ Failed: ${response.status}`);
        continue;
      }

      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("json")) {
        console.log(`  ❌ Blocked: HTML response`);
        continue;
      }

      const data = await response.json();
      if (data.adaptiveFormats || data.formatStreams) {
        console.log(`  ✅ Working: Found audio formats`);
        const audioFormats =
          data.adaptiveFormats?.filter(
            (f) =>
              f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/")
          ) || [];
        console.log(`    Audio formats: ${audioFormats.length}`);
        if (audioFormats.length > 0) {
          console.log(
            `    First format URL: ${audioFormats[0].url?.substring(0, 100)}...`
          );
        }
      } else {
        console.log(`  ❌ No audio formats found`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
}

testInvidiousInstances();

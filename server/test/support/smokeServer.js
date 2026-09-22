// Starts the real API with in-memory models and the mock model provider, for UI demos
// and browser smoke tests without MongoDB or an API key:  node server/test/support/smokeServer.js
process.env.LLM_PROVIDERS ||= 'mock';
process.env.DISCUSSION_SEARCH ||= 'false';
process.env.ALLOW_PRIVATE_URLS = 'true';
const { installFakeModels } = await import('./fakeModels.js');
installFakeModels();
const { createApp } = await import('../../src/app.js');
const { startFixtureServer } = await import('../../scripts/serve-fixtures.js');
await startFixtureServer(8099).catch(() => {});
const port = Number(process.env.PORT || 4000);
createApp().listen(port, () => console.log(`Smoke API on :${port} (in-memory DB, mock LLM, fixtures on :8099)`));

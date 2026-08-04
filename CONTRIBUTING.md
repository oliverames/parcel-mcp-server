# Contributing

Open an issue before a broad change. Keep the local and hosted tool surfaces identical by implementing tools in the root `index.js` factory.

Before a pull request, run:

```bash
npm test
npm run smoke:list-tools
npm run smoke:packed
npm run release:check
```

Do not use real Parcel credentials in tests or fixtures.

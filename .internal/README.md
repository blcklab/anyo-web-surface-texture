# Maintainer notes

This repository was reconstructed from the genuine `1.0.1-rc.2` TypeScript source checkpoint. The known `1.0.1-rc.5` distribution was used as the compatibility oracle for runtime output and public declarations.

Before release, run `npm install` and `npm run check` on Node 22 and Node 24. The rc.6 release must preserve the rc.5 public exports and replacement-safe lifecycle behavior.

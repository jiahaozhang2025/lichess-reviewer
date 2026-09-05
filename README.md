# Lichess Review Queue

A small local web app that syncs a Lichess user's public games, chooses a random game from a filtered review pool, opens it on Lichess, and remembers what has been opened or reviewed.

## Start

Double-click `start.cmd`, or run:

```powershell
npm start
```

The app opens at <http://127.0.0.1:4173>.

## How it works

- Enter a Lichess username and sync up to 3,000 recent games.
- Lichess server-analysis status is detected during each sync.
- By default, the random pool excludes games already reviewed locally or analyzed on Lichess.
- Opening and reviewing are tracked separately in `data/review-data.json`.
- The server binds only to this computer and does not ask for a Lichess password or API token.

To request computer analysis, open the chosen game on Lichess, go to the analysis board, and select **Request a computer analysis**. Sync again later to detect the completed Lichess analysis automatically, or mark the game reviewed immediately.

## Current scope

This first version delegates engine analysis to Lichess. A later version can add local Stockfish analysis while keeping the same queue and history.


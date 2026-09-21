# Drift

Drift is a small Node.js website for downloading permitted direct media URLs and saving user-selected local media files. It does not extract protected platform streams.

## Run locally

Requires Node.js 20 or newer.

```sh
npm start
```

Open `http://127.0.0.1:4173`.

## Deploy on Render

1. Put this folder in a GitHub repository.
2. Sign in to Render and choose **New → Web Service**.
3. Connect the repository.
4. Choose the **Free** instance.
5. Use `npm install` as the build command and `npm start` as the start command.
6. Deploy. Render supplies the `PORT` value automatically.

The frontend and API are served by the same service. No separate CORS setting is required.

## Supported sources

- Direct HTTP/HTTPS links to common video and audio formats
- Local video and audio files selected in the browser
- Sources that provide an official, permitted direct media endpoint

The server blocks private-network URLs, restricts ports and redirects, caps files at 500 MB, limits concurrent downloads, and creates expiring signed download links.
